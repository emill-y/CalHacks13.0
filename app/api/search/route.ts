import { z } from "zod";
import { logEvent } from "@/lib/events";
import { errorPayload, runSearch } from "@/lib/search";
import { EditSpecSchema } from "@/lib/spec";
import type { SearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  deviceId: z.string().max(64).default("anonymous"),
  image: z.string().max(12_000_000).optional(),
  mediaType: z.string().max(40).optional(),
  productId: z.string().max(64).optional(),
  editText: z.string().max(500).default(""),
  priorSpec: EditSpecSchema.optional(),
  spec: EditSpecSchema.optional(),
  imageUrl: z.string().url().max(4000).optional(),
  sourceTitle: z.string().max(300).optional(),
  sourcePageUrl: z.string().url().max(4000).optional(),
  store: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: `Bad request: ${(e as Error).message.slice(0, 200)}` }, { status: 400 });
  }
  if (!body.image && !body.productId && !body.imageUrl) {
    return Response.json({ error: "Provide an image, an imageUrl or a productId." }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: SearchEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const done = await runSearch(body, emit, { signal: req.signal });
        await logEvent({ deviceId: body.deviceId, kind: "search", label: done.spec.label });
        await logEvent({
          deviceId: body.deviceId,
          kind: done.fullMatchCount > 0 ? "full_match" : "no_match",
          label: done.spec.label,
        });
      } catch (e) {
        console.error("[search]", e);
        emit({ stage: "error", ...errorPayload(e) });
      } finally {
        // Drop our reference to the upload; nothing was written anywhere.
        body.image = undefined;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
