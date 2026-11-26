import Link from "next/link";
import { auth } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-admin";
import { AdminTable } from "./admin-table";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "Platform admin" };

export default async function PlatformAdminPage() {
  const session = await auth();

  // Security guard for non-platform operators
  if (!session?.user?.isPlatformAdmin) {
    return (
      <div className="card mx-auto my-12 flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <ShieldAlert size={26} className="text-status-attention-fg" />
        <h1 className="font-display text-xl font-bold text-ink">Platform admins only</h1>
        <p className="text-sm text-text-muted">Your account doesn&apos;t have operator access.</p>
        <Link href="/dashboard" className="btn btn-dark mt-1">
          Back to dashboard
        </Link>
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

  const stats = [
    { label: "Tenants", value: String(totalTenants), note: `${activeTenants} active · ${trialingTenants} trialing${pastDueTenants > 0 ? ` · ${pastDueTenants} past due` : ""}`, alert: pastDueTenants > 0 },
    { label: "Orders this month", value: totalMonthlyOrders.toLocaleString(), note: "All tenants" },
    { label: "Staff seats", value: String(totalStaffSeats), note: "With system access" },
    { label: "AI replies", value: totalAiReplies.toLocaleString(), note: "WhatsApp and Telegram" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">Platform admin</h1>
        <p className="mt-0.5 text-sm text-text-muted">Every organization. Support actions are logged in that tenant&apos;s audit trail.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((st) => (
          <div key={st.label} className="card p-4 sm:p-5">
            <p className="text-xs font-medium text-text-muted">{st.label}</p>
            <p className="mt-1.5 font-display text-3xl font-bold leading-none tracking-tight text-ink">{st.value}</p>
            <p className={`mt-2 text-xs ${st.alert ? "font-medium text-status-attention-fg" : "text-text-muted"}`}>{st.note}</p>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title">Organizations</h2>
        <AdminTable overview={overview} />
      </section>

      <p className="text-xs text-text-muted">Operators can&apos;t see customer records, stock or messages from here.</p>
    </div>
  );
}
