import Link from "next/link";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default function NewProductPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/catalogue" className="back-link">
          ← Catalogue
        </Link>
        <h1 className="mt-2 page-title">New product</h1>
      </header>

      <ProductForm action={createProductAction} submitLabel="Create product" showOpeningStock />
    </div>
  );
}
