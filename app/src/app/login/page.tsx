import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrlRaw = params.callbackUrl;
  const callbackUrl = typeof callbackUrlRaw === "string" ? callbackUrlRaw : "/";

  return (
    <div className="flex min-h-screen w-full bg-paper">
      <div className="flex flex-1 flex-col px-6 py-6 sm:px-10">
        <Link href="/" aria-label="Adaeze Wholesale home" className="self-start">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink">Welcome back</h1>
            <p className="mt-2 text-[15px] text-text-muted">Sign in with your staff account to pick up where the team left off.</p>
            <div className="card mt-7 p-5 sm:p-6">
              <LoginForm callbackUrl={callbackUrl} />
            </div>
          </div>
        </div>
      </div>

      {/* The right panel shows what's waiting inside rather than a slogan: one order, mid-journey. */}
      <div className="relative hidden w-[46%] overflow-hidden bg-accent p-10 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.9) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <p className="relative max-w-md font-display text-4xl font-extrabold leading-[1.05] tracking-[-0.03em] text-white xl:text-5xl">
          Every enquiry becomes an order with a status, an owner and a{" "}
          <span className="rounded-md bg-gold px-1.5 text-gold-ink">record</span>.
        </p>

        <div className="relative mx-auto w-full max-w-md">
          <div className="rounded-2xl bg-surface p-5 shadow-pop">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-text-muted">ORD-1003</p>
                <p className="mt-0.5 font-display text-3xl font-bold tracking-tight text-ink">₦159,000</p>
                <p className="text-sm text-text-muted">Blessing Nwachukwu</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-progress-bg px-2 py-0.5 text-xs font-semibold text-status-progress-fg">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Confirmed
              </span>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-1.5">
              {["Draft", "Confirmed", "Paid", "Fulfilled"].map((s, i) => (
                <div key={s} className="flex flex-col gap-1.5">
                  <span className={`h-1.5 rounded-full ${i === 0 ? "bg-status-success-fg" : i === 1 ? "bg-accent" : "bg-line"}`} />
                  <span className={`text-xs ${i === 1 ? "font-semibold text-ink" : "text-text-muted"}`}>{s}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="anim-pop -mt-3 ml-auto flex w-fit items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 text-white shadow-pop" style={{ animationDelay: "0.4s" }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-gold-ink">
              <BadgeCheck size={17} />
            </span>
            <div className="text-sm leading-tight">
              <p className="font-semibold">Stock reserved</p>
              <p className="text-xs text-white/60">6 pairs held for this order</p>
            </div>
          </div>
        </div>

        <p className="relative text-sm font-medium text-white/70">Inbox · Orders · Stock · Payments · Reports</p>
      </div>
    </div>
  );
}
