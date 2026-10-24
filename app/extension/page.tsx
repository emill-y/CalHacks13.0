import Link from "next/link";

export const metadata = { title: "ThisBut for Chrome — shop by editing what you see" };

const STEPS = [
  ["Hover any product photo", "On any shopping site, a pink “✦ This, but…” button appears on product photos. Or right-click an image → “This, but…”."],
  ["Say what you’d change", "“without the ribbon”, “in black”, “longer sleeves”, “under $50”, or anything else, in your own words."],
  ["Get only what passes", "ThisBut searches that store’s catalog and checks every result against every edit. Matches link straight to the product on the store’s site."],
];

export default async function ExtensionPage({ searchParams }: { searchParams: Promise<{ installed?: string }> }) {
  const { installed } = await searchParams;
  const store = process.env.NEXT_PUBLIC_CHROME_STORE_URL;
  return (
    <div className="max-w-4xl pt-10">
      {installed ? (
        <div className="mb-8 rounded-3xl bg-accent p-6 text-accent-ink">
          <p className="font-display text-3xl font-semibold">You’re all set ✦</p>
          <p className="mt-1">Pin ThisBut from the puzzle-piece menu, then open any shop and hover a product photo.</p>
        </div>
      ) : null}
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Browser extension</p>
      <h1 className="mt-2 font-display text-5xl font-bold leading-none sm:text-7xl">
        This, <span className="italic text-accent">but…</span> on every store.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Find the version you actually want, on the store you’re already browsing. Works on Shopify and WooCommerce
        stores and any store with a sitemap, with no account needed.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {store ? (
          <a href={store} className="rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink">
            Add to Chrome — it’s free
          </a>
        ) : (
          <span className="rounded-full border border-line px-6 py-3 text-sm text-muted">Chrome Web Store listing coming soon</span>
        )}
        <Link href="/privacy" className="rounded-full border border-line px-6 py-3 font-semibold">
          Privacy
        </Link>
      </div>
      <ol className="mt-12 grid gap-4 sm:grid-cols-3">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="rounded-3xl border border-line bg-card p-6">
            <span className="font-display text-4xl font-bold italic text-accent">0{i + 1}</span>
            <h2 className="mt-2 font-display text-xl font-semibold">{t}</h2>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </li>
        ))}
      </ol>
      <section className="mt-12 rounded-3xl border border-line bg-card p-6 text-sm text-muted">
        <h2 className="font-display text-xl font-semibold text-ink">Good to know</h2>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>The first search on a new store reads its catalog (about 20–90 s). After that it’s cached and searches take about 10 s.</li>
          <li>Your picked photo is used once and discarded. Wishes are saved as text only.</li>
          <li>Searches are rate-limited per device to keep the free service running for everyone.</li>
          <li>ThisBut is an independent project, not affiliated with the stores you use it on.</li>
        </ul>
      </section>
    </div>
  );
}
