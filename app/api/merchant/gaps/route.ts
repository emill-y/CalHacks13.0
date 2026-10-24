import { getCatalog } from "@/lib/catalog";
import { getStore } from "@/lib/store";
import { aggregateGaps, ensureDemoSeed } from "@/lib/wishes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDemoSeed();
    const gaps = aggregateGaps(await getStore().listWishes());
    const { products, byId } = await getCatalog();
    return Response.json({
      gaps: gaps.map((g) => ({
        ...g,
        nearestProduct: g.nearestProductId && byId.has(g.nearestProductId) ? products[byId.get(g.nearestProductId)!] : null,
      })),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
