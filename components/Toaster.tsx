"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ToastMsg } from "@/lib/toast";

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const t = { ...(e as CustomEvent<Omit<ToastMsg, "id">>).detail, id: ++n };
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 8000);
    };
    window.addEventListener("tb-toast", on);
    return () => window.removeEventListener("tb-toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="rise pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-xl"
        >
          <span>{t.text}</span>
          {t.href && (
            <Link href={t.href} className="font-semibold text-accent underline">
              {t.linkText ?? "View"}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
