import { prisma } from "@/lib/prisma";
import { transaction } from "@/lib/db";
import { recordStockMovement } from "@/lib/stock";
import { phoneKeyOf } from "@/lib/phone";
import { StockMovementReason } from "@prisma/client";
import { runAIAssist, type AIAssistResult } from "./engine";
import { EVAL_CASES, EVAL_CATALOGUE } from "./eval-cases";

/**
 * A formal evaluation harness for the AI order assistant, per VISION.md's testing
 * discipline: "a test suite of realistic, ambiguous, misspelled, multi-item, and
 * adversarial messages ... The AI is never called production-ready without
 * evaluation against defined acceptance criteria." This grades the model's actual
 * judgment (does it match the right product, ask when it should, never fabricate a
 * claim) — distinct from tests/ai-engine.test.ts, which scripts the model's
 * responses to test the *engine's* orchestration (tool loop, draft-order wiring,
 * error handling) without needing real model judgment at all.
 *
 * This app has no dedicated "the AI escalated" state yet — the engine always sets
 * AI_HANDLING after replying, whether it drafted an order or asked a question (see
 * docs/PROGRESS.md). So "did it escalate" is operationalized here as "did it NOT
 * create a confident draft order" — the one externally observable signal that
 * actually exists today.
 */

export type EvalCategory = "realistic" | "ambiguous" | "misspelled" | "multi-item" | "adversarial" | "edge-case";

export type EvalExpectation = {
  /** "yes": must draft, with exactly `items`. "no": must not draft. "optional": may or may not —
   * the system prompt itself allows either response to a stock shortfall — but `maxQuantity`
   * still applies if it does draft. */
  draft: "yes" | "no" | "optional";
  /** Required when draft is "yes": the exact (sku, quantity) set the draft must contain, no more, no less. */
  items?: { sku: string; quantity: number }[];
  /** Checked whenever a draft exists, regardless of `draft`: per-sku quantity ceiling (e.g. available stock). */
  maxQuantity?: Record<string, number>;
  /** Phrases the reply must never contain, case-insensitive — a fabricated discount, a falsely
   * claimed confirmation/payment/shipment, or any other unsupported claim. */
  forbiddenPhrases?: string[];
  /** Phrases the reply should contain somewhere, case-insensitive — e.g. the real MOQ or stock count. */
  expectedPhrases?: string[];
};

export type EvalCase = {
  id: string;
  category: EvalCategory;
  description: string;
  /** Customer messages in order. More than one turn simulates a correction/clarification exchange —
   * each prior turn's AI reply is stored as a real message before the next turn runs, so later
   * turns see genuine conversation history, the same as a real exchange. */
  turns: string[];
  expect: EvalExpectation;
};

export type EvalFinding = {
  /** Groups findings for the aggregate metrics report — see METRIC_LABELS below. */
  metric: "escalation" | "product-match" | "quantity-match" | "price" | "forbidden-phrase" | "expected-phrase";
  ok: boolean;
  detail: string;
};

export type EvalCaseResult = {
  case: EvalCase;
  result: AIAssistResult | null;
  error: string | null;
  findings: EvalFinding[];
  passed: boolean;
};

export type EvalReport = {
  model: string;
  ranAt: Date;
  results: EvalCaseResult[];
  /** Fraction of cases that produced a final reply at all, without throwing. */
  completionRate: number;
  /** Per-metric pass rate across every finding tagged with it, across all cases. */
  metricRates: Record<EvalFinding["metric"], { passed: number; total: number; rate: number | null }>;
  overallPassRate: number;
};

type Fixture = {
  organizationId: string;
  customerId: string;
  createdById: string;
  skuToProductId: Map<string, string>;
};

/** Seeds one organization with the shared eval catalogue — fresh every run, never reused data. */
async function setupFixture(): Promise<Fixture> {
  // Organization and User are identity data, reached through the root client, same as
  // everywhere else in the app — everything else below is tenant data and goes through
  // transaction(organizationId, ...), never the root client.
  const org = await prisma.organization.create({ data: { name: `AI Eval ${new Date().toISOString()}` } });
  const user = await prisma.user.create({
    data: { email: `ai-eval-${org.id}@example.com`, passwordHash: "x", name: "Eval Runner", memberships: { create: { organizationId: org.id, role: "OWNER" } } },
  });
  const phone = `+1555${String(Math.floor(Math.random() * 9000000) + 1000000)}`;

  const customerId = await transaction(org.id, (tx) => tx.customer.create({ data: { organizationId: org.id, phone, phoneKey: phoneKeyOf(phone)!, name: "Eval Customer" } })).then((c) => c.id);

  const skuToProductId = new Map<string, string>();
  for (const spec of EVAL_CATALOGUE) {
    const productId = await transaction(org.id, (tx) =>
      tx.product.create({
        data: {
          organizationId: org.id,
          sku: spec.sku,
          name: spec.name,
          variantAttributes: spec.variant,
          priceCents: spec.priceCents,
          moq: spec.moq,
          priceTiers: spec.tiers.length > 0 ? { create: spec.tiers } : undefined,
        },
      })
    ).then((p) => p.id);
    skuToProductId.set(spec.sku, productId);
    if (spec.stock > 0) {
      await recordStockMovement({ organizationId: org.id, productId, quantityDelta: spec.stock, reason: StockMovementReason.INITIAL_STOCK });
    }
  }

  return { organizationId: org.id, customerId, createdById: user.id, skuToProductId };
}

/** Runs one case's turns in sequence against a fresh conversation, returning the last turn's outcome. */
async function runCase(fixture: Fixture, ec: EvalCase): Promise<{ result: AIAssistResult | null; error: string | null }> {
  const conversationId = await transaction(fixture.organizationId, (tx) =>
    tx.conversation.create({ data: { organizationId: fixture.organizationId, customerId: fixture.customerId, channel: "WHATSAPP", status: "NEW" } })
  ).then((c) => c.id);

  let last: { result: AIAssistResult | null; error: string | null } = { result: null, error: "no turns" };
  for (const body of ec.turns) {
    await transaction(fixture.organizationId, (tx) => tx.message.create({ data: { conversationId, direction: "INBOUND", sender: "CUSTOMER", body } }));
    try {
      const result = await runAIAssist({
        organizationId: fixture.organizationId,
        conversationId,
        customerId: fixture.customerId,
        createdById: fixture.createdById,
      });
      // Not sent anywhere real (no WhatsApp credentials in an eval run) — recorded directly,
      // exactly like runAIAssistAction does once a real send succeeds, so the next turn's
      // transcript genuinely includes this reply.
      await transaction(fixture.organizationId, (tx) => tx.message.create({ data: { conversationId, direction: "OUTBOUND", sender: "AI", body: result.replyText } }));
      last = { result, error: null };
    } catch (err) {
      last = { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return last;
}

/** Exported for tests/ai-eval-harness.test.ts — the grading logic itself needs coverage independent of a real model. */
export function gradeCase(ec: EvalCase, outcome: { result: AIAssistResult | null; error: string | null }, skuToProductId: Map<string, string>, orderItems: { productId: string; quantity: number }[] | null): EvalFinding[] {
  const findings: EvalFinding[] = [];
  if (outcome.error || !outcome.result) {
    findings.push({ metric: "escalation", ok: false, detail: `AI assist failed: ${outcome.error ?? "no result"}` });
    return findings;
  }

  const { result } = outcome;
  const drafted = Boolean(result.draftOrder);

  if (ec.expect.draft !== "optional") {
    const expectedDraft = ec.expect.draft === "yes";
    findings.push({
      metric: "escalation",
      ok: drafted === expectedDraft,
      detail:
        drafted === expectedDraft
          ? expectedDraft
            ? "drafted an order as expected"
            : "correctly asked/deferred instead of guessing"
          : expectedDraft
            ? "did not draft when it had everything it needed to (missed completion)"
            : "drafted an order when it should have asked first (missed escalation)",
    });
  }

  if (drafted && orderItems) {
    const productIdToSku = new Map([...skuToProductId.entries()].map(([sku, id]) => [id, sku]));
    const actual = new Map(orderItems.map((i) => [productIdToSku.get(i.productId) ?? i.productId, i.quantity]));

    if (ec.expect.draft === "yes" && ec.expect.items) {
      const expected = new Map(ec.expect.items.map((i) => [i.sku, i.quantity]));
      const sameSkus = expected.size === actual.size && [...expected.keys()].every((sku) => actual.has(sku));
      findings.push({
        metric: "product-match",
        ok: sameSkus,
        detail: sameSkus ? "drafted exactly the expected products" : `expected products [${[...expected.keys()].join(", ")}], got [${[...actual.keys()].join(", ")}]`,
      });
      const sameQuantities = sameSkus && [...expected.entries()].every(([sku, qty]) => actual.get(sku) === qty);
      findings.push({
        metric: "quantity-match",
        ok: sameQuantities,
        detail: sameQuantities
          ? "every quantity matched"
          : `expected quantities ${JSON.stringify(Object.fromEntries(expected))}, got ${JSON.stringify(Object.fromEntries(actual))}`,
      });
    }

    if (ec.expect.maxQuantity) {
      for (const [sku, max] of Object.entries(ec.expect.maxQuantity)) {
        const qty = actual.get(sku);
        if (qty !== undefined) {
          findings.push({
            metric: "quantity-match",
            ok: qty <= max,
            detail: qty <= max ? `drafted ${qty} of ${sku}, within the ${max} available` : `drafted ${qty} of ${sku} — more than the ${max} actually available`,
          });
        }
      }
    }

    // Pricing is always resolved server-side (createDraftOrder never trusts a model-stated
    // price), so this is structurally guaranteed, not something the model can get wrong — it's
    // reported anyway because VISION.md names price accuracy explicitly as a metric to track.
    findings.push({ metric: "price", ok: true, detail: "price is resolved server-side, never from the model — always correct by construction" });
  }

  for (const phrase of ec.expect.forbiddenPhrases ?? []) {
    const hit = result.replyText.toLowerCase().includes(phrase.toLowerCase());
    findings.push({ metric: "forbidden-phrase", ok: !hit, detail: hit ? `reply contains forbidden phrase: "${phrase}"` : `does not contain "${phrase}"` });
  }
  for (const phrase of ec.expect.expectedPhrases ?? []) {
    const hit = result.replyText.toLowerCase().includes(phrase.toLowerCase());
    findings.push({ metric: "expected-phrase", ok: hit, detail: hit ? `mentions expected phrase "${phrase}"` : `missing expected phrase: "${phrase}"` });
  }

  return findings;
}

/** Runs the whole suite against the real model (ANTHROPIC_API_KEY must be set) and grades it. */
export async function runEvalSuite(cases: EvalCase[] = EVAL_CASES): Promise<EvalReport> {
  const fixture = await setupFixture();
  const results: EvalCaseResult[] = [];

  for (const ec of cases) {
    const outcome = await runCase(fixture, ec);
    let orderItems: { productId: string; quantity: number }[] | null = null;
    if (outcome.result?.draftOrder) {
      orderItems = await transaction(fixture.organizationId, (tx) => tx.orderItem.findMany({ where: { orderId: outcome.result!.draftOrder!.id } }));
    }
    const findings = gradeCase(ec, outcome, fixture.skuToProductId, orderItems);
    results.push({ case: ec, result: outcome.result, error: outcome.error, findings, passed: findings.every((f) => f.ok) });
  }

  const completionRate = results.filter((r) => r.error === null).length / results.length;
  const overallPassRate = results.filter((r) => r.passed).length / results.length;

  const metricRates = {} as EvalReport["metricRates"];
  const metrics: EvalFinding["metric"][] = ["escalation", "product-match", "quantity-match", "price", "forbidden-phrase", "expected-phrase"];
  for (const metric of metrics) {
    const findings = results.flatMap((r) => r.findings).filter((f) => f.metric === metric);
    const passed = findings.filter((f) => f.ok).length;
    metricRates[metric] = { passed, total: findings.length, rate: findings.length === 0 ? null : passed / findings.length };
  }

  return { model: process.env.AI_EVAL_MODEL_LABEL ?? "claude-opus-5-5", ranAt: new Date(), results, completionRate, metricRates, overallPassRate };
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`AI eval report — model ${report.model}, ${report.ranAt.toISOString()}`);
  lines.push(`${report.results.length} cases, ${(report.overallPassRate * 100).toFixed(0)}% passed, ${(report.completionRate * 100).toFixed(0)}% completed without error`);
  lines.push("");
  for (const r of report.results) {
    lines.push(`[${r.passed ? "PASS" : "FAIL"}] ${r.case.id} (${r.case.category}) — ${r.case.description}`);
    if (r.result) lines.push(`  reply: ${r.result.replyText.slice(0, 160)}${r.result.replyText.length > 160 ? "…" : ""}`);
    if (r.result) lines.push(`  tool calls: ${r.result.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
    for (const f of r.findings) {
      if (!f.ok) lines.push(`  ✗ [${f.metric}] ${f.detail}`);
    }
  }
  lines.push("");
  lines.push("Metrics:");
  for (const [metric, { passed, total, rate }] of Object.entries(report.metricRates)) {
    lines.push(`  ${metric}: ${rate === null ? "n/a (no cases exercised it)" : `${(rate * 100).toFixed(0)}% (${passed}/${total})`}`);
  }
  return lines.join("\n");
}
