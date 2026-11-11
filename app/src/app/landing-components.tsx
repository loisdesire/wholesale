"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Lock,
  Truck,
  CreditCard,
  MessageSquare,
  Printer,
  PackageCheck,
  CheckCircle2,
  Volume2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* 1. Hero Layered App Window                                         */
/* ------------------------------------------------------------------ */

export function HeroAppMockup() {
  const [activeTab, setActiveTab] = useState<"orders" | "whatsapp" | "inventory">("orders");

  return (
    <div className="relative mx-auto w-full max-w-6xl">
      {/* Floating Tactical Badges */}
      <div className="hidden lg:flex absolute -top-5 -left-4 z-20 items-center gap-2 rounded-full border border-emerald-400/30 bg-ink/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span>Paystack Settled: <strong className="text-emerald-400 font-tabular">₦3,875,000</strong></span>
      </div>

      <div className="hidden lg:flex absolute -top-5 -right-4 z-20 items-center gap-2 rounded-full border border-accent/40 bg-ink/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
        <Lock className="h-3.5 w-3.5 text-accent" />
        <span>Row-Locked: <strong className="text-white font-tabular">35 Units Deducted</strong></span>
      </div>

      <div className="hidden lg:flex absolute -bottom-5 -left-4 z-20 items-center gap-2 rounded-full border border-amber-400/30 bg-ink/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
        <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
        <span>WhatsApp Intake: <strong className="text-amber-300">Madam Blessing</strong> · 0.84s SLA</span>
      </div>

      <div className="hidden lg:flex absolute -bottom-5 -right-4 z-20 items-center gap-2 rounded-full border border-white/20 bg-ink/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
        <Truck className="h-3.5 w-3.5 text-gold" />
        <span>Waybill: <strong className="text-white">GIG Logistics / Jibowu</strong></span>
      </div>

      {/* Main Elevated Software Container */}
      <div className="rounded-[28px] border border-line bg-surface shadow-2xl overflow-hidden text-ink">
        {/* Browser / App Header Bar */}
        <div className="flex items-center justify-between border-b border-line bg-paper/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-rose-500/80" />
              <span className="h-3 w-3 rounded-full bg-amber-500/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="ml-2 font-mono text-xs text-text-muted hidden sm:inline">
              adaeze.wholesale / operations / live-fulfillment-conveyor
            </span>
          </div>

          {/* View Mode Tabs */}
          <div className="flex items-center gap-1 rounded-xl bg-paper border border-line p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`rounded-lg px-3 py-1.5 transition-all cursor-pointer ${
                activeTab === "orders"
                  ? "bg-accent text-white"
                  : "text-ink/70 hover:text-ink"
              }`}
            >
              Fulfillment Conveyor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("whatsapp")}
              className={`rounded-lg px-3 py-1.5 transition-all cursor-pointer ${
                activeTab === "whatsapp"
                  ? "bg-accent text-white"
                  : "text-ink/70 hover:text-ink"
              }`}
            >
              WhatsApp Ingestion
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("inventory")}
              className={`rounded-lg px-3 py-1.5 transition-all cursor-pointer ${
                activeTab === "inventory"
                  ? "bg-accent text-white"
                  : "text-ink/70 hover:text-ink"
              }`}
            >
              Stock Ledger
            </button>
          </div>
        </div>

        {/* Tab 1: Fulfillment Conveyor Window */}
        {activeTab === "orders" && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-line bg-paper/50 p-3.5">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span className="font-mono font-bold">01 DRAFT</span>
                  <span className="font-bold text-ink">4</span>
                </div>
                <p className="font-display text-lg font-bold font-tabular text-ink mt-1">₦3,120,000</p>
                <span className="text-xs text-text-muted">Awaiting confirmation</span>
              </div>

              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3.5">
                <div className="flex items-center justify-between text-xs text-accent">
                  <span className="font-mono font-bold">02 LOCKED</span>
                  <span className="font-bold">2</span>
                </div>
                <p className="font-display text-lg font-bold font-tabular text-accent mt-1">₦5,315,000</p>
                <span className="text-xs text-accent/80">Awaiting bank alert</span>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                <div className="flex items-center justify-between text-xs text-emerald-800">
                  <span className="font-mono font-bold">03 SETTLED</span>
                  <span className="font-bold">6</span>
                </div>
                <p className="font-display text-lg font-bold font-tabular text-emerald-800 mt-1">₦18,450,000</p>
                <span className="text-xs text-emerald-700">Released to warehouse</span>
              </div>

              <div className="rounded-xl border border-line bg-paper/50 p-3.5">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span className="font-mono font-bold">04 DISPATCHED</span>
                  <span className="font-bold text-ink">12</span>
                </div>
                <p className="font-display text-lg font-bold font-tabular text-ink mt-1">₦34,800,000</p>
                <span className="text-xs text-text-muted">In interstate transit</span>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[650px]">
                  <thead>
                    <tr className="border-b border-line bg-paper/60 text-text-muted font-semibold">
                      <th className="py-2.5 px-4 font-mono">ORDER REF</th>
                      <th className="py-2.5 px-4">CUSTOMER / CORRIDOR</th>
                      <th className="py-2.5 px-4">ITEMS</th>
                      <th className="py-2.5 px-4">LOCK STATUS</th>
                      <th className="py-2.5 px-4 text-right">TOTAL (NGN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    <tr className="hover:bg-paper/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-ink">#ORD-1004</td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-ink block">Madam Blessing Fabrics</span>
                        <span className="text-xs text-text-muted">Ariaria Market, Aba</span>
                      </td>
                      <td className="py-3 px-4 text-text-muted">
                        20 cartons Dutch Wax, 15 bundles Swiss Voile
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                          <Check className="h-3 w-3" />
                          <span>35 units locked</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-display font-bold font-tabular text-ink">
                        ₦3,875,000
                      </td>
                    </tr>
                    <tr className="hover:bg-paper/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-ink">#ORD-1003</td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-ink block">Alhaji Sani &amp; Sons</span>
                        <span className="text-xs text-text-muted">Kantin Kwari, Kano</span>
                      </td>
                      <td className="py-3 px-4 text-text-muted">
                        50 bundles Super Wax Hollandais
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                          <Lock className="h-3 w-3" />
                          <span>Pending VA alert</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-display font-bold font-tabular text-ink">
                        ₦6,250,000
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: WhatsApp Ingestion Window */}
        {activeTab === "whatsapp" && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="font-display text-sm font-bold text-ink">
                  WhatsApp Cloud API, live inbound channel
                </span>
              </div>
              <span className="font-mono text-xs text-text-muted">Session: +234 803 441 2981</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-line bg-paper/50 p-4 space-y-3">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-text-muted block">
                  Inbound Buyer Audio (0.84s parse)
                </span>
                <div className="flex items-center gap-3 bg-surface border border-line rounded-xl p-3 shadow-2xs">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 w-full bg-line rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-700 w-3/4" />
                    </div>
                    <span className="text-xs text-text-muted mt-1 block truncate">
                      &quot;Send 20 cartons of the Dutch Wax to Aba...&quot;
                    </span>
                  </div>
                  <span className="font-mono text-xs text-text-muted">0:14</span>
                </div>
              </div>

              <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 space-y-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-accent block">
                  Generated Draft Order
                </span>
                <div className="bg-surface border border-accent/20 rounded-xl p-3 text-xs space-y-1 shadow-2xs">
                  <div className="flex justify-between font-bold text-ink">
                    <span>20x Dutch Wax Hollandais</span>
                    <span className="font-tabular">₦2,900,000</span>
                  </div>
                  <div className="flex justify-between font-bold text-ink">
                    <span>15x Swiss Voile Lace</span>
                    <span className="font-tabular">₦975,000</span>
                  </div>
                  <div className="pt-2 border-t border-line flex justify-between font-display font-bold text-accent text-sm">
                    <span>Total Amount</span>
                    <span className="font-tabular">₦3,875,000</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Stock Ledger Window */}
        {activeTab === "inventory" && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <span className="font-display text-sm font-bold text-ink">
                  Real-time Row-Locked Inventory
                </span>
                <span className="text-xs text-text-muted block">
                  Physical floor vs. reserved quotes
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                <Lock className="h-3 w-3" />
                <span>Lock Active</span>
              </span>
            </div>

            <div className="divide-y divide-line/60 text-xs">
              <div className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-display font-bold text-ink block">Dutch Wax Hollandais 6-Yards</span>
                  <span className="font-mono text-text-muted">SKU: WAX-DUTCH-01 · ₦145,000 / carton</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <span className="text-text-muted block text-xs">Floor Stock</span>
                    <strong className="font-tabular text-ink">140 cartons</strong>
                  </div>
                  <div>
                    <span className="text-text-muted block text-xs">Locked</span>
                    <strong className="font-tabular text-accent">20 cartons</strong>
                  </div>
                  <div>
                    <span className="text-text-muted block text-xs">Free to Sell</span>
                    <strong className="font-tabular text-emerald-700">120 cartons</strong>
                  </div>
                </div>
              </div>

              <div className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-display font-bold text-ink block">Swiss Voile Lace Super-Deluxe</span>
                  <span className="font-mono text-text-muted">SKU: LACE-VOILE-04 · ₦65,000 / bundle</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <span className="text-text-muted block text-xs">Floor Stock</span>
                    <strong className="font-tabular text-ink">85 bundles</strong>
                  </div>
                  <div>
                    <span className="text-text-muted block text-xs">Locked</span>
                    <strong className="font-tabular text-accent">15 bundles</strong>
                  </div>
                  <div>
                    <span className="text-text-muted block text-xs">Free to Sell</span>
                    <strong className="font-tabular text-emerald-700">70 bundles</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Visual Platform Feature Showcase (Uncongested, High Visuals)     */
/* ------------------------------------------------------------------ */

export function VisualFeatureShowcase() {
  const [selectedFeature, setSelectedFeature] = useState<0 | 1 | 2>(0);

  const features = [
    {
      id: 0,
      title: "Inbound WhatsApp Stream",
      sub: "Voice notes to structured orders in <1s.",
      icon: MessageSquare,
    },
    {
      id: 1,
      title: "Pessimistic Row-Locking",
      sub: "Atomic stock reserves prevent double-sales.",
      icon: Lock,
    },
    {
      id: 2,
      title: "Automated Paystack Settlement",
      sub: "Dedicated virtual accounts release goods instantly.",
      icon: CreditCard,
    },
  ];

  return (
    <div className="space-y-8">
      {/* 3 Clickable Filter Pills */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {features.map((f) => {
          const Icon = f.icon;
          const isActive = selectedFeature === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFeature(f.id as 0 | 1 | 2)}
              className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                isActive
                  ? "bg-ink text-white shadow-lg shadow-ink/15 scale-[1.02]"
                  : "bg-surface border border-line text-ink/70 hover:text-ink hover:bg-paper"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-accent" : "text-text-muted"}`} />
              <span>{f.title}</span>
            </button>
          );
        })}
      </div>

      {/* Grand Elevated Visual Stage */}
      <div className="rounded-[32px] border border-line bg-surface p-6 sm:p-10 lg:p-12 shadow-xl">
        {selectedFeature === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
                Audio &amp; DM Parsing
              </span>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
                Buyers speak on WhatsApp. You fulfill with precision.
              </h3>
              <p className="text-sm text-text-muted leading-relaxed">
                Wholesale buyers don&apos;t browse web carts. They send WhatsApp voice notes and fabric photos. Adaeze extracts the SKUs, looks up their VIP price tier, and returns a verified order slip in seconds.
              </p>
              <div className="pt-2 flex items-center gap-3 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Zero manual typing into spreadsheets</span>
              </div>
            </div>

            <div className="lg:col-span-7 rounded-2xl border border-line bg-paper/60 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="font-display text-xs font-bold text-ink">Inbound Audio Message</span>
                <span className="font-mono text-xs text-emerald-700 font-bold">0.84s parse SLA</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white font-bold">
                  <Volume2 className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="h-2.5 w-full bg-line rounded-full overflow-hidden">
                    <div className="h-full bg-accent w-4/5" />
                  </div>
                  <span className="text-xs text-text-muted mt-1 block">
                    &quot;Send 50 bundles of the Super Wax Hollandais to our Kano warehouse...&quot;
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-ink">₦6,250,000</span>
              </div>
              <div className="pt-3 border-t border-line/60 flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-900">Mapped to SKU: WAX-DUTCH-01 (Kano Tier 2 Applied)</span>
                <span className="font-mono font-bold text-emerald-800">₦125,000 / bundle</span>
              </div>
            </div>
          </div>
        )}

        {selectedFeature === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
                Concurrency Guard
              </span>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
                PostgreSQL row locks stop overselling cold.
              </h3>
              <p className="text-sm text-text-muted leading-relaxed">
                When 5 sales reps and 10 buyers confirm orders during a morning rush, database row-locking guarantees that stock cannot go negative. Never call a client to apologize for selling stock you don&apos;t have.
              </p>
              <div className="pt-2 flex items-center gap-3 text-xs font-semibold text-accent">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                <span>Mathematical guarantee against overselling</span>
              </div>
            </div>

            <div className="lg:col-span-7 rounded-2xl border border-line bg-ink p-6 text-paper space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 pb-3 font-mono text-xs">
                <span className="text-white/60">Pessimistic Row Lock</span>
                <span className="text-emerald-400 font-bold">ACTIVE · 0% COLLISION</span>
              </div>
              <pre className="font-mono text-xs text-white/90 bg-white/5 p-4 rounded-xl border border-white/10 overflow-x-auto">
{`BEGIN TRANSACTION;
SELECT * FROM "StockMovement" 
WHERE "productId" = 'prod_wax_01' 
FOR UPDATE;

-- Deduct 35 units atomically
INSERT INTO "StockMovement" ("quantity", "type") 
VALUES (-35, 'SALE_RESERVED');
COMMIT;`}
              </pre>
              <div className="flex items-center justify-between text-xs text-white/70">
                <span>Lock Duration: <strong>14ms</strong></span>
                <span className="text-emerald-400 font-bold">100% Isolated by Organization</span>
              </div>
            </div>
          </div>
        )}

        {selectedFeature === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block">
                Verified Bank Settlement
              </span>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
                Zero goods released on fake transfer receipts.
              </h3>
              <p className="text-sm text-text-muted leading-relaxed">
                Every wholesale order generates a dedicated Paystack virtual account (GTBank, Access, Wema). When the buyer pays, automated webhooks match the transaction and immediately release goods to warehouse packing.
              </p>
              <div className="pt-2 flex items-center gap-3 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Instant dispatch without checking bank balance</span>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
                  <span>Paystack Webhook Settled</span>
                  <span className="font-mono">Reference: pstk_wh_99182</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-3xl font-bold font-tabular text-emerald-950">
                    ₦18,450,000.00
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 text-white px-2.5 py-0.5 text-xs font-bold">
                    <Check className="h-3 w-3" />
                    <span>Settled</span>
                  </span>
                </div>
                <p className="text-xs text-emerald-800">
                  Originating Bank: Guaranty Trust Bank · Virtual Account matched to #ORD-1004.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-4 text-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
                    <Printer className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-bold text-ink block">Interstate Waybill Printed</span>
                    <span className="text-text-muted">GIG Logistics / Young Shall Grow</span>
                  </div>
                </div>
                <span className="font-mono font-bold text-accent">Manifest #GIG-99120</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Visual 3-Stage Order Pipeline Graphic                           */
/* ------------------------------------------------------------------ */

export function VisualOrderPipeline() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
      {/* Stage 1 */}
      <div className="rounded-[28px] border border-line bg-surface p-7 flex flex-col justify-between shadow-xs hover:border-accent/30 transition-colors">
        <div>
          <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block mb-2">
            Stage 01
          </span>
          <h3 className="font-display text-lg font-bold text-ink">
            Inbound WhatsApp Intake
          </h3>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            Buyer sends audio note or fabric photo. Mapped to warehouse SKUs in 0.84 seconds.
          </p>
        </div>

        <div className="mt-6 pt-3.5 border-t border-line/60 space-y-1.5 text-xs">
          <div className="flex items-center justify-between font-semibold text-ink">
            <span>Madam Blessing Fabrics</span>
            <span className="text-emerald-700 font-mono">0.84s SLA</span>
          </div>
          <span className="text-text-muted block text-xs truncate">
            &quot;Send 20 cartons Dutch Wax...&quot;
          </span>
        </div>
      </div>

      {/* Stage 2 */}
      <div className="rounded-[28px] border border-line bg-surface p-7 flex flex-col justify-between shadow-xs hover:border-accent/30 transition-colors">
        <div>
          <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block mb-2">
            Stage 02
          </span>
          <h3 className="font-display text-lg font-bold text-ink">
            Row-Locked Stock &amp; VA
          </h3>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            Units deducted from ledger atomically. Dedicated Paystack virtual account returned.
          </p>
        </div>

        <div className="mt-6 pt-3.5 border-t border-line/60 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-accent font-semibold">
            <span>35 Units Reserved</span>
            <span className="font-mono font-bold">₦3,875,000</span>
          </div>
          <span className="text-xs text-text-muted block">
            0% oversell collision guarantee
          </span>
        </div>
      </div>

      {/* Stage 3 */}
      <div className="rounded-[28px] border border-line bg-surface p-7 flex flex-col justify-between shadow-xs hover:border-accent/30 transition-colors">
        <div>
          <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block mb-2">
            Stage 03
          </span>
          <h3 className="font-display text-lg font-bold text-ink">
            Dispatch &amp; Interstate Waybill
          </h3>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            Settlement triggers packing release. 1-click waybill prints for bus park loaders.
          </p>
        </div>

        <div className="mt-6 pt-3.5 border-t border-line/60 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-emerald-800 font-semibold">
            <span>Waybill #GIG-99120</span>
            <PackageCheck className="h-4 w-4" />
          </div>
          <span className="text-xs text-text-muted block">
            Driver dispatched to Jibowu Park
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Streamlined Wholesale Pricing                                   */
/* ------------------------------------------------------------------ */

export function StreamlinedPricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="space-y-8">
      {/* Billing Cadence Toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-xs font-bold ${!yearly ? "text-ink" : "text-text-muted"}`}>
          Billed Monthly
        </span>
        <button
          type="button"
          onClick={() => setYearly(!yearly)}
          className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${
            yearly ? "bg-accent" : "bg-line"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              yearly ? "translate-x-5" : ""
            }`}
          />
        </button>
        <span className={`text-xs font-bold ${yearly ? "text-ink" : "text-text-muted"}`}>
          Billed Annually
        </span>
        <span className="rounded-full bg-accent/10 border border-accent/25 px-2.5 py-0.5 font-mono text-xs font-bold text-accent">
          Save 2 Months
        </span>
      </div>

      {/* 3 Streamlined Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {/* Starter */}
        <div className="rounded-[28px] border border-line bg-surface p-7 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-ink">Starter Hub</h3>
              <p className="text-xs text-text-muted mt-0.5">Standalone wholesale traders</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-3xl sm:text-4xl font-bold font-tabular text-ink">
                {yearly ? "₦29,000" : "₦35,000"}
              </span>
              <span className="text-xs text-text-muted">/ month</span>
            </div>
            <ul className="space-y-2.5 text-xs text-ink/80 pt-4 border-t border-line/60">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>1 Official WhatsApp Number</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>3 Staff seats</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>Row-locked inventory ledger</span>
              </li>
            </ul>
          </div>

          <Link
            href="/login"
            className="mt-8 block w-full rounded-xl border border-line bg-paper py-3 text-center text-xs font-bold text-ink hover:bg-paper/80 transition-all cursor-pointer"
          >
            Start Free Trial
          </Link>
        </div>

        {/* Commercial Scale (Featured) */}
        <div className="relative rounded-[28px] border-2 border-accent bg-ink p-7 flex flex-col justify-between text-paper shadow-2xl scale-[1.02]">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-bold text-white">
            Most Popular
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-white">Commercial Scale</h3>
              <p className="text-xs text-white/70 mt-0.5">High-volume trading hubs</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-3xl sm:text-4xl font-bold font-tabular text-white">
                {yearly ? "₦69,000" : "₦85,000"}
              </span>
              <span className="text-xs text-white/60">/ month</span>
            </div>
            <ul className="space-y-2.5 text-xs text-white/90 pt-4 border-t border-white/15">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                <span>3 WhatsApp Numbers &amp; 10 Seats</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                <span>Paystack Virtual Accounts</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                <span>Interstate Waybill Manifests</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                <span>VIP Contract Price Books</span>
              </li>
            </ul>
          </div>

          <Link
            href="/login"
            className="mt-8 block w-full rounded-xl bg-accent py-3.5 text-center text-xs font-bold text-white hover:bg-accent-2 transition-colors cursor-pointer"
          >
            Get Started
          </Link>
        </div>

        {/* Enterprise */}
        <div className="rounded-[28px] border border-line bg-surface p-7 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-ink">Enterprise</h3>
              <p className="text-xs text-text-muted mt-0.5">Multi-warehouse networks</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-3xl sm:text-4xl font-bold font-tabular text-ink">
                Custom
              </span>
            </div>
            <ul className="space-y-2.5 text-xs text-ink/80 pt-4 border-t border-line/60">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>Unlimited WhatsApp channels</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>Custom ERP &amp; bank integration</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-700" />
                <span>Dedicated account manager</span>
              </li>
            </ul>
          </div>

          <a
            href="mailto:partners@adaeze.app"
            className="mt-8 block w-full rounded-xl border border-line bg-paper py-3 text-center text-xs font-bold text-ink hover:bg-paper/80 transition-all cursor-pointer"
          >
            Contact Sales
          </a>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Minimal FAQ                                                     */
/* ------------------------------------------------------------------ */

const FAQS = [
  {
    q: "How does Adaeze prevent overselling during flash drops?",
    a: "Adaeze uses PostgreSQL row-locking (SELECT ... FOR UPDATE) to deduct stock atomically at order confirmation. If multiple buyers or sales reps order the last bundles simultaneously, only the first transaction commits.",
  },
  {
    q: "Do buyers need to download an app?",
    a: "No. Wholesale buyers communicate entirely on WhatsApp. Adaeze parses their audio voice notes, screenshots, or text messages directly into verified order invoices.",
  },
  {
    q: "How does automated Paystack reconciliation work?",
    a: "Each invoice is assigned a dedicated Paystack virtual account. When funds land, Paystack fires an instant webhook that marks the order Settled and releases it to the packing table.",
  },
];

export function MinimalFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {FAQS.map((item, idx) => {
        const isOpen = openIdx === idx;
        return (
          <div
            key={item.q}
            className="rounded-2xl border border-line bg-surface overflow-hidden transition-colors"
          >
            <button
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : idx)}
              className="w-full p-5 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-paper/40 transition-colors"
            >
              <span className="font-display text-sm font-bold text-ink">
                {item.q}
              </span>
              <span className="text-accent font-bold text-lg">
                {isOpen ? "−" : "+"}
              </span>
            </button>

            {isOpen && (
              <div className="px-5 pb-5 pt-1 text-xs text-text-muted leading-relaxed border-t border-line/40">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
