import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { ThisButSearch } from "@/components/ThisButSearch";
import { CATEGORIES } from "@/lib/categories";
import { getCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
const PER_PAGE = 24;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  let products: Awaited<ReturnType<typeof getCatalog>>["products"] = [];
  let catalogError: string | null = null;
  try {
    products = (await getCatalog()).products;
  } catch (e) {
    catalogError = (e as Error).message;
  }
  const cat = CATEGORIES.find((c) => c === sp.cat);
  const filtered = cat ? products.filter((p) => p.category === cat) : products;
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const q = (p: number, c = cat) => `/?${new URLSearchParams({ ...(c ? { cat: c } : {}), page: String(p) })}#shop`;

  return (
    <>
      <ThisButSearch />
      <section id="shop" className="mt-14 scroll-mt-20">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-3xl font-semibold">The shop</h2>
          <p className="text-sm text-muted">
            {filtered.length.toLocaleString()} products{cat ? ` in ${cat}` : ""}
          </p>
        </div>
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 text-sm">
          <Link href={q(1, undefined)} className={`rounded-full border px-3 py-1 ${!cat ? "border-ink bg-ink text-paper" : "border-line"}`}>
            All
          </Link>
          {CATEGORIES.map((c) => (
            <Link key={c} href={q(1, c)} className={`whitespace-nowrap rounded-full border px-3 py-1 ${cat === c ? "border-ink bg-ink text-paper" : "border-line"}`}>
              {c}
            </Link>
          ))}
        </div>
        {catalogError ? (
          <div className="rounded-2xl border border-miss/40 bg-card p-6 text-sm">
            <b>No catalog.</b> {catalogError}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {slice.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        )}
        <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 && <Link href={q(page - 1)} className="rounded-full border border-line px-4 py-2 hover:bg-soft">← Prev</Link>}
          <span className="text-muted tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={q(page + 1)} className="rounded-full border border-line px-4 py-2 hover:bg-soft">Next →</Link>}
        </nav>
      </section>
    </>
  );
}
