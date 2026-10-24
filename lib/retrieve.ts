import { EMBED_DIM, embedTexts } from "./clip";
import { getCatalog } from "./catalog";
import { canonicalCategory } from "./spec";
import type { EditSpec, Product } from "./types";

export const W = { img: 0.5, text: 0.5, remove: 0.25, category: 0.05 };

export interface Scored {
  product: Product;
  score: number;
  idx: number;
}

/**
 * score = 0.5*cos(v_img,p) + 0.5*cos(v_t,p) - 0.25*max_i cos(v_r_i,p) + 0.05*[category match]
 * Vectors are L2-normalized, so cos = dot product.
 */
export function scoreOne(
  emb: Float32Array,
  offset: number,
  vImg: Float32Array | null,
  vText: Float32Array,
  vRemove: Float32Array[],
  categoryMatch: boolean,
): number {
  let ci = 0,
    ct = 0;
  for (let k = 0; k < EMBED_DIM; k++) {
    const p = emb[offset + k];
    if (vImg) ci += vImg[k] * p;
    ct += vText[k] * p;
  }
  let maxR = 0;
  for (const r of vRemove) {
    let cr = 0;
    for (let k = 0; k < EMBED_DIM; k++) cr += r[k] * emb[offset + k];
    if (cr > maxR) maxR = cr;
  }
  // Without a source image (shouldn't happen) let text carry the full weight.
  const imgPart = vImg ? W.img * ci : W.img * ct;
  return imgPart + W.text * ct - (vRemove.length ? W.remove * maxR : 0) + (categoryMatch ? W.category : 0);
}

export async function retrieve(
  spec: EditSpec,
  vImg: Float32Array | null,
  opts: { k?: number; excludeId?: string; catalog?: { products: Product[]; embeddings: Float32Array } } = {},
): Promise<Scored[]> {
  const k = opts.k ?? 40;
  const [vText, ...vRemove] = await embedTexts([
    `a product photo of ${spec.targetCaption}`,
    ...spec.remove.map((r) => `a photo of clothing with a ${r}`),
  ]);
  const { products, embeddings } = opts.catalog ?? (await getCatalog());
  const cat = canonicalCategory(spec.source.category);
  const out: Scored[] = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (spec.maxPrice && (p.price < 0 || p.price > spec.maxPrice)) continue; // hard filter (price < 0 = unknown)
    if (p.id === opts.excludeId) continue;
    out.push({ product: p, idx: i, score: scoreOne(embeddings, i * EMBED_DIM, vImg, vText, vRemove, p.category === cat) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}
