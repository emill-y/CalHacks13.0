import { describe, expect, it } from "vitest";
import { categoryFromText, isNonApparelTitle } from "../lib/spec";
import { imageKey, storeIdFor } from "../lib/stores";

describe("store catalog classification (real Shopify titles)", () => {
  it("maps product titles to the fixed category list", () => {
    const cases: [string, string][] = [
      ["Ameleah Layered Active Tank Top", "Top"],
      ["Sivanna Lacey Satin Effect Corset", "Top"],
      ["Jinni Cropped Active Halter Top", "Top"],
      ["Winnefred Sweatpants", "Trousers"],
      ["Carlee Active Contrast Micro Shorts", "Trousers"],
      ["Ooma Knit Foldover Pants", "Trousers"],
      ["Ooma Knit Wrap Sweater", "Knitwear"],
      ["Bostynn Cropped Knit Cardigan", "Knitwear"],
      ["Edikted Glow Rhinestone Hoodie", "Knitwear"],
      ["Winnefred Sweatshirt", "Knitwear"],
      ["Feeva Studded Mini Skort", "Skirt"],
      ["Shammy Denim Micro Skort", "Skirt"],
      ["Zeffra Cupped Mini Dress", "Dress"],
      ["Tani Distressed Stud And Lace Jeans", "Jeans"],
    ];
    for (const [title, cat] of cases) expect([title, categoryFromText(title)]).toEqual([title, cat]);
    expect(categoryFromText("Mystery Item 42")).toBeNull();
  });

  it("drops non-apparel", () => {
    expect(isNonApparelTitle("Dainty Rhinestone Bracelet")).toBe(true);
    expect(isNonApparelTitle("Platform Knee High Boots")).toBe(true);
    expect(isNonApparelTitle("Edikted Glow Rhinestone Hoodie")).toBe(false);
    expect(isNonApparelTitle("Ilen Polka Dot Wrap Top")).toBe(false);
  });

  it("treats the same photo at different sizes as one product", () => {
    expect(imageKey("https://cdn.shopify.com/s/files/a.jpg?v=1&width=600")).toBe(imageKey("https://cdn.shopify.com/s/files/a.jpg?v=1"));
    expect(imageKey("https://cdn.shopify.com/s/files/a.jpg")).not.toBe(imageKey("https://cdn.shopify.com/s/files/b.jpg"));
  });

  it("scopes Shopify catalogs per host and page catalogs per page", () => {
    expect(storeIdFor("https://edikted.com", "shopify")).toBe("edikted.com");
    const a = storeIdFor("https://shop.example", "page", "https://shop.example/women/tops");
    const b = storeIdFor("https://shop.example", "page", "https://shop.example/women/dresses");
    expect(a).not.toBe(b);
    expect(a.startsWith("shop.example~page-")).toBe(true);
  });
});
