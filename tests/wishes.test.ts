import { beforeEach, describe, expect, it } from "vitest";
import { EMBED_DIM } from "../lib/clip";
import type { Product, Wish } from "../lib/types";
import { aggregateGaps, fulfillWishes, makeWish, type FulfillChecker } from "../lib/wishes";
import { installStore, memoryStore, spec, unit } from "./helpers";

const product: Product = {
  id: "m1",
  name: "Plain White Blouse",
  category: "Blouse",
  color: "white",
  price: 39,
  image: "/api/catalog-image/m1",
  caption: "white plain blouse",
};
const productEmb = unit(EMBED_DIM, [0]);
const near = unit(EMBED_DIM, [0, 1], [0.9, 0.44]); // cos ~0.9
const far = unit(EMBED_DIM, [7]); // cos 0
const embed = async (t: string) => (t.includes("plaid") ? far : near);
const image = { data: "", mediaType: "image/jpeg" as const };

describe("wish fulfillment (mocked verifier)", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
    installStore(store);
  });

  it("prefilters by category, budget and cos >= 0.2, then marks verified wishes found", async () => {
    const ok = makeWish({ deviceId: "a", spec: spec(), nearestProductId: "p1" });
    const rejectedByModel = makeWish({ deviceId: "b", spec: spec({ change: { color: "red" } }) });
    const wrongCategory = makeWish({ deviceId: "c", spec: spec({ source: { category: "Dress", color: "", pattern: "", details: [] } }) });
    const overBudget = makeWish({ deviceId: "d", spec: spec({ maxPrice: 30 }) });
    const dissimilar = makeWish({ deviceId: "e", spec: spec({ targetCaption: "a plaid flannel blouse" }) });
    const demo: Wish = { ...makeWish({ deviceId: "demo", spec: spec() }), demo: true, demoCount: 99 };
    for (const w of [ok, rejectedByModel, wrongCategory, overBudget, dissimilar, demo]) await store.putWish(w);

    let seen: string[] = [];
    const checker: FulfillChecker = async ({ wishes }) => {
      seen = wishes.map((w) => w.id);
      return { satisfiedIds: [ok.id, "not-a-real-id"] };
    };
    const r = await fulfillWishes(product, productEmb, image, { checker, embed });
    expect(seen.sort()).toEqual([ok.id, rejectedByModel.id].sort());
    expect(r.fulfilled.map((w) => w.id)).toEqual([ok.id]);

    const after = new Map((await store.listWishes()).map((w) => [w.id, w]));
    expect(after.get(ok.id)).toMatchObject({ status: "found", foundProductId: "m1" });
    expect(after.get(rejectedByModel.id)?.status).toBe("open");
    expect(after.get(demo.id)?.status).toBe("open");
  });

  it("skips the model call entirely when nothing passes the prefilter", async () => {
    await store.putWish(makeWish({ deviceId: "a", spec: spec({ targetCaption: "plaid" }) }));
    let called = false;
    const r = await fulfillWishes(product, productEmb, image, {
      checker: async () => ((called = true), { satisfiedIds: [] }),
      embed,
    });
    expect(called).toBe(false);
    expect(r).toEqual({ checked: 0, fulfilled: [] });
  });

  it("sends at most 10 wishes to the verifier", async () => {
    for (let i = 0; i < 14; i++) await store.putWish(makeWish({ deviceId: `d${i}`, spec: spec() }));
    let n = 0;
    await fulfillWishes(product, productEmb, image, { checker: async ({ wishes }) => ((n = wishes.length), { satisfiedIds: [] }), embed });
    expect(n).toBe(10);
  });
});

describe("demand gaps", () => {
  it("hides live groups under 3, keeps demo rows, and estimates demand", () => {
    const w = (deviceId: string, s = spec(), maxPay?: number) => makeWish({ deviceId, spec: s, maxPay });
    const big = [w("a", spec(), 40), w("b", spec(), 50), w("c", spec(), 60)];
    const small = [w("x", spec({ remove: ["ruffle"] })), w("y", spec({ remove: ["ruffle"] }))];
    const demo: Wish = { ...w("demo", spec({ add: ["hood"] }), 100), demo: true, demoCount: 20 };
    const gaps = aggregateGaps([...big, ...small, demo]);
    expect(gaps.map((g) => g.label)).toEqual(["Blouse · remove bow + add hood", "Blouse · remove bow"]);
    const live = gaps.find((g) => g.label === "Blouse · remove bow")!;
    expect(live).toMatchObject({ liveCount: 3, demoCount: 0, medianMaxPay: 50, estDemand: 150, hasDemo: false });
    expect(gaps[0]).toMatchObject({ hasDemo: true, demoCount: 20, liveCount: 0, estDemand: 2000 });
  });

  it("never trusts the client label", () => {
    expect(makeWish({ deviceId: "a", spec: { ...spec(), label: "Free money · lol" } }).label).toBe("Blouse · remove bow");
  });
});
