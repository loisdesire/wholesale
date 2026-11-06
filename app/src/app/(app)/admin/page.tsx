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
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-attention-bg text-status-attention-fg">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Restricted Operator Surface</h2>
          <p className="mt-2 text-sm text-text-muted leading-relaxed">
            This workspace is reserved for platform administrators and system operators. Your account does not possess operator clearance.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:bg-ink/90"
          >
            <ArrowLeft className="h-4 w-4" /> Return to Dashboard
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
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> Platform Operator Control Plane
          </span>
          <span className="text-xs text-text-muted">· Restricted Access</span>
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

      {/* 4-KPI Platform Metrics Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Tenants */}
        <div className="card-base p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Total Tenants</span>
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

        {/* Platform Monthly Orders */}
        <div className="card-base p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Orders (This Period)</span>
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

        {/* Total Staff Seats */}
        <div className="card-base p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Active Staff Seats</span>
            <Users className="h-4 w-4 text-ink" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">{totalStaffSeats}</span>
            <p className="mt-1 text-xs text-text-muted">
              Operators with system access
            </p>
          </div>
        </div>

        {/* AI Inquiries Handled */}
        <div className="card-base p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">AI Automated Replies</span>
            <Sparkles className="h-4 w-4 text-gold" />
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl font-semibold text-ink">
              {totalAiReplies.toLocaleString()}
            </span>
            <p className="mt-1 text-xs text-text-muted">
              WhatsApp customer inquiries handled
            </p>
          </div>
        </div>
      </section>

      {/* Tenants Table Workspace */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">Organizations & Subscriptions</h2>
          <span className="text-xs text-text-muted font-tabular">{totalTenants} total tenants</span>
        </div>
        <AdminTable overview={overview} />
      </section>

      {/* Operator Safety & Governance Callout */}
      <section className="card-base border-line/80 bg-paper/40 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-paper">
            <Lock className="h-5 w-5" />
          </div>
          <div className="flex flex-col gap-1 text-xs text-text-muted leading-relaxed">
            <span className="font-medium text-ink text-sm">Tenant Isolation & Audit Trail Guarantees</span>
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
