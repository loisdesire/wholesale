import Link from "next/link";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default function NewProductPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/catalogue" className="text-sm text-text-muted hover:text-ink">
          ← Catalogue
        </Link>
        <h1 className="mt-2 text-xl font-medium text-ink">New product</h1>
        <p className="mt-1 text-sm text-text-muted">
          Opening stock is recorded as the product&apos;s first ledger movement — stock is never
          set directly.
        </p>
      </header>

      <ProductForm action={createProductAction} submitLabel="Create product" showOpeningStock />
    </div>
  );
}
