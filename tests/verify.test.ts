import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { Scored } from "../lib/retrieve";
import type { Product } from "../lib/types";
import { alignChecks, rankResults, verify, type VerifierFn } from "../lib/verify";
import { spec } from "./helpers";

const catalog: Product[] = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const scored: Scored[] = catalog.slice(0, 16).map((p, i) => ({ product: p, score: 1 - i / 100, idx: i }));
const src = { data: fs.readFileSync("public/catalog/p0001.jpg").toString("base64"), mediaType: "image/jpeg" as const };

describe("verifier integration (mocked model)", () => {
  it("runs two batches of 8, ranks all-pass first, never marks a partial pass as a match", async () => {
    const calls: number[] = [];
    const verifier: VerifierFn = async ({ candidates, checks }) => {
      calls.push(candidates.length);
      return {
        candidates: candidates.map((c, i) => ({
          id: `Candidate ${c.product.id}`,
          // every 3rd candidate passes everything
          checks: checks.map((t, j) => ({ text: t, pass: i % 3 === 0 || j === 0, reason: "looks right" })),
          similarity: 10 - i,
        })),
      };
    };
    const { results, verified } = await verify(spec(), src, scored, { verifier });
    expect(calls).toEqual([8, 8]);
    expect(verified).toBe(true);
    const firstFail = results.findIndex((r) => !r.allPass);
    expect(results.slice(firstFail).every((r) => !r.allPass)).toBe(true);
    for (const r of results) expect(r.allPass).toBe(r.checks.every((c) => c.pass));
  });

  it("falls back to retrieval order marked unverified on timeout", async () => {
    const slow: VerifierFn = () => new Promise(() => {});
    const { results, verified } = await verify(spec(), src, scored, { verifier: slow, timeoutMs: 50 });
    expect(verified).toBe(false);
    expect(results.every((r) => r.unverified && !r.allPass)).toBe(true);
    expect(results.map((r) => r.product.id)).toEqual(scored.map((s) => s.product.id));
  });

  it("treats checks the model skipped as failures", () => {
    const out = alignChecks(["has no bow", "keeps white color"], [{ text: "has no bow", pass: true, reason: "clean neckline" }]);
    expect(out[1]).toEqual({ text: "keeps white color", pass: false, reason: "not evaluated by checker" });
  });

  it("ranks allPass, then pass count, then similarity, then retrieval score", () => {
    const p = catalog[0];
    const mk = (allPass: boolean, passes: number, sim: number, rs: number) => ({
      product: { ...p, id: `${allPass}${passes}${sim}${rs}` },
      checks: Array.from({ length: 3 }, (_, i) => ({ text: "x", pass: i < passes, reason: "" })),
      allPass,
      similarity: sim,
      retrievalScore: rs,
    });
    const ranked = rankResults([mk(false, 2, 9, 0.9), mk(true, 3, 5, 0.1), mk(false, 2, 9, 0.95), mk(false, 1, 10, 1)]);
    expect(ranked.map((r) => r.product.id)).toEqual(["true350.1", "false290.95", "false290.9", "false1101"]);
  });
});
