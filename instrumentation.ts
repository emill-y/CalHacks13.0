/** Pre-warm CLIP and the catalog when the Node server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prewarm } = await import("./lib/prewarm");
    await prewarm();
  }
}
