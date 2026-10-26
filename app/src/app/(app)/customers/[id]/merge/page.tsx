import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { previewMerge } from "@/lib/customer-merge";
import { MergeForm } from "./merge-form";

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
    <Link href={`/customers/${id}`} className="text-sm text-text-muted hover:text-ink">
      ← Back to customer
    </Link>
  );

  if (session!.user.role !== "OWNER") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-sm text-text-muted">Merging customers changes history, so only an owner can do it.</p>
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
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        {back}
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">Merge customers</h1>
        <p className="mt-1 text-sm text-text-muted">
          Review what will move. Nothing is deleted — the merged record is archived and the merge can be undone.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-status-attention-fg">
          {error}
        </p>
      ) : (
        plan && (
          <>
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-line bg-surface p-4">
                <p className="text-xs font-medium text-status-success-fg">Kept</p>
                <p className="mt-1 text-ink">{label(target)}</p>
                <p className="font-tabular text-sm text-text-muted">{target.phone}</p>
              </div>
              <div className="rounded-md border border-line bg-surface p-4">
                <p className="text-xs font-medium text-status-attention-fg">Merged in and archived</p>
                <p className="mt-1 text-ink">{label(source)}</p>
                <p className="font-tabular text-sm text-text-muted">{source.phone}</p>
              </div>
            </section>
            <p className="text-sm">
              <Link href={swapHref} className="text-ink underline underline-offset-2">
                Keep {label(source)} instead
              </Link>
            </p>

            <section>
              <h2 className="mb-2 text-sm font-medium text-ink">What moves to {label(target)}</h2>
              <ul className="divide-y divide-line rounded-md border border-line bg-surface text-sm">
                <li className="flex justify-between px-4 py-3">
                  <span className="text-ink">Orders</span>
                  <span className="font-tabular text-text-muted">
                    {plan.orders.length === 0 ? "none" : plan.orders.map((o) => o.reference).join(", ")}
                  </span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span className="text-ink">Conversations</span>
                  <span className="font-tabular text-text-muted">{plan.conversationIds.length}</span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span className="text-ink">Returns &amp; refunds</span>
                  <span className="font-tabular text-text-muted">{plan.returnIds.length}</span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span className="text-ink">Delivery addresses</span>
                  <span className="text-text-muted">
                    {plan.addressesToMove.length} moving
                    {plan.addressesAlreadyOnTarget.length > 0 && `, ${plan.addressesAlreadyOnTarget.length} already on the kept record`}
                  </span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span className="text-ink">Agreed prices</span>
                  <span className="text-text-muted">
                    {plan.pricesToMove.length} moving
                    {plan.priceConflicts.length > 0 && `, ${plan.priceConflicts.length} in conflict`}
                  </span>
                </li>
                {Object.keys(plan.fieldChanges).length > 0 && (
                  <li className="flex justify-between px-4 py-3">
                    <span className="text-ink">Details</span>
                    <span className="text-text-muted">
                      {[
                        plan.fieldChanges.name && `name set to “${plan.fieldChanges.name}”`,
                        plan.fieldChanges.email && `email set to ${plan.fieldChanges.email}`,
                        plan.fieldChanges.notesAppended && "notes appended",
                      ]
                        .filter(Boolean)
                        .join("; ")}
                    </span>
                  </li>
                )}
              </ul>
              {plan.priceConflicts.length > 0 && (
                <ul className="mt-2 text-sm text-text-muted">
                  {plan.priceConflicts.map((c) => (
                    <li key={c.productId}>
                      {c.sku}: {label(target)}&apos;s {formatMoney(c.targetPriceCents)} is kept; {formatMoney(c.sourcePriceCents)} stays on the archived record.
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {plan.warnings.length > 0 && (
              <section className="rounded-md border border-line bg-status-attention-bg px-4 py-3 text-sm">
                <h2 className="font-medium text-status-attention-fg">Check before merging</h2>
                <ul className="mt-1 list-disc pl-5 text-text-muted">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            <MergeForm sourceId={source.id} targetId={target.id} sourceLabel={label(source)} targetLabel={label(target)} />
          </>
        )
      )}
    </div>
  );
}
