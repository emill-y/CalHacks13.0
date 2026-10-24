import sharp from "sharp";
import { z } from "zod";
import { addToCatalog } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";
import { embedImage } from "@/lib/clip";
import { errorPayload } from "@/lib/search";
import { getStore } from "@/lib/store";
import type { Product } from "@/lib/types";
import { fulfillWishes } from "@/lib/wishes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  image: z.string().min(100).max(12_000_000),
  name: z.string().trim().min(2).max(80),
  price: z.number().positive().max(10000),
  category: z.enum(CATEGORIES),
  color: z.string().trim().max(30).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Image, name, price and category are required." }, { status: 400 });
  const b = parsed.data;
  try {
    const jpeg = await sharp(Buffer.from(b.image, "base64"))
      .rotate()
      .resize(384, 384, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
    const embedding = await embedImage(jpeg);
    const id = `m${Date.now().toString(36)}`;
    const product: Product = {
      id,
      name: b.name,
      category: b.category,
      color: (b.color || "").toLowerCase() || "multi",
      price: Math.round(b.price * 100) / 100,
      image: `/api/catalog-image/${id}`,
      caption: `${b.color ? `${b.color.toLowerCase()} ` : ""}${b.name.toLowerCase()}`,
    };
    await getStore().putProduct({ product, embedding: Array.from(embedding), imageBase64: jpeg.toString("base64") });
    await addToCatalog(product, embedding);

    let fulfillment: { checked: number; fulfilled: { id: string; label: string }[] ; error?: string } = { checked: 0, fulfilled: [] };
    try {
      const r = await fulfillWishes(product, embedding, { data: jpeg.toString("base64"), mediaType: "image/jpeg" });
      fulfillment = { checked: r.checked, fulfilled: r.fulfilled.map((w) => ({ id: w.id, label: w.label })) };
    } catch (e) {
      fulfillment.error = errorPayload(e).error;
    }
    return Response.json({ product, ...fulfillment });
  } catch (e) {
    return Response.json(errorPayload(e), { status: 500 });
  }
}
