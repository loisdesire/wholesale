import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSlaSettings } from "@/lib/sla-settings";
import { SlaSettingsForm } from "./settings-form";

export default async function OperationsSettingsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const back = (
    <Link href="/operations" className="text-sm text-text-muted hover:text-ink">
      ← Back to Operations
    </Link>
  );

  if (session!.user.role !== "OWNER") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-sm text-text-muted">Changing these thresholds affects the whole team, so only an owner can do it.</p>
      </div>
    );
  }

  const { overrides, defaults } = await getSlaSettings(organizationId);

  return (
    <div className="flex flex-col gap-6">
      {back}
      <header>
        <h1 className="text-xl font-medium text-ink">Attention thresholds</h1>
        <p className="mt-1 text-sm text-text-muted">
          How long something may wait before the needs-attention queue calls it a warning or a critical exception.
        </p>
      </header>
      <SlaSettingsForm overrides={overrides} defaults={defaults} />
    </div>
  );
}
