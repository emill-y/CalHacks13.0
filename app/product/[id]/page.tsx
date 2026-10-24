import Link from "next/link";
import { notFound } from "next/navigation";
import { price } from "@/components/ProductCard";
import { ProductActions, ProductButtons } from "@/components/ProductActions";
import { getProduct } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id).catch(() => undefined);
  if (!p) notFound();
  return (
    <div className="pt-6">
      <Link href="/#shop" className="text-sm text-muted hover:underline">
        ← Back to shop
      </Link>
      <ProductActions product={p}>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-line bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={p.caption} className="aspect-square w-full object-contain" />
        </div>
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{p.category}</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">{p.name}</h1>
          <p className="text-2xl font-semibold tabular-nums">{price(p.price)}</p>
          <p className="text-base text-muted first-letter:uppercase">{p.caption}.</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Color</dt>
            <dd className="capitalize">{p.color}</dd>
            <dt className="text-muted">Item</dt>
            <dd className="font-mono text-xs">{p.id}</dd>
          </dl>
          <ProductButtons />
        </div>
      </div>
      </ProductActions>
    </div>
  );
}
