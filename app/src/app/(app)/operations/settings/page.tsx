import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSlaSettings } from "@/lib/sla-settings";
import { SlaSettingsForm } from "./settings-form";
import { ArrowLeft, ShieldAlert, Sliders } from "lucide-react";

export default async function OperationsSettingsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const back = (
    <Link 
      href="/operations" 
      className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to Operations Queue
    </Link>
  );

  if (session!.user.role !== "OWNER") {
    return (
      <div className="card-base mx-auto max-w-lg p-6 text-center flex flex-col items-center gap-3">
        <ShieldAlert className="h-8 w-8 text-status-attention-fg" />
        <h2 className="font-display text-lg font-semibold text-ink">Owner Clearance Required</h2>
        <p className="text-sm text-text-muted">
          Changing operational SLA thresholds affects triage priority for the whole team. Only an organization Owner can customize these settings.
        </p>
        <div className="mt-2">{back}</div>
      </div>
    );
  }

  const { overrides, defaults } = await getSlaSettings(organizationId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex flex-col gap-1.5 border-b border-line pb-4">
        <div>{back}</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper">
            <Sliders className="h-4 w-4" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Attention & SLA Thresholds
          </h1>
        </div>
        <p className="text-sm text-text-muted">
          Define how long orders, customer inquiries, returns, and refunds may wait before triggering warning and critical priority alerts.
        </p>
      </header>

      <SlaSettingsForm overrides={overrides} defaults={defaults} />
    </div>
  );
}
