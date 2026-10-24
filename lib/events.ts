import { getStore } from "./store";
import type { Event } from "./types";

export async function logEvent(e: Omit<Event, "ts">) {
  try {
    await getStore().addEvent({ ...e, ts: Date.now() });
  } catch (err) {
    console.warn("[events] failed to log:", (err as Error).message);
  }
}
