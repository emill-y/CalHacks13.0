import { deleteDevice, exportDevice } from "@/lib/privacy";

export const dynamic = "force-dynamic";

function deviceId(req: Request) {
  const id = new URL(req.url).searchParams.get("deviceId");
  return id && id.length <= 64 && id !== "demo" ? id : null;
}

export async function GET(req: Request) {
  const id = deviceId(req);
  if (!id) return Response.json({ error: "deviceId required" }, { status: 400 });
  return new Response(JSON.stringify(await exportDevice(id), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="thisbut-data-${id.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
}

export async function DELETE(req: Request) {
  const id = deviceId(req);
  if (!id) return Response.json({ error: "deviceId required" }, { status: 400 });
  return Response.json(await deleteDevice(id));
}
