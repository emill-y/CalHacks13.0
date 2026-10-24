import { getStore } from "./store";

/** Everything stored about one device. */
export async function exportDevice(deviceId: string) {
  const store = getStore();
  const [wishes, events] = await Promise.all([store.listWishes(), store.listEvents()]);
  return {
    deviceId,
    exportedAt: new Date().toISOString(),
    note: "ThisBut stores only edit specs (text) and anonymous events. Photos are never stored.",
    wishes: wishes.filter((w) => !w.demo && w.deviceId === deviceId),
    events: events.filter((e) => e.deviceId === deviceId),
  };
}

export async function deleteDevice(deviceId: string) {
  const store = getStore();
  const wishes = (await store.listWishes()).filter((w) => !w.demo && w.deviceId === deviceId);
  await store.deleteWishes(wishes.map((w) => w.id));
  const events = await store.listEvents();
  const kept = events.filter((e) => e.deviceId !== deviceId);
  await store.replaceEvents(kept);
  return { deletedWishes: wishes.length, deletedEvents: events.length - kept.length };
}
