import Link from "next/link";
import { auth } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-admin";
import { AdminTable } from "./admin-table";
import { 
  ShieldCheck, 
  ShieldAlert, 
  Building2, 
  ShoppingBag, 
  Users, 
  Sparkles, 
  ArrowLeft, 
  Lock
} from "lucide-react";

export default async function PlatformAdminPage() {
  const session = await auth();

  // Security guard for non-platform operators
  if (!session?.user?.isPlatformAdmin) {
    return (
      <div className="mx-auto my-12 max-w-lg card-base p-8 text-center flex flex-col items-center gap-4">
        <ShieldAlert className="h-7 w-7 text-status-attention-fg" />
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Restricted operator surface</h2>
          <p className="mt-2 text-sm text-text-muted leading-relaxed">
            This workspace is reserved for platform administrators and system operators. Your account does not possess operator clearance.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
          >
            <ArrowLeft className="h-4 w-4" /> Return to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const overview = await getPlatformOverview();

  // Aggregate Platform Metrics
  const totalTenants = overview.length;
  const activeTenants = overview.filter((o) => o.subscriptionStatus === "ACTIVE").length;
  const trialingTenants = overview.filter((o) => o.subscriptionStatus === "TRIALING").length;
  const pastDueTenants = overview.filter((o) => o.subscriptionStatus === "PAST_DUE").length;

  const totalMonthlyOrders = overview.reduce((acc, o) => acc + o.ordersThisPeriod, 0);
  const totalStaffSeats = overview.reduce((acc, o) => acc + o.staffSeats, 0);
  const totalAiReplies = overview.reduce((acc, o) => acc + o.aiRepliesThisPeriod, 0);

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Top Header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Platform operator control plane — restricted access</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Platform Administration
        </h1>
        <p className="max-w-3xl text-sm text-text-muted leading-relaxed">
          Cross-tenant oversight and emergency operational support. Tenant usage is queried strictly through standard
          isolated boundaries. Support actions (extending a trial or unsticking a past-due subscription) are directly
          committed to that tenant&apos;s immutable audit ledger.
        </p>
      </header>

      {/* Platform metrics — one hairline-divided row instead of four identical cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-line border border-line">
        <div className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs">Total tenants</span>
            <Building2 className="h-4 w-4 text-ink" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">{totalTenants}</span>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
              <span className="font-medium text-status-success-fg">{activeTenants} active</span>
              <span>·</span>
              <span className="font-medium text-status-progress-fg">{trialingTenants} trialing</span>
              {pastDueTenants > 0 && (
                <>
                  <span>·</span>
                  <span className="font-medium text-status-attention-fg">{pastDueTenants} past due</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs">Orders (this period)</span>
            <ShoppingBag className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">
              {totalMonthlyOrders.toLocaleString()}
            </span>
            <p className="mt-1 text-xs text-text-muted">
              Wholesale volume across all tenants
            </p>
          </div>
        </div>

        <div className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs">Active staff seats</span>
            <Users className="h-4 w-4 text-ink" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">{totalStaffSeats}</span>
            <p className="mt-1 text-xs text-text-muted">
              Operators with system access
            </p>
          </div>
        </div>

        <div className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs">AI automated replies</span>
            <Sparkles className="h-4 w-4 text-gold" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">
              {totalAiReplies.toLocaleString()}
            </span>
            <p className="mt-1 text-xs text-text-muted">
              Customer inquiries handled (WhatsApp &amp; Telegram)
            </p>
          </div>
        </div>
      </section>

      {/* Tenants Table Workspace */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-lg font-semibold text-ink">Organizations &amp; subscriptions</h2>
          <span className="text-xs text-text-muted font-tabular">{totalTenants} total tenants</span>
        </div>
        <AdminTable overview={overview} />
      </section>

      {/* Operator Safety & Governance Callout */}
      <section className="border border-line bg-paper/40 p-5">
        <div className="flex items-start gap-4">
          <Lock className="h-5 w-5 shrink-0 text-ink" />
          <div className="flex flex-col gap-1 text-xs text-text-muted leading-relaxed">
            <span className="font-medium text-ink text-sm">Tenant isolation &amp; audit trail guarantees</span>
            <p>
              Platform operators cannot view raw customer records, inventory ledgers, or messages from this screen.
              The platform overview executes through scoped <code className="text-xs text-ink font-semibold">getUsage()</code> calls
              per tenant. Any support intervention (extending trial runway or restoring past-due subscriptions) executes
              inside the target tenant&apos;s transaction and appends an immutable <code className="text-xs text-ink font-semibold">AuditLog</code> event
              attributed to your operator identity.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
