import Link from "next/link";
import type { Product } from "@/lib/types";

export function price(n: number) {
  return `$${n.toFixed(2)}`;
}

export function ProductCard({ p, children }: { p: Product; children?: React.ReactNode }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <Link href={`/product/${p.id}`} className="block aspect-square overflow-hidden bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={p.image}
          alt={p.caption}
          loading="lazy"
          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/product/${p.id}`} className="line-clamp-1 text-sm font-medium hover:underline">
            {p.name}
          </Link>
          <span className="text-sm font-semibold tabular-nums">{price(p.price)}</span>
        </div>
        <span className="text-xs text-muted">{p.category}</span>
        {children}
      </div>
    </div>
  );
}
