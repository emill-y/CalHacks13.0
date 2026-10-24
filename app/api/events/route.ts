import { z } from "zod";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

// Clients may only log orders; search/wish events are logged server-side.
const Body = z.object({ deviceId: z.string().min(1).max(64), kind: z.literal("order"), label: z.string().max(120).optional() });

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "Invalid event" }, { status: 400 });
  await logEvent(b.data);
  return Response.json({ ok: true });
}
