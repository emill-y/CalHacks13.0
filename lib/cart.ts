"use client";

import type { Product } from "./types";

export interface CartLine {
  product: Product;
  qty: number;
}
const KEY = "tb-cart";

export function getCart(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[];
  } catch {
    return [];
  }
}

function save(lines: CartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("tb-cart"));
}

export function addToCart(product: Product) {
  const lines = getCart();
  const hit = lines.find((l) => l.product.id === product.id);
  if (hit) hit.qty += 1;
  else lines.push({ product, qty: 1 });
  save(lines);
}

export function setQty(id: string, qty: number) {
  save(getCart().flatMap((l) => (l.product.id === id ? (qty > 0 ? [{ ...l, qty }] : []) : [l])));
}

export function clearCart() {
  save([]);
}
