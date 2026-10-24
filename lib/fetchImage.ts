import net from "node:net";
import sharp from "sharp";

const MAX_BYTES = 10 * 1024 * 1024;

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(h)) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Fetch a public image URL (product photos from store pages) and normalize it to a JPEG.
 * Only http(s); private/loopback hosts are refused unless ALLOW_PRIVATE_FETCH=1 (local test shops).
 */
export async function fetchImageJpeg(
  url: string,
  maxSide: number,
  opts: { timeoutMs?: number; referer?: string } = {},
): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid image URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) image URLs are allowed");
  if (isPrivateHost(u.hostname) && process.env.ALLOW_PRIVATE_FETCH !== "1") throw new Error("Image host not allowed");
  const res = await fetch(u, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    // Many store CDNs refuse non-browser clients or hotlinks without the store as referrer.
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": BROWSER_UA,
      ...(opts.referer ? { referer: opts.referer } : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/") && !type.includes("octet-stream")) throw new Error("URL is not an image");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("Image too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Image too large");
  return sharp(buf)
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
}
