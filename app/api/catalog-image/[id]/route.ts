import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Serves merchant-added product images (catalog images are static files in /public/catalog). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = (await getStore().listProducts()).find((s) => s.product.id === id);
  if (!p) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(p.imageBase64, "base64")), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400, immutable" },
  });
}
