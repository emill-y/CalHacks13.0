import Link from "next/link";

export function MerchantNav({ active }: { active: "gaps" | "add" }) {
  const cls = (on: boolean) => `rounded-full px-4 py-1.5 text-sm ${on ? "bg-ink text-paper" : "border border-line"}`;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <span className="mr-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted">Merchant</span>
      <Link href="/merchant/gaps" className={cls(active === "gaps")}>Demand Gaps</Link>
      <Link href="/merchant/add" className={cls(active === "add")}>Add product</Link>
    </div>
  );
}
