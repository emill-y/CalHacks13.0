import { z } from "zod";
import { guard } from "@/lib/guard";
import { errorPayload } from "@/lib/search";
import { getStoreCatalog, indexStore, MAX_STORE_ITEMS, storeIdFor, type StoreKind } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Item = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().max(300).default(""),
  price: z.number().nullable().optional(),
  image: z.string().url().max(4000),
  url: z.string().url().max(4000).optional(),
  color: z.string().max(60).optional(),
});
const Body = z.object({
  origin: z.string().url(),
  kind: z.enum(["shopify", "woocommerce", "sitemap", "catalog", "page"]),
  pageUrl: z.string().url().optional(),
  items: z.array(Item).max(MAX_STORE_ITEMS * 2),
});

/** GET ?origin=&kind=&pageUrl= -> is this store already indexed? */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const id = storeIdFor(sp.get("origin")!, (sp.get("kind") as StoreKind) ?? "catalog", sp.get("pageUrl") ?? undefined);
    const c = await getStoreCatalog(id);
    return Response.json({ storeId: id, indexed: Boolean(c), kind: c?.kind ?? null, count: c?.products.length ?? 0, updatedAt: c?.updatedAt ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** POST a store's product list; streams NDJSON progress while photos are fetched + embedded. */
export async function POST(req: Request) {
  const blocked = await guard(req, "index");
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Invalid store payload: ${parsed.error.message.slice(0, 200)}` }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      let last = 0;
      try {
        const r = await indexStore(parsed.data, (done, total) => {
          const now = Date.now();
          if (now - last > 250 || done === total) {
            last = now;
            send({ stage: "index", done: Math.round(done), total });
          }
        });
        send({ stage: "done", storeId: r.catalog.id, count: r.catalog.products.length, added: r.added, reused: r.reused, skipped: r.skipped });
      } catch (e) {
        send({ stage: "error", ...errorPayload(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
