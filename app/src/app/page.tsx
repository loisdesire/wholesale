import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  HeroAppMockup,
  VisualFeatureShowcase,
  VisualOrderPipeline,
  StreamlinedPricing,
  MinimalFaq,
} from "./landing-components";
import {
  ArrowRight,
  ArrowUpRight,
  Layers,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

export default async function LandingPage() {
  const session = await auth();

  // If already logged in, redirect directly to dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col selection:bg-accent selection:text-white">
      {/* 1. Sleek Floating Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white font-display text-base font-bold shadow-xs shadow-accent/25 transition-transform group-hover:scale-105">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display text-lg font-bold tracking-tight text-ink block leading-none">
                adaeze
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase text-text-muted">
                Wholesale Operations
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-text-muted">
            <a href="#platform" className="hover:text-ink transition-colors">
              Platform
            </a>
            <a href="#pipeline" className="hover:text-ink transition-colors">
              Pipeline
            </a>
            <a href="#metrics" className="hover:text-ink transition-colors">
              Metrics
            </a>
            <a href="#pricing" className="hover:text-ink transition-colors">
              Pricing
            </a>
            <a href="#faq" className="hover:text-ink transition-colors">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl border border-line bg-surface px-4 py-2 text-xs font-bold text-ink hover:bg-paper transition-all shadow-2xs"
            >
              Sign In
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent-2 transition-all shadow-xs shadow-accent/25"
            >
              <span>Get Started</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Page Flow with generous whitespace (uncongested) */}
      <main className="flex-1 space-y-28 sm:space-y-36 py-12 sm:py-20">
        {/* 2. Hero Section: Clean, Punchy, Visual-First */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-12 text-center">
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/5 px-4 py-1.5 text-xs font-semibold text-accent shadow-2xs">
              <Sparkles className="h-3.5 w-3.5" />
              <span>High-Velocity Operations for Nigerian Wholesalers</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-ink leading-[1.08]">
              Run High-Volume Wholesale.<br />
              <span className="text-accent">From WhatsApp to Warehouse Floor.</span>
            </h1>

            {/* 1 Punchy Subtitle Sentence */}
            <p className="text-base sm:text-lg text-text-muted leading-relaxed font-sans max-w-2xl mx-auto">
              Turn messy buyer WhatsApp voice notes into stock-locked orders. 0% overselling, instant Paystack reconciliation, and 1-click interstate waybills.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-accent/30 hover:bg-accent-2 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <span>Start 14-Day Free Trial</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-6 py-3.5 text-xs sm:text-sm font-semibold text-ink hover:bg-paper transition-all cursor-pointer shadow-2xs"
              >
                <span>Live Command Center</span>
                <ArrowUpRight className="h-4 w-4 text-text-muted" />
              </Link>
            </div>

            {/* Social Proof Strip */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-text-muted">
              <div className="flex -space-x-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white font-mono text-[10px] font-bold border-2 border-paper">
                  MB
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold border-2 border-paper">
                  AS
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white font-mono text-[10px] font-bold border-2 border-paper">
                  NE
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-white font-mono text-[10px] font-bold border-2 border-paper">
                  CO
                </span>
              </div>
              <span className="font-medium">
                Powering over <strong className="font-tabular text-ink">₦140M+</strong> monthly volume across Balogun, Aba, and Kano.
              </span>
            </div>
          </div>

          {/* Centered Layered App Window Mockup */}
          <HeroAppMockup />
        </section>

        {/* 3. Section 1: The Visual Platform Engine (Interactive Showcase with Minimal Copy) */}
        <section id="platform" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
              Core Architecture
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              Built for Speed. Grounded in Precision.
            </h2>
          </div>

          <VisualFeatureShowcase />
        </section>

        {/* 4. Section 2: Large Visual Impact Metrics (Clean & Spacious) */}
        <section id="metrics" className="border-y border-line bg-surface/50 py-16 sm:py-20">
          <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
              <div className="space-y-1">
                <span className="font-display text-4xl sm:text-6xl font-bold font-tabular text-accent block tracking-tight">
                  ₦140M+
                </span>
                <span className="text-xs sm:text-sm font-bold text-ink block">
                  Monthly Throughput
                </span>
                <span className="text-[11px] text-text-muted block">
                  Major commercial corridors
                </span>
              </div>

              <div className="space-y-1">
                <span className="font-display text-4xl sm:text-6xl font-bold font-tabular text-emerald-700 block tracking-tight">
                  0.00%
                </span>
                <span className="text-xs sm:text-sm font-bold text-ink block">
                  Oversell Rate
                </span>
                <span className="text-[11px] text-text-muted block">
                  PostgreSQL row-locked
                </span>
              </div>

              <div className="space-y-1">
                <span className="font-display text-4xl sm:text-6xl font-bold font-tabular text-ink block tracking-tight">
                  0.84s
                </span>
                <span className="text-xs sm:text-sm font-bold text-ink block">
                  Quote Turnaround
                </span>
                <span className="text-[11px] text-text-muted block">
                  Audio note to draft slip
                </span>
              </div>

              <div className="space-y-1">
                <span className="font-display text-4xl sm:text-6xl font-bold font-tabular text-gold block tracking-tight">
                  99.98%
                </span>
                <span className="text-xs sm:text-sm font-bold text-ink block">
                  Payment Accuracy
                </span>
                <span className="text-[11px] text-text-muted block">
                  Automated Paystack matches
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Section 3: Visual 3-Stage Order Pipeline */}
        <section id="pipeline" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
              End-to-End Flow
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              How High-Volume Orders Flow
            </h2>
          </div>

          <VisualOrderPipeline />
        </section>

        {/* 6. Section 4: Streamlined Wholesale Pricing */}
        <section id="pricing" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
              Predictable Pricing
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              Simple Wholesale Plans
            </h2>
          </div>

          <StreamlinedPricing />
        </section>

        {/* 7. Section 5: Essential FAQ (Minimal & Spacious) */}
        <section id="faq" className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
              Common Inquiries
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
              Frequently Asked Questions
            </h2>
          </div>

          <MinimalFaq />
        </section>

        {/* 8. High-Impact Closing Banner */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="relative rounded-[32px] bg-ink p-8 sm:p-14 lg:p-16 text-center text-paper overflow-hidden border border-white/10 shadow-2xl">
            {/* Ambient Lighting */}
            <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 right-10 h-80 w-80 rounded-full bg-gold/20 blur-3xl" />

            <div className="relative z-10 max-w-3xl mx-auto space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-bold font-mono uppercase tracking-wider text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>14-Day Free Trial · Instant Activation</span>
              </span>

              <h2 className="font-display text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-tight">
                Ready to Upgrade Your Wholesale Operations?
              </h2>

              <p className="text-sm sm:text-base text-white/70 max-w-xl mx-auto leading-relaxed">
                Start handling wholesale orders with zero inventory double-selling and automated bank settlement.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-4 text-xs sm:text-sm font-bold text-white shadow-xl shadow-accent/40 hover:bg-accent-2 transition-all hover:scale-[1.02] cursor-pointer"
                >
                  <span>Start Free Trial Now</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-4 text-xs sm:text-sm font-semibold text-white hover:bg-white/10 transition-all cursor-pointer backdrop-blur-md"
                >
                  <span>Explore Command Center</span>
                </Link>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-center gap-6 text-xs text-white/60">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>No credit card required</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>5-minute setup</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Cancel anytime</span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 9. Minimal Footer */}
      <footer className="border-t border-line bg-surface py-12 px-4 sm:px-6 lg:px-8 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white font-display text-sm font-bold shadow-xs">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <span className="font-display text-base font-bold text-ink">adaeze</span>
              <span className="text-xs text-text-muted block">High-Velocity Wholesale Platform</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs font-semibold text-text-muted">
            <a href="#platform" className="hover:text-ink transition-colors">Platform</a>
            <a href="#pipeline" className="hover:text-ink transition-colors">Pipeline</a>
            <a href="#metrics" className="hover:text-ink transition-colors">Metrics</a>
            <a href="#pricing" className="hover:text-ink transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-ink transition-colors">FAQ</a>
            <Link href="/login" className="hover:text-ink transition-colors">Sign In</Link>
          </div>

          <div className="text-xs text-text-muted font-mono">
            © {new Date().getFullYear()} Adaeze · Built for Nigerian wholesale commerce.
          </div>
        </div>
      </footer>
    </div>
  );
}
