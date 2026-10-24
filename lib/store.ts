import fs from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { Event, Product, Wish } from "./types";

/** A merchant-added product: metadata, CLIP embedding and the (merchant's) image. */
export interface StoredProduct {
  product: Product;
  embedding: number[];
  imageBase64: string;
}

export interface Store {
  kind: "upstash" | "file";
  listWishes(): Promise<Wish[]>;
  putWish(w: Wish): Promise<void>;
  deleteWishes(ids: string[]): Promise<void>;
  addEvent(e: Event): Promise<void>;
  listEvents(): Promise<Event[]>;
  replaceEvents(events: Event[]): Promise<void>;
  listProducts(): Promise<StoredProduct[]>;
  putProduct(p: StoredProduct): Promise<void>;
}

const K = { wishes: "tb:wishes", events: "tb:events", products: "tb:products" };

function upstashStore(): Store {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const vals = <T>(h: Record<string, unknown> | null): T[] =>
    Object.values(h ?? {}).map((v) => (typeof v === "string" ? JSON.parse(v) : v) as T);
  return {
    kind: "upstash",
    listWishes: async () => vals<Wish>(await redis.hgetall(K.wishes)),
    putWish: async (w) => void (await redis.hset(K.wishes, { [w.id]: JSON.stringify(w) })),
    deleteWishes: async (ids) => void (ids.length && (await redis.hdel(K.wishes, ...ids))),
    addEvent: async (e) => void (await redis.rpush(K.events, JSON.stringify(e))),
    listEvents: async () =>
      ((await redis.lrange(K.events, 0, -1)) as unknown[]).map(
        (v) => (typeof v === "string" ? JSON.parse(v) : v) as Event,
      ),
    replaceEvents: async (events) => {
      const tx = redis.multi();
      tx.del(K.events);
      if (events.length) tx.rpush(K.events, ...events.map((e) => JSON.stringify(e)));
      await tx.exec();
    },
    listProducts: async () => vals<StoredProduct>(await redis.hgetall(K.products)),
    putProduct: async (p) => void (await redis.hset(K.products, { [p.product.id]: JSON.stringify(p) })),
  };
}

interface FileDb {
  wishes: Record<string, Wish>;
  events: Event[];
  products: Record<string, StoredProduct>;
}

function fileStore(): Store {
  const file = path.join(process.cwd(), ".data", "db.json");
  let cache: FileDb | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  async function load(): Promise<FileDb> {
    if (cache) return cache;
    try {
      cache = JSON.parse(await fs.readFile(file, "utf8")) as FileDb;
    } catch {
      cache = { wishes: {}, events: [], products: {} };
    }
    return cache;
  }
  // Serialize mutations; write atomically.
  function mutate(fn: (db: FileDb) => void): Promise<void> {
    const next = chain.then(async () => {
      const db = await load();
      fn(db);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db));
      await fs.rename(tmp, file);
    });
    chain = next.catch(() => {});
    return next;
  }
  return {
    kind: "file",
    listWishes: async () => Object.values((await load()).wishes),
    putWish: (w) => mutate((db) => void (db.wishes[w.id] = w)),
    deleteWishes: (ids) => mutate((db) => ids.forEach((id) => delete db.wishes[id])),
    addEvent: (e) => mutate((db) => void db.events.push(e)),
    listEvents: async () => (await load()).events,
    replaceEvents: (events) => mutate((db) => void (db.events = events)),
    listProducts: async () => Object.values((await load()).products),
    putProduct: (p) => mutate((db) => void (db.products[p.product.id] = p)),
  };
}

const g = globalThis as unknown as { __store?: Store };
export function getStore(): Store {
  if (!g.__store) {
    g.__store =
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? upstashStore() : fileStore();
  }
  return g.__store;
}
