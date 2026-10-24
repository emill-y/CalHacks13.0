import { z } from "zod";
import { CATEGORIES, type Category } from "./categories";
import type { EditSpec } from "./types";

const str = z.string().trim();

/** Wire format from the model (structured-outputs friendly: no open maps). */
export const WireSpecSchema = z.object({
  source: z.object({
    category: str,
    color: str,
    pattern: str,
    details: z.array(str),
  }),
  keep: z.array(str),
  remove: z.array(str),
  change: z.array(z.object({ attribute: str, value: str })),
  add: z.array(str),
  maxPrice: z.number().positive().nullable().optional(),
  targetCaption: str.min(3),
  label: str,
});
export type WireSpec = z.infer<typeof WireSpecSchema>;

export const SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["source", "keep", "remove", "change", "add", "maxPrice", "targetCaption", "label"],
  properties: {
    source: {
      type: "object",
      additionalProperties: false,
      required: ["category", "color", "pattern", "details"],
      properties: {
        category: { type: "string" },
        color: { type: "string" },
        pattern: { type: "string" },
        details: { type: "array", items: { type: "string" } },
      },
    },
    keep: { type: "array", items: { type: "string" } },
    remove: { type: "array", items: { type: "string" } },
    change: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attribute", "value"],
        properties: { attribute: { type: "string" }, value: { type: "string" } },
      },
    },
    add: { type: "array", items: { type: "string" } },
    maxPrice: { type: ["number", "null"] },
    targetCaption: { type: "string" },
    label: { type: "string" },
  },
} as const;

/** Full EditSpec validation (API input for priorSpec / spec overrides and stored wishes). */
export const EditSpecSchema = z.object({
  source: z.object({ category: str, color: str, pattern: str, details: z.array(str).max(20) }),
  keep: z.array(str.max(80)).max(20),
  remove: z.array(str.max(80)).max(20),
  change: z.record(str.max(40), str.max(80)),
  add: z.array(str.max(80)).max(20),
  maxPrice: z.number().positive().max(100000).optional(),
  targetCaption: str.max(400),
  label: str.max(200),
});

const ARTICLES = /^(?:the|a|an|its|this|that|any)\s+/i;
export function normTerm(s: string): string {
  return s.toLowerCase().replace(/[.!?]+$/, "").replace(ARTICLES, "").replace(/\s+/g, " ").trim();
}

const ATTR_ALIASES: Record<string, string> = {
  colour: "color",
  "sleeve length": "sleeves",
  sleeve: "sleeves",
  "sleeve type": "sleeves",
  hem: "length",
  "hem length": "length",
  silhouette: "fit",
  print: "pattern",
  neck: "neckline",
  fabric: "material",
};
export function normAttr(s: string): string {
  const a = normTerm(s);
  return ATTR_ALIASES[a] ?? a;
}

export function canonicalCategory(raw: string): Category {
  return categoryFromText(raw) ?? "Top";
}

/** Category named in free text (product titles), or null if none is recognizable. */
export function categoryFromText(raw: string): Category | null {
  const t = raw.toLowerCase();
  if (/\bt-?shirt|\btee\b/.test(t)) return "T-shirt";
  if (/jean|denim pant/.test(t)) return "Jeans";
  if (/dress|gown/.test(t)) return "Dress";
  if (/skirt/.test(t)) return "Skirt";
  if (/jacket|coat|blazer|parka|bomber/.test(t)) return "Jacket";
  if (/trouser|pant|chino|legging|jogger|shorts/.test(t)) return "Trousers"; // before knit: "knit pants"
  if (/sweater|knit|cardigan|jumper|pullover|hoodie|sweatshirt/.test(t)) return "Knitwear";
  if (/blouse/.test(t)) return "Blouse";
  if (/shirt/.test(t)) return "Shirt";
  if (/skort/.test(t)) return "Skirt";
  if (/\b(top|tank|cami|camisole|corset|bustier|bodysuit|halter|tube|bralette|crop)\b/.test(t)) return "Top";
  return CATEGORIES.find((c) => c.toLowerCase() === t.trim()) ?? null;
}

/** Titles that are clearly not apparel (dropped from store catalogs). */
export function isNonApparelTitle(raw: string): boolean {
  return /\b(bracelet|necklace|earrings?|ring|anklet|jewel|bag|purse|tote|wallet|shoes?|boots?|sandals?|sneakers?|heels|sunglasses|glasses|hat|cap|beanie|belt|socks?|gift ?card|phone|case|candle|perfume|fragrance|keychain|hair ?clip|scrunchie)\b/i.test(
    raw,
  );
}

const RELATIVE = new Set(["longer", "shorter", "looser", "tighter"]);
const ATTR_ORDER = ["color", "length", "sleeves", "fit"];

function changeVerb(attr: string, value: string): string {
  const v = normTerm(value);
  if (attr === "color") return `in ${v}`;
  if ((attr === "length" || attr === "fit") && RELATIVE.has(v)) return v;
  if (attr === "sleeves") return `sleeves ${v.replace(/\s*sleeves?$/, "")}`;
  return `${attr} ${v}`;
}

/**
 * Canonical label: "<Category> · <verb> <object>" joined with " + ".
 * Deterministic from the spec so identical wishes group together in Demand Gaps.
 */
export function canonicalLabel(spec: Pick<EditSpec, "source" | "remove" | "add" | "change" | "maxPrice">): string {
  const cat = canonicalCategory(spec.source.category);
  const parts: string[] = [];
  [...spec.remove].map(normTerm).sort().forEach((r) => parts.push(`remove ${r}`));
  [...spec.add].map(normTerm).sort().forEach((a) => parts.push(`add ${a}`));
  Object.entries(spec.change)
    .map(([k, v]) => [normAttr(k), v] as const)
    .sort(([a], [b]) => {
      const ia = ATTR_ORDER.indexOf(a);
      const ib = ATTR_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    })
    .forEach(([k, v]) => parts.push(changeVerb(k, v)));
  if (spec.maxPrice) parts.push(`under $${Math.round(spec.maxPrice)}`);
  return `${cat} · ${parts.length ? parts.join(" + ") : "as is"}`;
}

const NEGATION = /\b(?:no|not|without|non|never|minus|lacking|free of)\b/gi;
/** targetCaption must be positive; strip negated phrases defensively. */
export function positiveCaption(caption: string, removed: string[]): string {
  let c = caption;
  for (const r of removed) {
    c = c.replace(new RegExp(`\\b(?:no|without|minus)\\s+(?:a|an|the)?\\s*${escapeRe(r)}\\b`, "gi"), "");
  }
  c = c.replace(NEGATION, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[,\s]+|[,\s]+$/g, "");
  return c || caption;
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "bows" -> "bow", "pockets" -> "pocket" (keeps "dress", "sleeves" as-is) so labels group. */
export function singular(t: string): string {
  if (/(ss|us|is|sleeves|jeans|shorts|trousers|pants)$/.test(t) || t.length <= 3) return t;
  return t.replace(/ies$/, "y").replace(/(ch|sh|x)es$/, "$1").replace(/s$/, "");
}
const uniq = (xs: string[]) => [...new Set(xs.map(normTerm).filter(Boolean))];
const uniqParts = (xs: string[]) => [...new Set(xs.map((x) => singular(normTerm(x))).filter(Boolean))];

export function fromWire(w: WireSpec): EditSpec {
  const remove = uniqParts(w.remove);
  const change: Record<string, string> = {};
  for (const { attribute, value } of w.change) {
    if (attribute && value) change[normAttr(attribute)] = normTerm(value);
  }
  const base: EditSpec = {
    source: {
      category: canonicalCategory(w.source.category),
      color: normTerm(w.source.color),
      pattern: normTerm(w.source.pattern),
      details: uniq(w.source.details),
    },
    keep: uniq(w.keep).filter((k) => !remove.includes(k)),
    remove,
    change,
    add: uniqParts(w.add).filter((a) => !remove.includes(a)),
    ...(w.maxPrice ? { maxPrice: w.maxPrice } : {}),
    targetCaption: positiveCaption(w.targetCaption, remove),
    label: "",
  };
  base.label = canonicalLabel(base);
  return base;
}

/**
 * Merge a refinement into the prior spec so earlier edits persist.
 * Later edits win on conflicts (e.g. re-adding something previously removed).
 */
export function mergeSpec(prior: EditSpec, next: EditSpec): EditSpec {
  const remove = uniq([...prior.remove.filter((r) => !next.add.includes(r)), ...next.remove]);
  const add = uniq([...prior.add.filter((a) => !next.remove.includes(a)), ...next.add]);
  const change = { ...prior.change, ...next.change };
  const keep = uniq([...prior.keep, ...next.keep]).filter((k) => !remove.includes(k) && !(k in change));
  const merged: EditSpec = {
    source: prior.source,
    keep,
    remove,
    change,
    add,
    ...(next.maxPrice ?? prior.maxPrice ? { maxPrice: next.maxPrice ?? prior.maxPrice } : {}),
    targetCaption: positiveCaption(next.targetCaption || prior.targetCaption, remove),
    label: "",
  };
  merged.label = canonicalLabel(merged);
  return merged;
}

/** Human-readable checks the verifier must evaluate, in order. */
export function buildChecks(spec: EditSpec): string[] {
  const checks = [`is a ${spec.source.category.toLowerCase()}`];
  spec.keep.forEach((k) => checks.push(`keeps ${k}`));
  spec.remove.forEach((r) => checks.push(`has no ${r}`));
  Object.entries(spec.change).forEach(([k, v]) => {
    if (RELATIVE.has(v)) checks.push(`${k} is ${v} than the source`);
    else if (k === "color") checks.push(`color is ${v} (close shades OK)`);
    else checks.push(`${k} is ${v}`);
  });
  spec.add.forEach((a) => checks.push(`has ${a}`));
  return checks;
}
