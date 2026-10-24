"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { prepareImage } from "./imagePrep";

interface Result {
  product: { id: string; name: string };
  checked: number;
  fulfilled: { id: string; label: string }[];
  error?: string;
}

export function AddProductForm() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<string>("Blouse");
  const [color, setColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Add a product photo.");
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const img = await prepareImage(file, null);
      const res = await fetch("/api/merchant/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: img.data, name, price: Number(price), category, color: color || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-5">
        <label className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white text-sm text-neutral-500">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f);
              setPreview(URL.createObjectURL(f));
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-full w-full object-contain" /> : "Upload product photo"}
        </label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Plain Blue Puff-Sleeve Blouse" className="rounded-xl border border-line bg-paper px-4 py-3" />
        <div className="grid grid-cols-3 gap-3">
          <input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Price $" className="rounded-xl border border-line bg-paper px-4 py-3" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-line bg-paper px-3 py-3">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" className="rounded-xl border border-line bg-paper px-4 py-3" />
        </div>
        <button disabled={busy} className="rounded-full bg-accent py-3 font-semibold text-accent-ink disabled:opacity-60">
          {busy ? "Embedding & checking wishes…" : "Add to catalog"}
        </button>
        {error && <p className="text-sm text-miss">{error}</p>}
      </form>
      <div>
        {result && (
          <div className="rise rounded-3xl bg-ink p-6 text-paper">
            <p className="text-sm opacity-70">Added {result.product.name} · searchable now</p>
            <p className="mt-2 font-display text-4xl font-semibold">
              This fulfills {result.fulfilled.length} wish{result.fulfilled.length === 1 ? "" : "es"}.
            </p>
            <p className="mt-1 text-sm opacity-70">
              {result.checked} open wish{result.checked === 1 ? "" : "es"} passed the prefilter and were verified against the photo.
            </p>
            {result.error && <p className="mt-2 text-sm text-accent">Wish check failed: {result.error}</p>}
            {result.fulfilled.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-sm">
                {result.fulfilled.map((f) => <li key={f.id}>{f.label}</li>)}
              </ul>
            )}
            <Link href={`/product/${result.product.id}`} className="mt-4 inline-block rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
              View product
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
