"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SpecChips } from "@/components/ThisButSearch";
import { notifyFound } from "@/components/WishWatcher";
import { getDeviceId } from "@/lib/device";
import type { Wish } from "@/lib/types";

export default function WishesPage() {
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wishes?deviceId=${encodeURIComponent(getDeviceId())}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load wishes (${res.status})`);
      const { wishes } = (await res.json()) as { wishes: Wish[] };
      setWishes(wishes);
      setError(null);
      notifyFound(wishes);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // poll every 10 s
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="pt-10">
      <h1 className="font-display text-5xl font-semibold">My Wishes</h1>
      <p className="mt-2 max-w-xl text-muted">
        Edits nobody stocks yet. We check every new product against them and ping you here when one is found. Stored as
        text only — never your photo.
      </p>
      {error && <p className="mt-4 text-sm text-miss">{error} — retrying…</p>}
      {wishes === null ? (
        <p className="mt-8 text-sm text-muted">Loading…</p>
      ) : wishes.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-line p-8 text-center">
          <p className="font-display text-2xl">No wishes yet.</p>
          <p className="mt-1 text-sm text-muted">
            Search for something with an edit. If it doesn’t exist, tap “I’d buy this”.
          </p>
          <Link href="/" className="mt-4 inline-block rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink">
            Start a search
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {wishes.map((w) => (
            <li key={w.id} className={`rise rounded-3xl border p-5 ${w.status === "found" ? "border-ok bg-ok/5" : "border-line bg-card"}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">{w.label}</h2>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    w.status === "found" ? "bg-ok text-white" : "bg-soft text-muted"
                  }`}
                >
                  {w.status === "found" ? "Found!" : "Watching"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted first-letter:uppercase">{w.spec.targetCaption}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <SpecChips spec={w.spec} />
                {w.maxPay && <span className="rounded-full border border-line px-3 py-1">up to ${w.maxPay}</span>}
              </div>
              <p className="mt-3 text-xs text-muted">Saved {new Date(w.ts).toLocaleString()}</p>
              {w.status === "found" && w.foundProductId && (
                <Link href={`/product/${w.foundProductId}`} className="mt-3 inline-block rounded-full bg-ok px-4 py-2 text-sm font-semibold text-white">
                  See the product →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
