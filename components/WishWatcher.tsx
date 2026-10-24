"use client";

import { useEffect } from "react";
import { getDeviceId } from "@/lib/device";
import { toast } from "@/lib/toast";
import type { Wish } from "@/lib/types";

const SEEN = "tb-found-seen";

/** Background check (every 10 s, only if this device saved wishes) that toasts when a wish is fulfilled. */
export function WishWatcher() {
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        if (localStorage.getItem("tb-has-wishes") !== "1" || location.pathname === "/wishes") return;
        const res = await fetch(`/api/wishes?deviceId=${encodeURIComponent(getDeviceId())}`);
        if (!res.ok) return;
        const { wishes } = (await res.json()) as { wishes: Wish[] };
        notifyFound(wishes);
      } catch {}
    }
    tick();
    const t = setInterval(() => !stop && tick(), 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return null;
}

export function notifyFound(wishes: Wish[]) {
  const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN) || "[]"));
  for (const w of wishes) {
    if (w.status === "found" && w.foundProductId && !seen.has(w.id)) {
      seen.add(w.id);
      toast(`Your wish “${w.label}” was found!`, `/product/${w.foundProductId}`, "See it");
    }
  }
  localStorage.setItem(SEEN, JSON.stringify([...seen]));
}
