import { MerchantNav } from "@/components/MerchantNav";
import { GapsBoard } from "@/components/GapsBoard";

export default function GapsPage() {
  return (
    <div className="pt-10">
      <MerchantNav active="gaps" />
      <h1 className="font-display text-5xl font-semibold">Demand Gaps</h1>
      <p className="mt-2 max-w-2xl text-muted">
        What shoppers asked for and couldn’t find, grouped by canonical edit. Live groups with fewer than 3 shoppers are
        hidden. Rows marked <span className="rounded bg-soft px-1.5 py-0.5 text-xs font-semibold">Demo data</span> are
        seeded aggregates, not real shoppers.
      </p>
      <GapsBoard />
    </div>
  );
}
