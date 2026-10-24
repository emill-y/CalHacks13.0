import fs from "node:fs";
import path from "node:path";
import { EMBED_DIM } from "./clip";
import { getStore } from "./store";
import { getStoreImage } from "./stores";
import type { Product } from "./types";

export class CatalogError extends Error {
  code = "no_catalog" as const;
}

interface Catalog {
  products: Product[];
  byId: Map<string, number>;
  /** row-major N x 512, L2-normalized */
  embeddings: Float32Array;
}

const g = globalThis as unknown as { __catalog?: Promise<Catalog> };

async function load(): Promise<Catalog> {
  const root = process.cwd();
  const catPath = path.join(root, "data", "catalog.json");
  const embPath = path.join(root, "data", "embeddings.f32");
  if (!fs.existsSync(catPath) || !fs.existsSync(embPath)) {
    throw new CatalogError(
      "Catalog not built. Run `python3 scripts/prepare_catalog.py` and `npm run embed`.",
    );
  }
  const base: Product[] = JSON.parse(fs.readFileSync(catPath, "utf8"));
  const buf = fs.readFileSync(embPath);
  const baseEmb = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (baseEmb.length !== base.length * EMBED_DIM) {
    throw new CatalogError("data/embeddings.f32 does not match data/catalog.json; re-run `npm run embed`.");
  }
  let added: Awaited<ReturnType<ReturnType<typeof getStore>["listProducts"]>> = [];
  try {
    added = await getStore().listProducts();
  } catch (e) {
    console.warn("[catalog] could not load merchant products:", (e as Error).message);
  }
  const products = [...base, ...added.map((a) => a.product)];
  const embeddings = new Float32Array(products.length * EMBED_DIM);
  embeddings.set(baseEmb, 0);
  added.forEach((a, i) => embeddings.set(a.embedding, (base.length + i) * EMBED_DIM));
  return { products, byId: new Map(products.map((p, i) => [p.id, i])), embeddings };
}

export function getCatalog(): Promise<Catalog> {
  if (!g.__catalog) {
    g.__catalog = load().catch((e) => {
      g.__catalog = undefined;
      throw e;
    });
  }
  return g.__catalog;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const c = await getCatalog();
  const i = c.byId.get(id);
  return i === undefined ? undefined : c.products[i];
}

export async function getEmbedding(id: string): Promise<Float32Array | undefined> {
  const c = await getCatalog();
  const i = c.byId.get(id);
  return i === undefined ? undefined : c.embeddings.subarray(i * EMBED_DIM, (i + 1) * EMBED_DIM);
}

/** Append a merchant product to the in-memory catalog (persisting is the caller's job). */
export async function addToCatalog(product: Product, embedding: Float32Array) {
  const c = await getCatalog();
  const next = new Float32Array(c.embeddings.length + EMBED_DIM);
  next.set(c.embeddings, 0);
  next.set(embedding, c.embeddings.length);
  c.embeddings = next;
  c.byId.set(product.id, c.products.length);
  c.products.push(product);
}

/** Reads a local catalog image (for sending product photos to the verifier). */
export async function readProductImage(p: Product): Promise<Buffer> {
  if (p.store) return getStoreImage(p);
  if (p.image.startsWith("/catalog/")) {
    return fs.promises.readFile(path.join(process.cwd(), "public", p.image));
  }
  const id = p.image.split("/").pop()!;
  const stored = (await getStore().listProducts()).find((s) => s.product.id === id);
  if (!stored) throw new Error(`image for ${p.id} not found`);
  return Buffer.from(stored.imageBase64, "base64");
}
