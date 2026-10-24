"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Gap } from "@/lib/wishes";
import type { Product } from "@/lib/types";

type Row = Gap & { nearestProduct: Product | null };

export function GapsBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/merchant/gaps", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          if (j.error) setError(j.error);
          else setRows(j.gaps);
        })
        .catch((e) => alive && setError(String(e)));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className="mt-6 text-sm text-miss">Couldn’t load gaps: {error}</p>;
  if (!rows) return <p className="mt-6 text-sm text-muted">Loading…</p>;
  const top = rows.slice(0, 8).map((r) => ({ name: r.label, live: r.liveCount, demo: r.demoCount, hasDemo: r.hasDemo }));

  return (
    <>
      <div className="mt-8 rounded-3xl border border-line bg-card p-4 sm:p-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">Top gaps by shoppers</h2>
          <div className="flex gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-accent" /> live</span>
            <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-muted/40" /> demo data</span>
          </div>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={190} tick={{ fill: "var(--ink)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "var(--soft)" }}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" }}
              />
              <Bar dataKey="demo" stackId="a" name="demo data" fill="#a39e94" fillOpacity={0.45} isAnimationActive={false} />
              <Bar dataKey="live" stackId="a" name="live" fill="#ff5a2a" radius={[0, 6, 6, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-3xl border border-line bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="p-4">Gap</th>
              <th className="p-4">Shoppers</th>
              <th className="p-4">Median max pay</th>
              <th className="p-4">Est. demand <span className="normal-case">(estimate)</span></th>
              <th className="p-4">Nearest product</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={`border-b border-line last:border-0 ${r.liveCount > 0 ? "bg-accent/5" : ""}`}>
                <td className="p-4 align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.label}</span>
                    {r.hasDemo && <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Demo data</span>}
                    {r.liveCount > 0 && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink">Live</span>}
                  </div>
                  <p className="mt-1 max-w-xs text-xs text-muted">e.g. “{r.exampleEdit}”</p>
                </td>
                <td className="p-4 align-top tabular-nums">
                  <b className={r.liveCount ? "text-accent" : ""}>{r.liveCount}</b> live
                  {r.demoCount > 0 && <span className="text-muted"> + {r.demoCount} demo</span>}
                  {r.foundCount > 0 && <div className="text-xs text-ok">{r.foundCount} fulfilled</div>}
                </td>
                <td className="p-4 align-top tabular-nums">{r.medianMaxPay ? `$${r.medianMaxPay}` : "—"}</td>
                <td className="p-4 align-top tabular-nums">
                  {r.estDemand !== null ? `~$${r.estDemand.toLocaleString()}` : "—"}
                  <div className="text-[10px] text-muted">open count × median max pay</div>
                </td>
                <td className="p-4 align-top">
                  {r.nearestProduct ? (
                    <Link href={`/product/${r.nearestProduct.id}`} className="flex items-center gap-2 hover:underline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.nearestProduct.image} alt="" className="h-12 w-12 rounded-lg bg-white object-contain" />
                      <span className="line-clamp-2 text-xs">{r.nearestProduct.name}</span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Shopper identities are never shown; wishes are anonymous device-level text. Gaps refresh every 15 s.{" "}
        <Link href="/merchant/add" className="underline">Stock something that fills a gap →</Link>
      </p>
    </>
  );
}
