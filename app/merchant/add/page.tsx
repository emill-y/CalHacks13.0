import { MerchantNav } from "@/components/MerchantNav";
import { AddProductForm } from "@/components/AddProductForm";

export default function AddPage() {
  return (
    <div className="pt-10">
      <MerchantNav active="add" />
      <h1 className="font-display text-5xl font-semibold">Add a product</h1>
      <p className="mt-2 max-w-xl text-muted">
        It’s embedded and searchable instantly — and checked against every open wish. Matching shoppers get notified.
      </p>
      <AddProductForm />
    </div>
  );
}
