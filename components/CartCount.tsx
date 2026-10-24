"use client";

import { useEffect, useState } from "react";
import { getCart } from "@/lib/cart";

export function CartCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(getCart().reduce((s, l) => s + l.qty, 0));
    update();
    window.addEventListener("tb-cart", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("tb-cart", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (!n) return null;
  return <span className="ml-0.5 rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">{n}</span>;
}
