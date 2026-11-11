import { LoginForm } from "./login-form";
import { ShieldCheck, Sparkles, Zap } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrlRaw = params.callbackUrl;
  const callbackUrl =
    typeof callbackUrlRaw === "string" && callbackUrlRaw !== "/"
      ? callbackUrlRaw
      : "/dashboard";

  return (
    <div className="relative flex min-h-screen w-full flex-col md:flex-row bg-paper selection:bg-accent selection:text-white">
      {/* Visual / Brand Hero Section */}
      <div className="relative hidden w-[48%] flex-col justify-between overflow-hidden bg-ink p-12 text-paper lg:flex xl:p-16">
        {/* Subtle geometric dot grid pattern */}
        <div 
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)`,
            backgroundSize: "28px 28px",
          }}
        />

        {/* Top brand header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <span className="font-display text-xl font-bold text-white">A</span>
          </div>
          <div>
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Adaeze Wholesale
            </span>
            <span className="block text-xs font-medium text-white/70 tracking-wide">
              Operations Platform
            </span>
          </div>
        </div>

        {/* Hero Value Prop */}
        <div className="relative z-10 my-auto max-w-lg space-y-8 py-10">
          <div className="space-y-4">
            <span className="flex items-center gap-2 text-xs font-medium text-gold">
              <Sparkles className="h-3.5 w-3.5" />
              WhatsApp-to-fulfillment hub
            </span>
            <h2 className="font-display text-3xl xl:text-4xl leading-[1.2] font-semibold text-white">
              Every customer chat turned into a verified, trackable wholesale order.
            </h2>
            <p className="text-base text-white/75 leading-relaxed font-normal">
              Eliminate double-entry and overselling with real-time stock reservations, automated payment reconciliations, and instant staff handoffs.
            </p>
          </div>

          {/* Key pillars */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-gold">
                <Zap className="h-4 w-4" />
                <span className="font-tabular text-sm font-semibold text-white">Zero Overselling</span>
              </div>
              <p className="mt-1 text-xs text-white/70 leading-normal">
                Pessimistic row-locking keeps stock figures true even during high-volume drops.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                <span className="font-tabular text-sm font-semibold text-white">Row-Level Security</span>
              </div>
              <p className="mt-1 text-xs text-white/70 leading-normal">
                Strict tenant isolation protecting customer prices, margins, and inventory data.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 text-xs text-white/70">
          <span>Enterprise Wholesale Portal</span>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-white/75">System Operational</span>
          </div>
        </div>
      </div>

      {/* Login Card Form Section */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-12 md:px-12 lg:px-16">
        <div className="w-full max-w-md">
          {/* Mobile brand header */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
              <span className="font-display text-xl font-bold text-white">A</span>
            </div>
            <div>
              <span className="font-display text-lg font-semibold tracking-tight text-ink">
                Adaeze Wholesale
              </span>
              <span className="block text-xs font-medium text-text-muted tracking-wide">
                Operations Platform
              </span>
            </div>
          </div>

          {/* Form card wrapper with subtle shadow and border */}
          <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm transition-all sm:p-10">
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Welcome back
              </h1>
              <p className="text-sm text-text-muted">
                Enter your staff credentials to access your organization dashboard.
              </p>
            </div>

            <LoginForm callbackUrl={callbackUrl} />

            <div className="mt-8 border-t border-line/80 pt-6 text-center">
              <p className="text-xs text-text-muted">
                Need access or password assistance?{" "}
                <span className="font-medium text-ink">Contact your administrator</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
