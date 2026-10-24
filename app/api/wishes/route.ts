import { logEvent } from "@/lib/events";
import { EditSpecSchema } from "@/lib/spec";
import { getStore } from "@/lib/store";
import { makeWish, NewWishSchema } from "@/lib/wishes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId) return Response.json({ error: "deviceId required" }, { status: 400 });
  const wishes = (await getStore().listWishes())
    .filter((w) => !w.demo && w.deviceId === deviceId)
    .sort((a, b) => b.ts - a.ts);
  return Response.json({ wishes }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const parsed = NewWishSchema.safeParse(await req.json().catch(() => null));
  const spec = EditSpecSchema.safeParse(parsed.success ? parsed.data.spec : null);
  if (!parsed.success || !spec.success) {
    return Response.json({ error: "Invalid wish" }, { status: 400 });
  }
  // Only the edit spec (text) is stored — never the shopper's photo.
  const wish = makeWish({ ...parsed.data, spec: spec.data });
  await getStore().putWish(wish);
  await logEvent({ deviceId: wish.deviceId, kind: "wish", label: wish.label });
  return Response.json({ wish });
}
