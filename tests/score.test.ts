import { describe, expect, it } from "vitest";
import { EMBED_DIM } from "../lib/clip";
import { scoreOne, W } from "../lib/retrieve";
import { unit } from "./helpers";

describe("retrieval score", () => {
  const vImg = unit(EMBED_DIM, [0]);
  const vText = unit(EMBED_DIM, [1]);
  const vBow = unit(EMBED_DIM, [2]);

  it("implements 0.5*img + 0.5*text - 0.25*max(remove) + 0.05*category", () => {
    const p = unit(EMBED_DIM, [0, 1, 2], [0.6, 0.6, 0.5]);
    const s = scoreOne(p, 0, vImg, vText, [vBow], true);
    const expected = W.img * p[0] + W.text * p[1] - W.remove * p[2] + W.category;
    expect(s).toBeCloseTo(expected, 6);
    expect(W).toEqual({ img: 0.5, text: 0.5, remove: 0.25, category: 0.05 });
  });

  it("penalizes products that look like the removed feature", () => {
    const plain = unit(EMBED_DIM, [0, 1], [0.7, 0.7]);
    const withBow = unit(EMBED_DIM, [0, 1, 2], [0.7, 0.7, 0.7]);
    expect(scoreOne(plain, 0, vImg, vText, [vBow], false)).toBeGreaterThan(scoreOne(withBow, 0, vImg, vText, [vBow], false));
  });

  it("uses the max over removal terms, and no penalty without removals", () => {
    const vRib = unit(EMBED_DIM, [3]);
    const p = unit(EMBED_DIM, [0, 2, 3], [1, 0.2, 0.9]);
    const s = scoreOne(p, 0, vImg, vText, [vBow, vRib], false);
    expect(s).toBeCloseTo(W.img * p[0] - W.remove * p[3], 6);
    expect(scoreOne(p, 0, vImg, vText, [], false)).toBeCloseTo(W.img * p[0], 6);
  });

  it("reads products at an offset in the packed matrix", () => {
    const a = unit(EMBED_DIM, [5]);
    const b = unit(EMBED_DIM, [0]);
    const packed = new Float32Array(EMBED_DIM * 2);
    packed.set(a, 0);
    packed.set(b, EMBED_DIM);
    expect(scoreOne(packed, EMBED_DIM, vImg, vText, [], true)).toBeCloseTo(W.img + W.category, 6);
  });
});
