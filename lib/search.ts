import sharp from "sharp";
import { hasApiKey, ModelError, type ImageInput } from "./anthropic";
import { CatalogError, getEmbedding, getProduct, readProductImage } from "./catalog";
import { embedImage } from "./clip";
import { fetchImageJpeg } from "./fetchImage";
import { getStoreCatalog } from "./stores";
import { parseEdit } from "./parse";
import { retrieve } from "./retrieve";
import { canonicalLabel } from "./spec";
import type { EditSpec, SearchEvent } from "./types";
import { verify, type VerifierFn } from "./verify";

export interface SearchInput {
  image?: string;
  mediaType?: string;
  productId?: string;
  editText: string;
  priorSpec?: EditSpec;
  /** Skip parsing and use this spec (e.g. after removing a chip). */
  spec?: EditSpec;
  /** Public image URL (browser extension: the product photo the shopper clicked). */
  imageUrl?: string;
  /** Title of the clicked product, used as extra context for parsing. */
  sourceTitle?: string;
  /** Search this store catalog (indexed by the extension) instead of the built-in one. */
  store?: string;
}

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * The full pipeline: parse -> retrieve -> verify. Emits progress events.
 * The uploaded image lives only in memory for the duration of this call.
 */
export async function runSearch(
  input: SearchInput,
  emit: (e: SearchEvent) => void,
  opts: { verifier?: VerifierFn; signal?: AbortSignal } = {},
): Promise<Extract<SearchEvent, { stage: "done" }>> {
  if (!input.spec && !hasApiKey() && !opts.verifier) {
    throw new ModelError("ANTHROPIC_API_KEY is not set on the server.", "missing_api_key");
  }
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  let source: ImageInput;
  let vImgPromise: Promise<Float32Array | null>;
  let sourceCaption: string | undefined;

  if (input.productId) {
    const p = await getProduct(input.productId);
    if (!p) throw new CatalogError(`Unknown product ${input.productId}`);
    source = { data: (await readProductImage(p)).toString("base64"), mediaType: "image/jpeg" };
    sourceCaption = p.caption;
    vImgPromise = getEmbedding(p.id).then((v) => v ?? null);
  } else if (input.imageUrl) {
    const buf = await fetchImageJpeg(input.imageUrl, 768);
    source = { data: buf.toString("base64"), mediaType: "image/jpeg" };
    sourceCaption = input.sourceTitle;
    vImgPromise = embedImage(buf);
  } else if (input.image) {
    let buf: Buffer = Buffer.from(input.image, "base64");
    if (buf.length > 8 * 1024 * 1024) throw new Error("Image too large (max 8 MB).");
    // Normalize (and re-cap at 768 px) in memory; never written to disk.
    buf = await sharp(buf).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    source = { data: buf.toString("base64"), mediaType: "image/jpeg" };
    vImgPromise = embedImage(buf);
  } else {
    throw new Error("Provide an image, an imageUrl or a productId.");
  }
  const storeCatalog = input.store ? await getStoreCatalog(input.store) : undefined;
  if (input.store && !storeCatalog) throw new CatalogError(`Store catalog ${input.store} isn't indexed yet.`);
  if (storeCatalog && storeCatalog.products.length === 0) throw new CatalogError("No clothing products were found in this store catalog.");
  if (input.mediaType && !MEDIA.has(input.mediaType)) throw new Error("Unsupported image type.");
  vImgPromise.catch(() => {}); // surfaced below

  emit({ stage: "parse" });
  let spec: EditSpec;
  if (input.spec) {
    spec = { ...input.spec, label: canonicalLabel(input.spec) };
  } else {
    spec = await parseEdit({ image: source, editText: input.editText, priorSpec: input.priorSpec, sourceCaption, signal: opts.signal });
  }
  timings.parse = Date.now() - t0;

  const vImg = await vImgPromise;
  // Never return the item the shopper started from (store catalogs: same photo URL).
  const excludeId = input.productId ?? storeCatalog?.products.find((p) => p.image === input.imageUrl)?.id;
  const scored = await retrieve(spec, vImg, { excludeId, catalog: storeCatalog });
  timings.retrieve = Date.now() - t0 - timings.parse;
  emit({ stage: "retrieve", count: scored.length });

  emit({ stage: "verify", count: Math.min(16, scored.length) });
  const tv = Date.now();
  const { results, verified, error } = await verify(spec, source, scored, { verifier: opts.verifier });
  timings.verify = Date.now() - tv;
  timings.total = Date.now() - t0;
  if (error) console.warn("[search] verifier fell back to retrieval order:", error);

  const done = {
    stage: "done" as const,
    spec,
    results,
    fullMatchCount: results.filter((r) => r.allPass && !r.unverified).length,
    nearestProductId: scored[0]?.product.id ?? null,
    verified,
    timings,
    photoDiscarded: Boolean(input.image || input.imageUrl),
  };
  emit(done);
  return done;
}

export function errorPayload(e: unknown): { error: string; code?: string } {
  if (e instanceof ModelError) return { error: e.message, code: e.code };
  if (e instanceof CatalogError) return { error: e.message, code: e.code };
  return { error: (e as Error).message || "Unexpected error" };
}
