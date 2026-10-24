import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CATEGORIES, type Category } from "./categories";
import { cosine, EMBED_DIM, embedImages, embedTexts } from "./clip";
import { fetchImageJpeg } from "./fetchImage";
import { categoryFromText, isNonApparelTitle } from "./spec";
import type { Product } from "./types";

/**
 * Per-store catalogs, built on demand by the browser extension from the store the shopper is on:
 * a Shopify store's public /products.json, or the product images on the current page.
 */
export interface StoreItemInput {
  id: string;
  title: string;
  price?: number | null;
  image: string;
  url?: string;
  color?: string;
}

interface StoreItem {
  product: Product;
  imageUrl: string;
  embedding: Float32Array;
  jpeg: Buffer;
}

/** Where a store's products came from. Everything but "page" is a whole-store catalog keyed by host. */
export type StoreKind = "shopify" | "woocommerce" | "sitemap" | "catalog" | "page";

export interface StoreCatalog {
  id: string;
  origin: string;
  kind: StoreKind;
  products: Product[];
  embeddings: Float32Array;
  items: Map<string, StoreItem>;
  updatedAt: number;
}

export const MAX_STORE_ITEMS = 600;
const DIR = path.join(process.cwd(), ".data", "stores");
const g = globalThis as unknown as { __stores?: Map<string, StoreCatalog> };
const mem = (g.__stores ??= new Map());

export function storeIdFor(origin: string, kind: StoreKind, pageUrl?: string): string {
  const host = new URL(origin).host.toLowerCase();
  if (kind !== "page") return host;
  const p = pageUrl ? new URL(pageUrl) : null;
  const key = p ? `${p.pathname}${p.search}` : "/";
  return `${host}~page-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
}

function file(id: string) {
  return path.join(DIR, `${id.replace(/[^a-z0-9.~_-]/gi, "_")}.json`);
}

function build(id: string, origin: string, kind: StoreCatalog["kind"], items: StoreItem[]): StoreCatalog {
  const embeddings = new Float32Array(items.length * EMBED_DIM);
  items.forEach((it, i) => embeddings.set(it.embedding, i * EMBED_DIM));
  return {
    id,
    origin,
    kind,
    products: items.map((i) => i.product),
    embeddings,
    items: new Map(items.map((i) => [i.product.id, i])),
    updatedAt: Date.now(),
  };
}

async function persist(c: StoreCatalog) {
  await fs.mkdir(DIR, { recursive: true });
  const data = {
    id: c.id,
    origin: c.origin,
    kind: c.kind,
    updatedAt: c.updatedAt,
    items: [...c.items.values()].map((i) => ({
      product: i.product,
      imageUrl: i.imageUrl,
      embedding: Buffer.from(i.embedding.buffer, i.embedding.byteOffset, i.embedding.byteLength).toString("base64"),
      jpeg: i.jpeg.toString("base64"),
    })),
  };
  const tmp = `${file(c.id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file(c.id));
}

export async function getStoreCatalog(id: string): Promise<StoreCatalog | undefined> {
  const hit = mem.get(id);
  if (hit) return hit;
  try {
    const raw = JSON.parse(await fs.readFile(file(id), "utf8")) as {
      id: string;
      origin: string;
      kind: StoreCatalog["kind"];
      items: { product: Product; imageUrl: string; embedding: string; jpeg: string }[];
    };
    const items: StoreItem[] = raw.items.map((i) => {
      const b = Buffer.from(i.embedding, "base64");
      return {
        product: i.product,
        imageUrl: i.imageUrl,
        embedding: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
        jpeg: Buffer.from(i.jpeg, "base64"),
      };
    });
    const c = build(raw.id, raw.origin, raw.kind, items);
    mem.set(id, c);
    return c;
  } catch {
    return undefined;
  }
}

export async function getStoreImage(p: Product): Promise<Buffer> {
  const c = p.store ? await getStoreCatalog(p.store) : undefined;
  const it = c?.items.get(p.id);
  if (!it) throw new Error(`image for ${p.id} not found`);
  return it.jpeg;
}

// Zero-shot CLIP labels: garment categories vs. things that aren't clothing (jewelry, banners…).
const CATEGORY_PROMPTS: Record<Category, string> = {
  Top: "a product photo of a women's top",
  Blouse: "a product photo of a blouse",
  Shirt: "a product photo of a button-up shirt",
  "T-shirt": "a product photo of a t-shirt",
  Dress: "a product photo of a dress",
  Skirt: "a product photo of a skirt",
  Trousers: "a product photo of trousers or shorts",
  Jeans: "a product photo of jeans",
  Jacket: "a product photo of a jacket or coat",
  Knitwear: "a product photo of a sweater, hoodie or cardigan",
};
const NON_APPAREL = [
  "a product photo of jewelry",
  "a product photo of shoes",
  "a product photo of a handbag",
  "a photo of sunglasses",
  "a website logo, icon or banner graphic",
  "a photo of home decor",
];

async function zeroShot(emb: Float32Array): Promise<Category | null> {
  const labels = [...CATEGORIES.map((c) => CATEGORY_PROMPTS[c]), ...NON_APPAREL];
  const vs = await embedTexts(labels);
  let best = 0;
  vs.forEach((v, i) => {
    if (cosine(emb, v) > cosine(emb, vs[best])) best = i;
  });
  return best < CATEGORIES.length ? CATEGORIES[best] : null;
}

const COLOR_WORDS = ["black", "white", "cream", "ivory", "beige", "brown", "grey", "gray", "red", "burgundy", "maroon", "pink", "orange", "yellow", "green", "teal", "blue", "navy", "denim", "purple", "lilac", "silver", "gold", "charcoal"];
function colorFrom(text: string): string {
  const t = text.toLowerCase().replace(/-/g, " ");
  return COLOR_WORDS.find((c) => new RegExp(`\\b${c}\\b`).test(t))?.replace("gray", "grey") ?? "multi";
}

async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i], i);
      }
    }),
  );
  return out;
}

/**
 * Index (or incrementally refresh) a store catalog: download each product photo, embed it with the
 * same CLIP model as the built-in catalog, drop non-apparel, and cache to .data/stores.
 */
export async function indexStore(
  input: { origin: string; kind: StoreKind; pageUrl?: string; items: StoreItemInput[] },
  onProgress: (done: number, total: number) => void = () => {},
): Promise<{ catalog: StoreCatalog; added: number; reused: number; skipped: number }> {
  const id = storeIdFor(input.origin, input.kind, input.pageUrl);
  const prev = await getStoreCatalog(id);
  const byUrl = new Map([...(prev?.items.values() ?? [])].map((i) => [i.imageUrl, i]));
  const seen = new Set<string>();
  const wanted = input.items
    .filter((i) => i.image && !seen.has(i.image) && seen.add(i.image))
    .filter((i) => !isNonApparelTitle(i.title || ""))
    .slice(0, MAX_STORE_ITEMS);

  let done = 0;
  let reused = 0;
  let skipped = 0;
  const fresh: { input: StoreItemInput; jpeg: Buffer }[] = [];
  const kept: StoreItem[] = [];

  await pool(wanted, 8, async (it) => {
    const cached = byUrl.get(it.image);
    if (cached) {
      // refresh title/price but reuse pixels + embedding
      kept.push({ ...cached, product: { ...cached.product, name: it.title || cached.product.name, price: it.price ?? cached.product.price, url: it.url ?? cached.product.url } });
      reused++;
    } else {
      try {
        fresh.push({ input: it, jpeg: await fetchImageJpeg(it.image, 384) });
      } catch {
        skipped++;
      }
    }
    onProgress(++done, wanted.length * 2);
  });

  const batch = 16;
  for (let i = 0; i < fresh.length; i += batch) {
    const slice = fresh.slice(i, i + batch);
    const embs = await embedImages(slice.map((s) => s.jpeg));
    for (let j = 0; j < slice.length; j++) {
      const { input: it, jpeg } = slice[j];
      const title = (it.title || "").trim();
      const category = categoryFromText(title) ?? (await zeroShot(embs[j]));
      if (!category) {
        skipped++;
        continue;
      }
      const color = (it.color && it.color.toLowerCase().replace(/-/g, " ")) || colorFrom(title);
      const pid = `${id}:${String(it.id).slice(0, 64)}`;
      kept.push({
        product: {
          id: pid,
          name: title || `${category} from ${new URL(input.origin).host}`,
          category,
          color,
          price: typeof it.price === "number" && isFinite(it.price) ? it.price : -1,
          image: it.image,
          caption: `${color !== "multi" ? `${color} ` : ""}${title || category}`.toLowerCase(),
          url: it.url,
          store: id,
        },
        imageUrl: it.image,
        embedding: embs[j],
        jpeg,
      });
    }
    onProgress(wanted.length + Math.min(fresh.length, i + batch) * (wanted.length / Math.max(1, fresh.length)), wanted.length * 2);
  }
  onProgress(wanted.length * 2, wanted.length * 2);

  const catalog = build(id, input.origin, input.kind, kept);
  mem.set(id, catalog);
  await persist(catalog).catch((e) => console.warn("[stores] persist failed:", (e as Error).message));
  return { catalog, added: kept.length - reused, reused, skipped };
}
