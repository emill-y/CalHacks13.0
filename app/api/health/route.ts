import { hasApiKey, MODEL } from "@/lib/anthropic";
import { getCatalog } from "@/lib/catalog";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  let products = 0;
  let catalogError: string | undefined;
  try {
    products = (await getCatalog()).products.length;
  } catch (e) {
    catalogError = (e as Error).message;
  }
  return Response.json({
    ok: hasApiKey() && !catalogError,
    apiKey: hasApiKey(),
    model: MODEL,
    products,
    catalogError,
    store: getStore().kind,
  });
}
