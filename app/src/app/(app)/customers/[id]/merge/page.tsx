import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { previewMerge } from "@/lib/customer-merge";
import { MergeForm } from "./merge-form";
import { 
  ArrowLeft, 
  ArrowLeftRight, 
  CheckCircle2, 
  Archive, 
  AlertTriangle, 
  ShieldAlert,
  ShoppingBag,
  MessageSquare,
  RotateCcw,
  MapPin,
  Tag,
  UserCheck
} from "lucide-react";

export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string; keep?: string }>;
}) {
  const { id } = await params;
  const { with: otherId, keep } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const back = (
    <Link 
      href={`/customers/${id}`} 
      className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to customer profile
    </Link>
  );

  if (session!.user.role !== "OWNER") {
    return (
      <div className="card-base mx-auto max-w-lg p-6 text-center flex flex-col items-center gap-3">
        <ShieldAlert className="h-8 w-8 text-status-attention-fg" />
        <h2 className="font-display text-lg font-semibold text-ink">Owner Clearance Required</h2>
        <p className="text-sm text-text-muted">
          Merging customer identities irreversibly modifies ledger records and financial history. Only an organization Owner can execute this action.
        </p>
        <div className="mt-2">{back}</div>
      </div>
    );
  }

  const [thisCustomer, otherCustomer] = await Promise.all([
    db.customer.findFirst({ where: { id, organizationId } }),
    otherId ? db.customer.findFirst({ where: { id: otherId, organizationId } }) : null,
  ]);
  if (!thisCustomer || !otherCustomer) notFound();

  // By default the customer whose page you came from is the one that is kept.
  const keepOther = keep === otherCustomer.id;
  const target = keepOther ? otherCustomer : thisCustomer;
  const source = keepOther ? thisCustomer : otherCustomer;
  const label = (c: { name: string | null; phone: string }) => c.name ?? c.phone;

  let plan: Awaited<ReturnType<typeof previewMerge>> | null = null;
  let error: string | null = null;
  try {
    plan = await previewMerge(organizationId, source.id, target.id, { id: session!.user.id, role: session!.user.role });
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not preview this merge.";
  }

  const swapHref = `/customers/${id}/merge?with=${otherCustomer.id}&keep=${keepOther ? thisCustomer.id : otherCustomer.id}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex flex-col gap-1.5">
        <div>{back}</div>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          Merge Customer Identities
        </h1>
        <p className="text-sm text-text-muted">
          Consolidate orders, communications, balances, and addresses. The source record is safely archived and the merge can be inspected in the audit trail.
        </p>
      </header>

      {error ? (
        <div className="card-base border-status-attention-fg/30 bg-status-attention-bg p-4 flex items-center gap-3 text-status-attention-fg text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        plan && (
          <>
            {/* Directional Source -> Target Cards */}
            <section className="relative grid gap-4 md:grid-cols-2">
              {/* Target / Kept */}
              <div className="card-base border-status-success-fg/30 bg-status-success-bg/20 p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-status-success-bg px-2.5 py-0.5 text-xs font-semibold text-status-success-fg">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Primary Record (Kept)
                    </span>
                    <span className="text-xs font-mono text-text-muted">{target.id.slice(0, 8)}…</span>
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold text-ink">{label(target)}</h3>
                  <p className="mt-0.5 font-tabular text-sm text-text-muted">{target.phone}</p>
                </div>
                <p className="mt-4 text-xs text-text-muted">
                  Retains primary customer identity and receives all transferred data.
                </p>
              </div>

              {/* Source / Merged */}
              <div className="card-base border-line bg-paper/30 p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-status-neutral-bg px-2.5 py-0.5 text-xs font-semibold text-status-neutral-fg">
                      <Archive className="h-3.5 w-3.5" /> Merged In (Archived)
                    </span>
                    <span className="text-xs font-mono text-text-muted">{source.id.slice(0, 8)}…</span>
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold text-ink">{label(source)}</h3>
                  <p className="mt-0.5 font-tabular text-sm text-text-muted">{source.phone}</p>
                </div>
                <p className="mt-4 text-xs text-text-muted">
                  Will be archived. Inbound messages from this phone will route to the kept record.
                </p>
              </div>
            </section>

            {/* Swap direction link */}
            <div className="flex justify-end">
              <Link
                href={swapHref}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper transition-colors"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 text-text-muted" />
                <span>Swap direction: Keep {label(source)} instead</span>
              </Link>
            </div>

            {/* Itemized Transfer Summary */}
            <section className="card-base overflow-hidden">
              <div className="border-b border-line bg-paper/50 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  What moves to {label(target)}
                </h2>
              </div>
              <ul className="divide-y divide-line text-sm">
                <li className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5 text-ink">
                    <ShoppingBag className="h-4 w-4 text-text-muted" />
                    <span>Orders</span>
                  </div>
                  <span className="font-tabular text-text-muted">
                    {plan.orders.length === 0 ? "none" : plan.orders.map((o) => o.reference).join(", ")}
                  </span>
                </li>

                <li className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5 text-ink">
                    <MessageSquare className="h-4 w-4 text-text-muted" />
                    <span>WhatsApp Conversations</span>
                  </div>
                  <span className="font-tabular font-medium text-ink">{plan.conversationIds.length}</span>
                </li>

                <li className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5 text-ink">
                    <RotateCcw className="h-4 w-4 text-text-muted" />
                    <span>Returns &amp; Refunds</span>
                  </div>
                  <span className="font-tabular font-medium text-ink">{plan.returnIds.length}</span>
                </li>

                <li className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5 text-ink">
                    <MapPin className="h-4 w-4 text-text-muted" />
                    <span>Delivery Addresses</span>
                  </div>
                  <span className="text-xs text-text-muted">
                    <strong className="text-ink">{plan.addressesToMove.length}</strong> moving
                    {plan.addressesAlreadyOnTarget.length > 0 && `, ${plan.addressesAlreadyOnTarget.length} already exist`}
                  </span>
                </li>

                <li className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5 text-ink">
                    <Tag className="h-4 w-4 text-text-muted" />
                    <span>Agreed Wholesale Prices</span>
                  </div>
                  <span className="text-xs text-text-muted">
                    <strong className="text-ink">{plan.pricesToMove.length}</strong> moving
                    {plan.priceConflicts.length > 0 && ` (${plan.priceConflicts.length} conflict kept on target)`}
                  </span>
                </li>

                {Object.keys(plan.fieldChanges).length > 0 && (
                  <li className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5 text-ink">
                      <UserCheck className="h-4 w-4 text-text-muted" />
                      <span>Profile Details</span>
                    </div>
                    <span className="text-xs text-text-muted">
                      {[
                        plan.fieldChanges.name && `Name updated to "${plan.fieldChanges.name}"`,
                        plan.fieldChanges.email && `Email updated to ${plan.fieldChanges.email}`,
                        plan.fieldChanges.notesAppended && "Notes consolidated",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                )}
              </ul>
            </section>

            {/* Warnings Alert */}
            {plan.warnings.length > 0 && (
              <section className="card-base border-status-attention-fg/30 bg-status-attention-bg/40 p-4">
                <div className="flex items-center gap-2 text-status-attention-fg">
                  <AlertTriangle className="h-4 w-4" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider">Review Before Proceeding</h3>
                </div>
                <ul className="mt-2 list-disc pl-5 text-xs text-ink/80 space-y-1">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Action Form */}
            <MergeForm 
              sourceId={source.id} 
              targetId={target.id} 
              sourceLabel={label(source)} 
              targetLabel={label(target)} 
            />
          </>
        )
      )}
    </div>
  );
}
