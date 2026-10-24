import { describe, expect, it, vi } from "vitest";

const req = (origin?: string, ip = "1.2.3.4") =>
  new Request("http://thisbut.test/api/search", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), "x-forwarded-for": ip, host: "thisbut.test" },
  });

describe("abuse guard", () => {
  it("rate limits per device and per IP, then recovers for other clients", async () => {
    vi.resetModules();
    process.env.RATE_SEARCH_PER_DEVICE_HOUR = "2";
    process.env.RATE_SEARCH_PER_IP_HOUR = "3";
    delete process.env.ALLOWED_ORIGINS;
    const { guard } = await import("../lib/guard");
    expect(await guard(req(), "search", "dev-a")).toBeNull();
    expect(await guard(req(), "search", "dev-a")).toBeNull();
    const third = await guard(req(), "search", "dev-a");
    expect(third?.status).toBe(429);
    expect((await third!.json()).code).toBe("rate_limited");
    expect(await guard(req(undefined, "9.9.9.9"), "search", "dev-b")).toBeNull();
  });

  it("enforces the origin allowlist when configured", async () => {
    vi.resetModules();
    process.env.ALLOWED_ORIGINS = "chrome-extension://abcdefghijklmnop";
    const { guard } = await import("../lib/guard");
    expect(await guard(req("chrome-extension://abcdefghijklmnop", "5.5.5.5"), "wish")).toBeNull();
    expect(await guard(req("http://thisbut.test", "5.5.5.6"), "wish")).toBeNull(); // the web app itself
    expect((await guard(req("https://evil.example", "5.5.5.7"), "wish"))?.status).toBe(403);
    delete process.env.ALLOWED_ORIGINS;
  });
});
