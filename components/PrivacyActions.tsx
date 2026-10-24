"use client";

import { useState } from "react";
import { clearCart } from "@/lib/cart";
import { getDeviceId, resetDeviceId } from "@/lib/device";

export function PrivacyActions() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportData() {
    const res = await fetch(`/api/me?deviceId=${encodeURIComponent(getDeviceId())}`);
    if (!res.ok) return setMsg("Export failed.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `thisbut-my-data.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deleteAll() {
    if (!confirm("Delete all wishes and events for this device? This can’t be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/me?deviceId=${encodeURIComponent(getDeviceId())}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      clearCart();
      ["tb-has-wishes", "tb-found-seen"].forEach((k) => localStorage.removeItem(k));
      resetDeviceId();
      setMsg(`Deleted ${j.deletedWishes} wish(es) and ${j.deletedEvents} event(s). This browser now has a fresh anonymous id.`);
    } catch (e) {
      setMsg(`Delete failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-3 rounded-3xl bg-ink p-6 text-paper">
      <h2 className="font-display text-2xl font-semibold">Your data, your call</h2>
      <div className="flex flex-wrap gap-3">
        <button onClick={exportData} className="rounded-full border border-paper/40 px-5 py-2.5 font-semibold">Export my data (JSON)</button>
        <button onClick={deleteAll} disabled={busy} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
          {busy ? "Deleting…" : "Delete all my data"}
        </button>
      </div>
      {msg && <p role="status" className="text-sm opacity-80">{msg}</p>}
    </div>
  );
}
