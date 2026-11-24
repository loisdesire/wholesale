import Link from "next/link";
import { NewCustomerForm } from "./new-customer-form";

export default function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/customers" className="back-link">
          ← Customers
        </Link>
        <h1 className="mt-2 page-title">New customer</h1>
      </header>
      <NewCustomerForm />
    </div>
  );
}
