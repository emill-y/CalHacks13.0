/**
 * Precompute CLIP image embeddings for every catalog product.
 * Output: data/embeddings.f32 (Float32Array, N x 512, L2-normalized, catalog.json order)
 *         data/embeddings.manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { CLIP_DTYPE, CLIP_MODEL_ID, EMBED_DIM, embedImages } from "../lib/clip";
import type { Product } from "../lib/types";

async function main() {
  const root = process.cwd();
  const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(root, "data/catalog.json"), "utf8"));
  const out = new Float32Array(catalog.length * EMBED_DIM);
  const batch = 16;
  const t0 = Date.now();
  for (let i = 0; i < catalog.length; i += batch) {
    const slice = catalog.slice(i, i + batch);
    const bufs = slice.map((p) => fs.readFileSync(path.join(root, "public", p.image)));
    const vecs = await embedImages(bufs);
    vecs.forEach((v, j) => out.set(v, (i + j) * EMBED_DIM));
    if ((i / batch) % 10 === 0) {
      const rate = (i + slice.length) / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r${i + slice.length}/${catalog.length}  ${rate.toFixed(1)} img/s   `);
    }
  }
  fs.writeFileSync(path.join(root, "data/embeddings.f32"), Buffer.from(out.buffer));
  const manifest = {
    model: CLIP_MODEL_ID,
    dtype: CLIP_DTYPE,
    dim: EMBED_DIM,
    count: catalog.length,
    normalized: true,
    order: "data/catalog.json",
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, "data/embeddings.manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nwrote data/embeddings.f32 (${catalog.length} x ${EMBED_DIM}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
