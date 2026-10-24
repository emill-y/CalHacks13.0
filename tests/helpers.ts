import type { Store, StoredProduct } from "../lib/store";
import type { EditSpec, Event, Wish } from "../lib/types";

export function memoryStore(): Store {
  const wishes = new Map<string, Wish>();
  let events: Event[] = [];
  const products = new Map<string, StoredProduct>();
  return {
    kind: "file",
    listWishes: async () => [...wishes.values()],
    putWish: async (w) => void wishes.set(w.id, w),
    deleteWishes: async (ids) => ids.forEach((id) => wishes.delete(id)),
    addEvent: async (e) => void events.push(e),
    listEvents: async () => events,
    replaceEvents: async (e) => void (events = e),
    listProducts: async () => [...products.values()],
    putProduct: async (p) => void products.set(p.product.id, p),
  };
}

export function installStore(s: Store) {
  (globalThis as unknown as { __store?: Store }).__store = s;
}

export function spec(over: Partial<EditSpec> = {}): EditSpec {
  return {
    source: { category: "Blouse", color: "white", pattern: "plain", details: ["bow"] },
    keep: ["white color"],
    remove: ["bow"],
    change: {},
    add: [],
    targetCaption: "a white long-sleeve blouse",
    label: "Blouse · remove bow",
    ...over,
  };
}

export function unit(dim: number, hot: number[], weights?: number[]): Float32Array {
  const v = new Float32Array(dim);
  hot.forEach((h, i) => (v[h] = weights?.[i] ?? 1));
  let n = 0;
  v.forEach((x) => (n += x * x));
  return v.map((x) => x / Math.sqrt(n));
}
