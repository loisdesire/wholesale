import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSlaSettings } from "@/lib/sla-settings";
import { prisma } from "@/lib/prisma";
import { SlaSettingsForm } from "./settings-form";
import { CustomerMessagesForm } from "./customer-messages-form";

export const metadata = { title: "Settings" };

export default async function OperationsSettingsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const back = (
    <Link href="/operations" className="back-link">
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
  const { notifyCustomerOnShip, aiAutoReply } = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { notifyCustomerOnShip: true, aiAutoReply: true } });

  return (
    <div className="flex flex-col gap-6">
      {back}
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">Customer messages, and how long things may wait before they are flagged.</p>
      </header>
      <CustomerMessagesForm notifyOnShip={notifyCustomerOnShip} aiAutoReply={aiAutoReply} />
      <SlaSettingsForm overrides={overrides} defaults={defaults} />
    </div>
  );
}
