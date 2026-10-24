import { getCatalog } from "./catalog";
import { embedText, loadClip } from "./clip";

export async function prewarm() {
  if (process.env.SKIP_PREWARM === "1") return;
  const t0 = Date.now();
  try {
    await Promise.all([loadClip(), getCatalog()]);
    await embedText("a product photo of a shirt"); // first inference initializes kernels
    console.log(`[prewarm] CLIP + catalog ready in ${Date.now() - t0} ms`);
  } catch (e) {
    console.error("[prewarm] failed:", (e as Error).message);
  }
}
