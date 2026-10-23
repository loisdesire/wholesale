import Link from "next/link";
import { ImportFlow } from "./import-flow";

export default function ImportCataloguePage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/catalogue" className="text-sm text-text-muted hover:text-ink">
          ← Catalogue
        </Link>
        <h1 className="mt-2 text-xl font-medium text-ink">Import catalogue</h1>
        <p className="mt-1 text-sm text-text-muted">
          Upload a CSV, review exactly what will change, then commit — nothing is written until
          you confirm.
        </p>
      </header>

      <ImportFlow />
    </div>
  );
}
