import Link from "next/link";
import { NewCustomerForm } from "./new-customer-form";

export default function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/customers" className="text-sm text-text-muted hover:text-ink">
          ← Customers
        </Link>
        <h1 className="mt-2 text-xl font-medium text-ink">New customer</h1>
        <p className="mt-1 text-sm text-text-muted">
          A phone number identifies a customer however it&apos;s written (0803…, +234 803…), so the same person
          can&apos;t be added twice.
        </p>
      </header>
      <NewCustomerForm />
    </div>
  );
}
