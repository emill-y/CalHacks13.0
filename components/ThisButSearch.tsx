"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { addToCart } from "@/lib/cart";
import { getDeviceId } from "@/lib/device";
import { toast } from "@/lib/toast";
import type { EditSpec, Product, SearchEvent, VerifiedResult } from "@/lib/types";
import { price } from "./ProductCard";
import { prepareImage, type Crop } from "./imagePrep";
import { VoiceButton } from "./VoiceButton";

const EXAMPLES = ["without the ribbon", "in black", "longer sleeves", "under $50"];
const STEPS = [
  { key: "parse", label: "Understanding your item" },
  { key: "retrieve", label: "Applying your edits" },
  { key: "verify", label: "Checking 16 candidates" },
] as const;
type Stage = "idle" | "parse" | "retrieve" | "verify" | "done" | "error";
type Done = Extract<SearchEvent, { stage: "done" }>;

export function ThisButSearch({ sourceProduct, compact }: { sourceProduct?: Product; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [edit, setEdit] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [retrieved, setRetrieved] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null);
  const [refine, setRefine] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const lastImage = useRef<{ data: string; mediaType: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = stage === "parse" || stage === "retrieve" || stage === "verify";

  const pick = useCallback((f: File | null | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFile(f);
    setCrop(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  }, []);

  // Paste an image from the clipboard anywhere on the page (not inside other inputs' text).
  useEffect(() => {
    if (sourceProduct) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        pick(item.getAsFile());
        e.preventDefault();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pick, sourceProduct]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(t);
  }, [busy]);

  async function run(opts: { editText: string; priorSpec?: EditSpec; spec?: EditSpec }) {
    if (!sourceProduct && !file && !lastImage.current) {
      setError({ msg: "Add a photo first — drop, upload or paste one." });
      return;
    }
    if (!opts.editText.trim() && !opts.spec) {
      setError({ msg: "Tell us what to change, e.g. “without the ribbon”." });
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setStage("parse");
    setRetrieved(0);
    const slow = setTimeout(() => toast("Still working — slow network or busy model…"), 20_000);
    try {
      let image = lastImage.current;
      if (!sourceProduct && file && (!image || !opts.priorSpec)) {
        image = await prepareImage(file, crop); // client-side crop + downscale to 768 px
        lastImage.current = image;
      }
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          deviceId: getDeviceId(),
          editText: opts.editText,
          priorSpec: opts.priorSpec,
          spec: opts.spec,
          ...(sourceProduct ? { productId: sourceProduct.id } : { image: image!.data, mediaType: image!.mediaType }),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw Object.assign(new Error(j.error || `Search failed (${res.status})`), { code: j.code });
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as SearchEvent;
          if (ev.stage === "error") throw Object.assign(new Error(ev.error), { code: ev.code });
          if (ev.stage === "retrieve") setRetrieved(ev.count);
          if (ev.stage === "done") {
            setDone(ev);
            setRefine("");
          }
          setStage(ev.stage);
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const err = e as Error & { code?: string };
      setError({
        msg: err.message === "Failed to fetch" ? "Network error — check your connection and try again." : err.message,
        code: err.code,
      });
      setStage("error");
    } finally {
      clearTimeout(slow);
    }
  }

  function removeEdit(kind: "remove" | "add" | "change" | "keep" | "maxPrice", value: string) {
    if (!done) return;
    const s: EditSpec = structuredClone(done.spec);
    if (kind === "remove") s.remove = s.remove.filter((x) => x !== value);
    if (kind === "add") s.add = s.add.filter((x) => x !== value);
    if (kind === "keep") s.keep = s.keep.filter((x) => x !== value);
    if (kind === "change") delete s.change[value];
    if (kind === "maxPrice") delete s.maxPrice;
    run({ editText: "", spec: s });
  }

  const matches = done?.results.filter((r) => r.allPass && !r.unverified) ?? [];
  const close = done?.results.filter((r) => !(r.allPass && !r.unverified)) ?? [];

  return (
    <section className={compact ? "" : "pt-10 sm:pt-16"}>
      {!compact && (
        <div className="mb-6 max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Shop by editing what you see</p>
          <h1 className="font-display text-5xl font-bold leading-[0.95] sm:text-7xl">
            This, <span className="italic text-accent">but…</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
            Show us an item and say what you’d change. Every result is checked against every edit — no “close enough” passed
            off as a match.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run({ editText: edit });
        }}
        className="rounded-3xl border border-line bg-card p-3 shadow-sm sm:p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          {sourceProduct ? (
            <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-white p-2 sm:w-44 sm:flex-col">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sourceProduct.image} alt="" className="h-20 w-20 object-contain sm:h-36 sm:w-36" />
              <span className="text-xs text-neutral-600">Starting from this item</span>
            </div>
          ) : (
            <DropZone preview={preview} crop={crop} setCrop={setCrop} onPick={pick} inputRef={fileInput} onClear={() => { setFile(null); setPreview(null); setCrop(null); lastImage.current = null; }} />
          )}
          <div className="flex flex-1 flex-col gap-3">
            <label className="sr-only" htmlFor="edit">Your edit</label>
            <div className="flex items-start gap-2">
              <textarea
                id="edit"
                value={edit}
                onChange={(e) => setEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    run({ editText: edit });
                  }
                }}
                rows={compact ? 2 : 3}
                placeholder="…but without the ribbon"
                className="min-h-[72px] w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 font-display text-xl outline-none placeholder:text-muted/70 focus:border-ink sm:text-2xl"
              />
              <VoiceButton onText={(t) => setEdit((x) => (x ? `${x} ${t}` : t))} />
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  type="button"
                  key={ex}
                  onClick={() => setEdit((x) => (x.trim() ? `${x.trim()}, ${ex}` : ex))}
                  className="rounded-full border border-line px-3 py-1 text-sm hover:border-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-accent-ink transition disabled:opacity-60"
              >
                {busy ? "Searching…" : "Find it"}
              </button>
              {busy && (
                <button type="button" onClick={() => { abortRef.current?.abort(); setStage("idle"); }} className="text-sm text-muted underline">
                  Cancel
                </button>
              )}
              <span className="ml-auto hidden text-xs text-muted sm:block">Photos are used once, then discarded.</span>
            </div>
          </div>
        </div>
      </form>

      {error && (
        <div role="alert" className="mt-4 rounded-2xl border border-miss/40 bg-card p-4 text-sm">
          <b className="text-miss">{errorTitle(error.code)}</b> {error.msg}
        </div>
      )}

      {busy && <Progress stage={stage} retrieved={retrieved} elapsed={elapsed} />}

      {done && !busy && (
        <div className="mt-8 rise">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted">Your edits</span>
            <SpecChips spec={done.spec} onRemove={removeEdit} />
            <span className="ml-auto flex items-center gap-3 text-xs text-muted">
              {done.photoDiscarded && <span className="text-ok">Photo discarded ✓</span>}
              <span className="tabular-nums">{(done.timings.total / 1000).toFixed(1)} s</span>
            </span>
          </div>

          {!done.verified && (
            <div className="mb-4 rounded-2xl border border-line bg-soft p-3 text-sm">
              <b>Unverified.</b> The checker didn’t finish in time, so these are shown in similarity order and none are
              labeled as matches.
            </div>
          )}

          <ResultSection
            title={`Matches${matches.length ? ` (${matches.length})` : ""}`}
            subtitle="Passed every edit you asked for"
            empty="Nothing passed every edit yet."
            results={matches}
          />

          <WishPrompt done={done} prominent={done.fullMatchCount < 3} />

          {close.length > 0 && (
            <ResultSection title={done.verified ? "Close, but…" : "Similar items (unverified)"} subtitle={done.verified ? "Each one misses at least one edit" : undefined} results={close} />
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (refine.trim()) run({ editText: refine, priorSpec: done.spec });
            }}
            className="sticky bottom-3 z-20 mt-8 flex gap-2 rounded-full border border-line bg-card p-2 shadow-lg"
          >
            <input
              value={refine}
              onChange={(e) => setRefine(e.target.value)}
              placeholder="Refine: “now shorter”, “in navy”…"
              className="flex-1 rounded-full bg-transparent px-4 text-base outline-none"
            />
            <button className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper">Refine</button>
          </form>
        </div>
      )}
    </section>
  );
}

function errorTitle(code?: string) {
  if (code === "missing_api_key") return "Model not configured.";
  if (code === "no_catalog") return "No catalog.";
  if (code === "timeout") return "Timed out.";
  if (code === "model_error" || code === "invalid_output") return "Model error.";
  return "Couldn’t search.";
}

function Progress({ stage, retrieved, elapsed }: { stage: Stage; retrieved: number; elapsed: number }) {
  const idx = STEPS.findIndex((s) => s.key === stage);
  return (
    <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-live="polite">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <li
            key={s.key}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-sm transition ${
              state === "active" ? "border-ink bg-card" : state === "done" ? "border-line bg-card" : "border-line opacity-50"
            }`}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                state === "done" ? "bg-ok text-white" : state === "active" ? "pulse-dot bg-accent text-accent-ink" : "bg-soft"
              }`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span>
              {s.label}
              {s.key === "retrieve" && retrieved > 0 && <span className="text-muted"> · {retrieved} found</span>}
            </span>
            {state === "active" && <span className="ml-auto text-xs tabular-nums text-muted">{elapsed.toFixed(1)}s</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function SpecChips({
  spec,
  onRemove,
}: {
  spec: EditSpec;
  onRemove?: (kind: "remove" | "add" | "change" | "keep" | "maxPrice", value: string) => void;
}) {
  const chips: { kind: "remove" | "add" | "change" | "keep" | "maxPrice"; value: string; text: string }[] = [
    ...spec.remove.map((v) => ({ kind: "remove" as const, value: v, text: `no ${v}` })),
    ...Object.entries(spec.change).map(([k, v]) => ({ kind: "change" as const, value: k, text: `${k}: ${v}` })),
    ...spec.add.map((v) => ({ kind: "add" as const, value: v, text: `+ ${v}` })),
    ...(spec.maxPrice ? [{ kind: "maxPrice" as const, value: "", text: `under $${spec.maxPrice}` }] : []),
    ...spec.keep.map((v) => ({ kind: "keep" as const, value: v, text: `keep ${v}` })),
  ];
  return (
    <>
      {chips.map((c) => (
        <span
          key={c.kind + c.value}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${
            c.kind === "keep" ? "border border-line" : "bg-ink text-paper"
          }`}
        >
          {c.text}
          {onRemove && (
            <button type="button" aria-label={`Remove ${c.text}`} onClick={() => onRemove(c.kind, c.value)} className="opacity-70 hover:opacity-100">
              ×
            </button>
          )}
        </span>
      ))}
    </>
  );
}

function ResultSection({
  title,
  subtitle,
  results,
  empty,
}: {
  title: string;
  subtitle?: string;
  results: VerifiedResult[];
  empty?: string;
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="font-display text-2xl font-semibold">{title}</h3>
        {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
      </div>
      {results.length === 0 && empty ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((r) => (
            <ResultCard key={r.product.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ r }: { r: VerifiedResult }) {
  const [open, setOpen] = useState<number | null>(null);
  const missed = r.checks.filter((c) => !c.pass && !/^keeps\b/i.test(c.text));
  return (
    <div className="rise flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <Link href={`/product/${r.product.id}`} className="block aspect-square bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.product.image} alt={r.product.caption} className="h-full w-full object-contain" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/product/${r.product.id}`} className="line-clamp-1 text-sm font-medium hover:underline">
            {r.product.name}
          </Link>
          <span className="text-sm font-semibold tabular-nums">{price(r.product.price)}</span>
        </div>
        {!r.allPass && missed.length > 0 && !r.unverified && (
          <p className="text-xs text-miss">Misses: {missed.map((m) => m.text).join("; ")}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {r.checks.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              title={c.reason}
              className={`rounded-full px-2 py-0.5 text-left text-[11px] leading-4 ${
                c.pass ? "bg-ok/10 text-ok" : /^keeps\b/i.test(c.text) ? "bg-soft text-muted" : "bg-miss/10 text-miss"
              }`}
            >
              {c.pass ? "✓" : /^keeps\b/i.test(c.text) ? "≈" : "✗"} {chipKind(c.text, c.pass)} {shortCheck(c.text)}
            </button>
          ))}
        </div>
        {open !== null && r.checks[open] && <p className="text-xs text-muted">“{r.checks[open].reason}”</p>}
        <button
          type="button"
          onClick={() => {
            addToCart(r.product);
            toast(`Added ${r.product.name} to cart`, "/cart", "Cart");
          }}
          className="mt-auto rounded-full border border-line py-1.5 text-xs font-semibold hover:border-ink"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}

function chipKind(text: string, pass: boolean) {
  if (!pass) return /^keeps\b/i.test(text) ? "differs:" : "missed:";
  return /^keeps\b/i.test(text) ? "kept:" : "changed:";
}
function shortCheck(text: string) {
  return text.replace(/^keeps\s+/i, "").replace(/\s*\(close shades OK\)/i, "");
}

function WishPrompt({ done, prominent }: { done: Done; prominent: boolean }) {
  const [maxPay, setMaxPay] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          spec: done.spec,
          label: done.spec.label,
          nearestProductId: done.nearestProductId,
          maxPay: maxPay ? Number(maxPay) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save wish");
      localStorage.setItem("tb-has-wishes", "1");
      setSaved(true);
      toast("Wish saved. We’ll tell you when a store has it.", "/wishes", "My Wishes");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (saved) {
    return (
      <p className="mt-6 text-sm">
        ✓ Saved “{done.spec.label}” to <Link href="/wishes" className="underline">My Wishes</Link>. Merchants see it as an
        anonymous demand signal — never your photo.
      </p>
    );
  }
  if (!prominent) {
    return (
      <button type="button" onClick={save} disabled={busy} className="mt-4 text-sm text-muted underline">
        Not exactly it? Save “{done.spec.label}” as a wish
      </button>
    );
  }
  return (
    <div className="mt-8 rounded-3xl bg-ink p-5 text-paper sm:p-6">
      <h3 className="font-display text-3xl font-semibold">Not quite there? I’d buy this.</h3>
      <p className="mt-1 text-sm opacity-80">
        Save <b>{done.spec.label}</b> as a wish. Stores see anonymous demand for it, and you get pinged when someone stocks
        it. Your photo is not stored.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-full bg-paper/10 px-4 py-2 text-sm">
          up to $
          <input
            inputMode="numeric"
            value={maxPay}
            onChange={(e) => setMaxPay(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            placeholder="__"
            className="w-14 bg-transparent outline-none placeholder:text-paper/50"
          />
        </label>
        <button type="button" onClick={save} disabled={busy} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
          {busy ? "Saving…" : "Save my wish"}
        </button>
      </div>
    </div>
  );
}

function DropZone({
  preview,
  crop,
  setCrop,
  onPick,
  onClear,
  inputRef,
}: {
  preview: string | null;
  crop: Crop | null;
  setCrop: (c: Crop | null) => void;
  onPick: (f: File | null | undefined) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [cropping, setCropping] = useState(false);

  function rel(e: React.PointerEvent) {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  return (
    <div className="shrink-0 sm:w-56">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      {preview ? (
        <div className="flex flex-col gap-2">
          <div
            ref={box}
            className={`relative aspect-square touch-none select-none overflow-hidden rounded-2xl bg-white ${cropping ? "cursor-crosshair" : ""}`}
            onPointerDown={(e) => {
              if (!cropping) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = rel(e);
              setCrop({ x: drag.current.x, y: drag.current.y, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              if (!cropping || !drag.current) return;
              const p = rel(e);
              const s = drag.current;
              setCrop({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
            }}
            onPointerUp={() => {
              drag.current = null;
              if (crop && (crop.w < 0.05 || crop.h < 0.05)) setCrop(null);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your item" className="pointer-events-none h-full w-full object-contain" draggable={false} />
            {crop && crop.w > 0 && (
              <div
                className="pointer-events-none absolute border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs">
            <button type="button" onClick={() => { setCropping(!cropping); if (cropping) setCrop(crop); }} className="underline">
              {cropping ? "Done cropping" : crop ? "Adjust crop" : "Crop to item"}
            </button>
            {crop && <button type="button" onClick={() => setCrop(null)} className="underline">Clear crop</button>}
            <button type="button" onClick={onClear} className="text-muted underline">Remove</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onPick(e.dataTransfer.files?.[0]); }}
          className={`flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center text-sm transition sm:aspect-square ${
            over ? "border-accent bg-accent/5" : "border-line hover:border-ink"
          }`}
        >
          <span className="text-3xl">⌗</span>
          <span className="font-semibold">Drop, upload or paste</span>
          <span className="text-xs text-muted">a photo of “this”</span>
        </button>
      )}
    </div>
  );
}
