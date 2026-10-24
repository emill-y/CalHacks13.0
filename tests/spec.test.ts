import { describe, expect, it } from "vitest";
import { buildChecks, canonicalCategory, canonicalLabel, fromWire, mergeSpec, positiveCaption } from "../lib/spec";
import { spec } from "./helpers";

describe("canonical labels", () => {
  it("formats '<Category> · <verb> <object>' joined with ' + '", () => {
    expect(canonicalLabel(spec())).toBe("Blouse · remove bow");
    expect(
      canonicalLabel(spec({ remove: ["the Bow", "ribbon"], change: { colour: "Black", sleeves: "long" }, add: ["pockets"], maxPrice: 49.99 })),
    ).toBe("Blouse · remove bow + remove ribbon + add pockets + in black + sleeves long + under $50");
  });

  it("is order-independent so identical wishes group together", () => {
    const a = canonicalLabel(spec({ remove: ["ribbon", "bow"], change: { length: "longer", color: "navy" } }));
    const b = canonicalLabel(spec({ remove: ["bow", "ribbon"], change: { color: "navy", length: "longer" } }));
    expect(a).toBe(b);
    expect(a).toBe("Blouse · remove bow + remove ribbon + in navy + longer");
  });

  it("maps free-form categories onto the fixed list", () => {
    expect(canonicalCategory("tee")).toBe("T-shirt");
    expect(canonicalCategory("denim jeans")).toBe("Jeans");
    expect(canonicalCategory("cardigan")).toBe("Knitwear");
    expect(canonicalCategory("pussy-bow blouse")).toBe("Blouse");
    expect(canonicalCategory("weird thing")).toBe("Top");
    expect(canonicalLabel(spec({ source: { category: "maxi gown", color: "", pattern: "", details: [] }, remove: [], change: { fit: "looser" } }))).toBe(
      "Dress · looser",
    );
  });
});

describe("spec merge (refine keeps earlier edits)", () => {
  it("keeps the first edit's constraints when stacking", () => {
    const first = spec({ remove: ["bow"], change: {}, label: "" });
    const second = spec({ remove: [], keep: [], change: { length: "shorter" }, targetCaption: "a short white blouse" });
    const merged = mergeSpec(first, second);
    expect(merged.remove).toEqual(["bow"]);
    expect(merged.change).toEqual({ length: "shorter" });
    expect(merged.label).toBe("Blouse · remove bow + shorter");
    expect(merged.targetCaption).toBe("a short white blouse");
  });

  it("lets a later edit override or reverse an earlier one", () => {
    const first = spec({ remove: ["bow"], change: { color: "black" }, maxPrice: 50 });
    const merged = mergeSpec(first, spec({ remove: [], add: ["bow"], change: { color: "navy" } }));
    expect(merged.remove).toEqual([]);
    expect(merged.add).toEqual(["bow"]);
    expect(merged.change.color).toBe("navy");
    expect(merged.maxPrice).toBe(50);
  });

  it("drops keeps that conflict with removals or changes", () => {
    const merged = mergeSpec(spec({ keep: ["white color", "long sleeves"] }), spec({ remove: ["long sleeves"], keep: [] }));
    expect(merged.keep).toEqual(["white color"]);
  });
});

describe("wire -> EditSpec", () => {
  it("normalizes terms, strips negations from targetCaption and recomputes the label", () => {
    const s = fromWire({
      source: { category: "blouse", color: "White", pattern: "plain", details: ["Bow at neckline"] },
      keep: ["white color", "the bow"],
      remove: ["The Bow."],
      change: [{ attribute: "Colour", value: "Black" }],
      add: [],
      maxPrice: null,
      targetCaption: "a black blouse without a bow, no ribbon",
      label: "anything the model said",
    });
    expect(s.remove).toEqual(["bow"]);
    expect(s.keep).toEqual(["white color"]);
    expect(s.change).toEqual({ color: "black" });
    expect(s.label).toBe("Blouse · remove bow + in black");
    expect(s.targetCaption).not.toMatch(/\b(without|no)\b/);
    expect(s.maxPrice).toBeUndefined();
  });

  it("positiveCaption removes negated phrases", () => {
    expect(positiveCaption("white blouse without the ribbon", ["ribbon"])).toBe("white blouse");
  });

  it("builds one check per edit", () => {
    expect(buildChecks(spec({ change: { color: "black", length: "longer" }, add: ["pockets"] }))).toEqual([
      "is a blouse",
      "keeps white color",
      "has no bow",
      "color is black (close shades OK)",
      "length is longer than the source",
      "has pockets",
    ]);
  });
});
