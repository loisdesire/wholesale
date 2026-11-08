import Link from "next/link";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";
import { ArrowLeft, PlusCircle } from "lucide-react";

export default function NewProductPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-12">
      <header className="flex flex-col gap-1.5 border-b border-line pb-4">
        <div>
          <Link
            href="/catalogue"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Catalogue
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm">
            <PlusCircle className="h-4 w-4" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Add Catalogue Product
          </h1>
        </div>
        <p className="text-sm text-text-muted">
          Opening inventory is recorded as the product&apos;s first ledger movement. Stock is never set arbitrarily without an audit entry.
        </p>
      </header>

      <div className="card-base p-6">
        <ProductForm action={createProductAction} submitLabel="Create product" showOpeningStock showImageUpload />
      </div>
    </div>
  );
}
