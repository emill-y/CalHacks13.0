import { Redis } from "@upstash/redis";

/**
 * Abuse protection for a public deployment (every search spends the operator's Anthropic credits):
 *  - optional origin allowlist (ALLOWED_ORIGINS="chrome-extension://<id>,https://your-app.example")
 *  - fixed-window rate limits per device, per IP, and a global daily cap on searches.
 * Counters live in Upstash when configured (shared across instances), otherwise in memory.
 */

type Kind = "search" | "index" | "merchant" | "wish";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const LIMITS: Record<Kind, { perDevice?: number; perIp: number; windowS: number }> = {
  search: { perDevice: num(process.env.RATE_SEARCH_PER_DEVICE_HOUR, 40), perIp: num(process.env.RATE_SEARCH_PER_IP_HOUR, 80), windowS: 3600 },
  index: { perIp: num(process.env.RATE_INDEX_PER_IP_HOUR, 12), windowS: 3600 },
  merchant: { perIp: num(process.env.RATE_MERCHANT_PER_IP_HOUR, 20), windowS: 3600 },
  wish: { perIp: num(process.env.RATE_WISH_PER_IP_HOUR, 60), windowS: 3600 },
};
const DAILY_SEARCH_CAP = num(process.env.DAILY_SEARCH_CAP, 500); // ~$0.05 per search with Sonnet 5.5 → ~$25/day max

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;
const g = globalThis as unknown as { __rl?: Map<string, { n: number; reset: number }> };
const mem = (g.__rl ??= new Map());

async function hit(key: string, windowS: number): Promise<number> {
  const bucket = Math.floor(Date.now() / 1000 / windowS);
  const k = `tb:rl:${key}:${bucket}`;
  if (redis) {
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowS + 5);
    return n;
  }
  const now = Date.now();
  const cur = mem.get(k);
  if (!cur || cur.reset < now) {
    if (mem.size > 50_000) mem.clear();
    mem.set(k, { n: 1, reset: now + windowS * 1000 });
    return 1;
  }
  cur.n++;
  return cur.n;
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim().slice(0, 64);
}

function originAllowed(req: Request): boolean {
  const list = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin navigations / server-to-server; rate limits still apply
  const self = new URL(req.url).origin;
  const host = req.headers.get("host");
  return origin === self || (host != null && new URL(origin).host === host) || list.includes(origin);
}

function deny(status: number, error: string, code: string, retryAfterS?: number) {
  return Response.json(
    { error, code },
    { status, headers: retryAfterS ? { "retry-after": String(retryAfterS) } : undefined },
  );
}

/** Returns a Response to send back if the request should be refused, else null. */
export async function guard(req: Request, kind: Kind, deviceId?: string): Promise<Response | null> {
  if (process.env.RATE_LIMITS_OFF === "1") return null;
  if (!originAllowed(req)) return deny(403, "This server only accepts requests from the ThisBut extension and app.", "origin_not_allowed");
  const lim = LIMITS[kind];
  try {
    const ip = clientIp(req);
    if ((await hit(`${kind}:ip:${ip}`, lim.windowS)) > lim.perIp) {
      return deny(429, "You’re going fast! Please wait a bit and try again.", "rate_limited", lim.windowS);
    }
    if (lim.perDevice && deviceId && deviceId !== "anonymous" && (await hit(`${kind}:dev:${deviceId}`, lim.windowS)) > lim.perDevice) {
      return deny(429, "You’ve hit the hourly search limit for this demo. Try again in a little while.", "rate_limited", lim.windowS);
    }
    if (kind === "search" && (await hit("search:global", 86400)) > DAILY_SEARCH_CAP) {
      return deny(429, "ThisBut has reached today’s search limit. Please try again tomorrow.", "daily_cap");
    }
  } catch (e) {
    console.warn("[guard] rate limiter unavailable:", (e as Error).message); // fail open
  }
  return null;
}
