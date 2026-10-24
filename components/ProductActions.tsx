"use client";

import { createContext, useContext, useState } from "react";
import { addToCart } from "@/lib/cart";
import { toast } from "@/lib/toast";
import type { Product } from "@/lib/types";
import { ThisButSearch } from "./ThisButSearch";

const Ctx = createContext<{ product: Product; editing: boolean; setEditing: (f: (e: boolean) => boolean) => void } | null>(null);

/** Product page shell: details (children) + a full-width "This, but…" panel using the product as the source. */
export function ProductActions({ product, children }: { product: Product; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <Ctx.Provider value={{ product, editing, setEditing }}>
      {children}
      {editing && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-paper px-4 pb-24 pt-6 md:static md:z-auto md:mt-10 md:bg-transparent md:p-0">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-3xl font-semibold">
              This, <span className="italic text-accent">but…</span>
            </span>
            <button onClick={() => setEditing(() => false)} className="rounded-full border border-line px-3 py-1 text-sm">
              Close
            </button>
          </div>
          <ThisButSearch sourceProduct={product} compact />
        </div>
      )}
    </Ctx.Provider>
  );
}

export function ProductButtons() {
  const ctx = useContext(Ctx)!;
  const { product } = ctx;
  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={() => {
          addToCart(product);
          toast(`Added ${product.name} to cart`, "/cart", "Cart");
        }}
        className="rounded-full bg-ink px-6 py-3 font-semibold text-paper"
      >
        Add to cart
      </button>
      <button
        onClick={() => {
          ctx.setEditing((e) => !e);
          setTimeout(() => document.getElementById("edit")?.focus(), 50);
        }}
        className="rounded-full border-2 border-accent px-6 py-3 font-display text-lg font-semibold italic text-accent"
      >
        This, but…
      </button>
    </div>
  );
}
