/**
 * npm run eval — 10 canned "This, but…" queries using catalog images as sources.
 * Full mode (ANTHROPIC_API_KEY set): real parse -> retrieve -> verify pipeline.
 * Always: ground-truth check of results against Fashionpedia's human part annotations
 * (e.g. does a "without the bow" result actually have no annotated bow?).
 * Output: console table + eval-results.json
 */
import fs from "node:fs";
import path from "node:path";
import { hasApiKey, MODEL } from "../lib/anthropic";
import { getCatalog, getEmbedding } from "../lib/catalog";
import { loadClip } from "../lib/clip";
import { retrieve } from "../lib/retrieve";
import { runSearch } from "../lib/search";
import { canonicalLabel, positiveCaption } from "../lib/spec";
import type { EditSpec, Product } from "../lib/types";

interface Meta {
  parts: string[];
  sleeve?: string | null;
}
const meta: Record<string, Meta> = JSON.parse(fs.readFileSync("data/catalog_meta.json", "utf8")).items;

interface Q {
  id: string;
  source: string | ((ps: Product[]) => Product | undefined);
  edit: string;
  /** annotated parts that must be absent in a correct result (ground truth) */
  absentParts?: string[];
  /** fallback spec for retrieval-only mode */
  spec: (p: Product) => Partial<EditSpec>;
}

const byCaption = (re: RegExp, cat?: string) => (ps: Product[]) =>
  ps.find((p) => re.test(p.caption) && (!cat || p.category === cat) && !(meta[p.id]?.parts ?? []).some((x) => x === "bow" || x === "ribbon"));

const QUERIES: Q[] = [
  { id: "hero-bow-blouse", source: "p1601", edit: "without the bow", absentParts: ["bow"], spec: () => ({ remove: ["bow"] }) },
  { id: "ribbon-top", source: "p0808", edit: "without the ribbon", absentParts: ["ribbon", "bow"], spec: () => ({ remove: ["ribbon"] }) },
  { id: "blue-bow-top", source: "p1388", edit: "this, but without the bow", absentParts: ["bow"], spec: () => ({ remove: ["bow"] }) },
  { id: "pink-ribbon-top", source: "p0348", edit: "no ribbon please", absentParts: ["ribbon", "bow"], spec: () => ({ remove: ["ribbon"] }) },
  { id: "bow-top-black", source: "p0178", edit: "without the bow, in black", absentParts: ["bow"], spec: () => ({ remove: ["bow"], change: { color: "black" } }) },
  { id: "bow-sweater", source: "p0826", edit: "without the little bows", absentParts: ["bow"], spec: () => ({ remove: ["bow"] }) },
  { id: "shirt-black", source: byCaption(/^white .*shirt/, "Shirt"), edit: "in black", spec: () => ({ change: { color: "black" } }) },
  { id: "tee-long-sleeves", source: byCaption(/short-sleeve/, "T-shirt"), edit: "longer sleeves", spec: () => ({ change: { sleeves: "long" } }) },
  { id: "dress-under-50", source: byCaption(/floral/, "Dress"), edit: "under $50", spec: () => ({ maxPrice: 50 }) },
  { id: "skirt-shorter-navy", source: byCaption(/knee-length|midi/, "Skirt"), edit: "shorter and in navy", spec: () => ({ change: { length: "shorter", color: "navy" } }) },
];

function retrievalSpec(p: Product, q: Q): EditSpec {
  const partial = q.spec(p);
  const remove = partial.remove ?? [];
  let caption = p.caption.replace(/ with (?:a )?(?:bow|ribbon)( and [a-z ]+)?/g, (_m, rest) => (rest ? ` with${rest.replace(" and", "")}` : ""));
  if (partial.change?.color) caption = caption.replace(new RegExp(`^${p.color}\\b`), partial.change.color);
  if (partial.change?.sleeves) caption = caption.replace(/short-sleeve/, "long-sleeve");
  const spec: EditSpec = {
    source: { category: p.category, color: p.color, pattern: "plain", details: meta[p.id]?.parts ?? [] },
    keep: [],
    remove,
    change: partial.change ?? {},
    add: [],
    ...(partial.maxPrice ? { maxPrice: partial.maxPrice } : {}),
    targetCaption: positiveCaption(caption, remove),
    label: "",
  };
  spec.label = canonicalLabel(spec);
  return spec;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const lacks = (id: string, parts: string[]) => !(meta[id]?.parts ?? []).some((x) => parts.includes(x));

async function main() {
  const full = hasApiKey() && !process.argv.includes("--retrieval-only");
  const { products } = await getCatalog();
  await loadClip();
  console.log(`ThisBut eval — mode: ${full ? `FULL (model ${MODEL})` : "RETRIEVAL-ONLY (no ANTHROPIC_API_KEY)"}\n`);

  const rows = [];
  for (const q of QUERIES) {
    const src = typeof q.source === "string" ? products.find((p) => p.id === q.source) : q.source(products);
    if (!src) {
      console.log(`skip ${q.id}: no source product`);
      continue;
    }
    const t0 = Date.now();
    let row: Record<string, unknown> = { id: q.id, source: src.id, sourceCaption: src.caption, edit: q.edit };
    try {
      if (full) {
        const done = await runSearch({ productId: src.id, editText: q.edit }, () => {});
        const verified = done.results.filter((r) => !r.unverified);
        const matches = verified.filter((r) => r.allPass);
        const checks = verified.flatMap((r) => r.checks);
        row = {
          ...row,
          label: done.spec.label,
          spec: done.spec,
          verified: done.verified,
          fullMatchCount: done.fullMatchCount,
          verifierPassRate: verified.length ? matches.length / verified.length : null,
          checkPassRate: checks.length ? checks.filter((c) => c.pass).length / checks.length : null,
          latencyMs: Date.now() - t0,
          timings: done.timings,
          matches: matches.map((m) => m.product.id),
          ...(q.absentParts
            ? {
                gtMatchPrecision: matches.length ? matches.filter((m) => lacks(m.product.id, q.absentParts!)).length / matches.length : null,
                gtTop16Clean: done.results.filter((r) => lacks(r.product.id, q.absentParts!)).length / Math.max(1, done.results.length),
              }
            : {}),
        };
      } else {
        const spec = retrievalSpec(src, q);
        const top = await retrieve(spec, (await getEmbedding(src.id)) ?? null, { excludeId: src.id });
        const top16 = top.slice(0, 16);
        row = {
          ...row,
          label: spec.label,
          targetCaption: spec.targetCaption,
          latencyMs: Date.now() - t0,
          top16: top16.map((s) => s.product.id),
          sameCategoryTop16: top16.filter((s) => s.product.category === src.category).length / top16.length,
          ...(q.absentParts ? { gtTop16Clean: top16.filter((s) => lacks(s.product.id, q.absentParts!)).length / top16.length } : {}),
          ...(spec.change.color ? { colorTop16: top16.filter((s) => s.product.color === spec.change.color).length / top16.length } : {}),
          ...(spec.maxPrice ? { underBudgetTop16: top16.every((s) => s.product.price <= spec.maxPrice!) } : {}),
        };
      }
    } catch (e) {
      row = { ...row, error: (e as Error).message, latencyMs: Date.now() - t0 };
    }
    rows.push(row);
    const fmt = (v: unknown) => (typeof v === "number" ? (v <= 1 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : String(v)) : String(v ?? "-"));
    console.log(
      `${q.id.padEnd(20)} ${String(row.label ?? "").padEnd(36)} ` +
        (full
          ? `matches=${fmt(row.fullMatchCount)} pass=${fmt(row.verifierPassRate)} gt=${fmt(row.gtMatchPrecision)} ${fmt(row.latencyMs)}ms`
          : `clean@16=${fmt(row.gtTop16Clean)} sameCat@16=${fmt(row.sameCategoryTop16)} ${fmt(row.latencyMs)}ms`) +
        (row.error ? `  ERROR ${row.error}` : ""),
    );
  }

  const ok = rows.filter((r) => !r.error);
  const num = (k: string) => ok.map((r) => r[k]).filter((v): v is number => typeof v === "number");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const hero = rows.find((r) => r.id === "hero-bow-blouse");
  const summary = full
    ? {
        mode: "full",
        model: MODEL,
        queries: rows.length,
        errors: rows.length - ok.length,
        totalFullMatches: num("fullMatchCount").reduce((a, b) => a + b, 0),
        queriesWith3PlusMatches: num("fullMatchCount").filter((n) => n >= 3).length,
        verifierPassRate: avg(num("verifierPassRate")),
        checkPassRate: avg(num("checkPassRate")),
        groundTruthMatchPrecision: avg(num("gtMatchPrecision")),
        medianLatencyMs: median(num("latencyMs")),
        heroFullMatches: hero?.fullMatchCount ?? null,
        heroLatencyMs: hero?.latencyMs ?? null,
      }
    : {
        mode: "retrieval-only",
        note: "ANTHROPIC_API_KEY not set: parse/verify skipped; specs derived from catalog captions.",
        queries: rows.length,
        groundTruthCleanAt16: avg(num("gtTop16Clean")),
        sameCategoryAt16: avg(num("sameCategoryTop16")),
        medianLatencyMs: median(num("latencyMs")),
      };
  console.log("\nSummary:", JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "eval-results.json"), JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 2));
  console.log("wrote eval-results.json");
  if (full && hero && (Number(hero.fullMatchCount) < 3 || Number(hero.latencyMs) > 15000)) {
    console.log(`\nCHECKPOINT NOT MET: hero query returned ${hero.fullMatchCount} matches in ${hero.latencyMs} ms (need >=3 in <15 s)`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
