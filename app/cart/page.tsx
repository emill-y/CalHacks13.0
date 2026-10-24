"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { price } from "@/components/ProductCard";
import { clearCart, getCart, setQty, type CartLine } from "@/lib/cart";
import { getDeviceId } from "@/lib/device";

const TEST_CARD = "4111111111111111";

function luhn(num: string) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return num.length >= 12 && sum % 10 === 0;
}

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ last4: string; total: number; n: number } | null>(null);

  useEffect(() => {
    const u = () => setLines(getCart());
    u();
    window.addEventListener("tb-cart", u);
    return () => window.removeEventListener("tb-cart", u);
  }, []);

  const total = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const n = lines.reduce((s, l) => s + l.qty, 0);

  async function checkout(e: React.FormEvent) {
    e.preventDefault();
    const digits = card.replace(/\D/g, "");
    if (!luhn(digits)) return setError("That card number isn’t valid.");
    if (digits !== TEST_CARD) return setError("Test mode: use 4111 1111 1111 1111.");
    if (!/^\d{2}\/\d{2}$/.test(exp)) return setError("Expiry should look like 12/29.");
    // The card number never leaves this page: only the order size is logged.
    await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), kind: "order", label: `${n} item(s), $${total.toFixed(2)}` }),
    }).catch(() => {});
    setConfirmed({ last4: digits.slice(-4), total, n });
    setCard("");
    setCvc("");
    setExp("");
    clearCart();
  }

  if (confirmed) {
    return (
      <div className="mx-auto max-w-lg pt-16 text-center">
        <p className="text-5xl">✓</p>
        <h1 className="mt-2 font-display text-4xl font-semibold">Order confirmed</h1>
        <p className="mt-2 text-muted">
          {confirmed.n} item(s) · {price(confirmed.total)} · card ending <b className="text-ink">{confirmed.last4}</b>
        </p>
        <p className="mt-1 text-xs text-muted">Test mode — no money moved. Your card number was not stored or sent.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink">Keep shopping</Link>
      </div>
    );
  }

  return (
    <div className="pt-10">
      <h1 className="font-display text-5xl font-semibold">Cart</h1>
      {lines.length === 0 ? (
        <p className="mt-6 text-muted">
          Your cart is empty. <Link href="/" className="underline">Find something</Link>.
        </p>
      ) : (
        <div className="mt-8 grid gap-8 md:grid-cols-[1.4fr_1fr]">
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.product.id} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.product.image} alt="" className="h-20 w-20 rounded-xl bg-white object-contain" />
                <div className="flex-1">
                  <Link href={`/product/${l.product.id}`} className="font-medium hover:underline">{l.product.name}</Link>
                  <p className="text-sm text-muted">{price(l.product.price)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQty(l.product.id, l.qty - 1)} className="h-8 w-8 rounded-full border border-line">−</button>
                  <span className="w-5 text-center tabular-nums">{l.qty}</span>
                  <button onClick={() => setQty(l.product.id, l.qty + 1)} className="h-8 w-8 rounded-full border border-line">+</button>
                </div>
              </li>
            ))}
          </ul>
          <form onSubmit={checkout} className="flex h-fit flex-col gap-3 rounded-3xl border border-line bg-card p-5" autoComplete="off">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">Total</span>
              <span className="text-2xl font-semibold tabular-nums">{price(total)}</span>
            </div>
            <span className="w-fit rounded bg-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Test mode</span>
            <input
              value={card}
              onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, "").slice(0, 19))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="4111 1111 1111 1111"
              aria-label="Card number"
              className="rounded-xl border border-line bg-paper px-4 py-3 tabular-nums"
            />
            <div className="grid grid-cols-2 gap-3">
              <input value={exp} onChange={(e) => setExp(e.target.value.slice(0, 5))} placeholder="MM/YY" aria-label="Expiry" className="rounded-xl border border-line bg-paper px-4 py-3" />
              <input value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="CVC" aria-label="CVC" className="rounded-xl border border-line bg-paper px-4 py-3" />
            </div>
            {error && <p className="text-sm text-miss">{error}</p>}
            <button className="rounded-full bg-ink py-3 font-semibold text-paper">Pay {price(total)}</button>
            <p className="text-xs text-muted">Test card only. The number is checked in your browser and never stored or sent.</p>
          </form>
        </div>
      )}
    </div>
  );
}
