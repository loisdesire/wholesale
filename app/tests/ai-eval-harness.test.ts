import { describe, expect, it } from "vitest";
import { gradeCase, type EvalCase } from "@/lib/ai/eval";
import { EVAL_CASES } from "@/lib/ai/eval-cases";
import type { AIAssistResult } from "@/lib/ai/engine";

/**
 * Unit tests for the eval harness's own grading logic — deterministic, no real model
 * call. Proves the grader actually distinguishes a good response from a bad one
 * (not just that it always reports "pass"), since a scoring bug here would quietly
 * make the whole eval suite meaningless. See tests/ai-engine.test.ts for the
 * engine's own orchestration tests, and scripts/run-ai-eval.ts for the real,
 * credential-gated run against the live model.
 */

const SKU_MAP = new Map([
  ["EVAL-ANK-BLK-M", "prod-ank-blk-m"],
  ["EVAL-ANK-RED-L", "prod-ank-red-l"],
]);

function aiResult(overrides: Partial<AIAssistResult> = {}): AIAssistResult {
  return { replyText: "Sure, confirming your order.", toolCalls: [{ name: "search_catalogue", input: { query: "ankara" } }], ...overrides };
}

describe("gradeCase", () => {
  it("passes a correctly drafted order matching the expected products and quantities", () => {
    const ec: EvalCase = {
      id: "t1",
      category: "realistic",
      description: "",
      turns: ["x"],
      expect: { draft: "yes", items: [{ sku: "EVAL-ANK-BLK-M", quantity: 5 }] },
    };
    const outcome = { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 9250000 } }), error: null };
    const orderItems = [{ productId: "prod-ank-blk-m", quantity: 5 }];
    const findings = gradeCase(ec, outcome, SKU_MAP, orderItems);
    expect(findings.every((f) => f.ok)).toBe(true);
  });

  it("fails when the drafted quantity is wrong, even though the product matched", () => {
    const ec: EvalCase = {
      id: "t2",
      category: "realistic",
      description: "",
      turns: ["x"],
      expect: { draft: "yes", items: [{ sku: "EVAL-ANK-BLK-M", quantity: 5 }] },
    };
    const outcome = { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 1000 } }), error: null };
    const orderItems = [{ productId: "prod-ank-blk-m", quantity: 3 }]; // wrong quantity
    const findings = gradeCase(ec, outcome, SKU_MAP, orderItems);
    expect(findings.some((f) => f.metric === "quantity-match" && !f.ok)).toBe(true);
    expect(findings.some((f) => f.metric === "product-match" && f.ok)).toBe(true); // product itself was right
  });

  it("fails when the drafted product is wrong", () => {
    const ec: EvalCase = {
      id: "t3",
      category: "realistic",
      description: "",
      turns: ["x"],
      expect: { draft: "yes", items: [{ sku: "EVAL-ANK-BLK-M", quantity: 5 }] },
    };
    const outcome = { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 1000 } }), error: null };
    const orderItems = [{ productId: "prod-ank-red-l", quantity: 5 }]; // wrong product
    const findings = gradeCase(ec, outcome, SKU_MAP, orderItems);
    expect(findings.some((f) => f.metric === "product-match" && !f.ok)).toBe(true);
  });

  it("fails when a draft was expected but none was made (missed completion)", () => {
    const ec: EvalCase = { id: "t4", category: "realistic", description: "", turns: ["x"], expect: { draft: "yes", items: [{ sku: "EVAL-ANK-BLK-M", quantity: 5 }] } };
    const findings = gradeCase(ec, { result: aiResult(), error: null }, SKU_MAP, null);
    expect(findings.some((f) => f.metric === "escalation" && !f.ok)).toBe(true);
  });

  it("fails when a draft was made but the case expected a clarifying question (missed escalation)", () => {
    const ec: EvalCase = { id: "t5", category: "ambiguous", description: "", turns: ["x"], expect: { draft: "no" } };
    const outcome = { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 1000 } }), error: null };
    const findings = gradeCase(ec, outcome, SKU_MAP, [{ productId: "prod-ank-blk-m", quantity: 1 }]);
    expect(findings.some((f) => f.metric === "escalation" && !f.ok)).toBe(true);
  });

  it("passes either a draft or no-draft for an 'optional' case, but still enforces the quantity ceiling", () => {
    const ec: EvalCase = { id: "t6", category: "edge-case", description: "", turns: ["x"], expect: { draft: "optional", maxQuantity: { "EVAL-ANK-BLK-M": 4 } } };

    const noDraft = gradeCase(ec, { result: aiResult(), error: null }, SKU_MAP, null);
    expect(noDraft.every((f) => f.ok)).toBe(true);

    const withinCeiling = gradeCase(ec, { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 1 } }), error: null }, SKU_MAP, [
      { productId: "prod-ank-blk-m", quantity: 4 },
    ]);
    expect(withinCeiling.every((f) => f.ok)).toBe(true);

    const overCeiling = gradeCase(ec, { result: aiResult({ draftOrder: { id: "o1", reference: "ORD-1", totalCents: 1 } }), error: null }, SKU_MAP, [
      { productId: "prod-ank-blk-m", quantity: 9 },
    ]);
    expect(overCeiling.some((f) => f.metric === "quantity-match" && !f.ok)).toBe(true);
  });

  it("catches a forbidden phrase in the reply (a fabricated claim)", () => {
    const ec: EvalCase = { id: "t7", category: "adversarial", description: "", turns: ["x"], expect: { draft: "no", forbiddenPhrases: ["payment received"] } };
    const bad = gradeCase(ec, { result: aiResult({ replyText: "Payment received, shipping now!" }), error: null }, SKU_MAP, null);
    expect(bad.some((f) => f.metric === "forbidden-phrase" && !f.ok)).toBe(true);

    const good = gradeCase(ec, { result: aiResult({ replyText: "A staff member will verify and get back to you." }), error: null }, SKU_MAP, null);
    expect(good.every((f) => f.ok)).toBe(true);
  });

  it("requires an expected phrase to actually appear (e.g. the real MOQ)", () => {
    const ec: EvalCase = { id: "t8", category: "edge-case", description: "", turns: ["x"], expect: { draft: "no", expectedPhrases: ["2"] } };
    const missing = gradeCase(ec, { result: aiResult({ replyText: "Sorry, that's below our minimum order." }), error: null }, SKU_MAP, null);
    expect(missing.some((f) => f.metric === "expected-phrase" && !f.ok)).toBe(true);

    const present = gradeCase(ec, { result: aiResult({ replyText: "Our minimum for that item is 2." }), error: null }, SKU_MAP, null);
    expect(present.every((f) => f.ok)).toBe(true);
  });

  it("fails outright when the engine itself errored, rather than silently passing", () => {
    const ec: EvalCase = { id: "t9", category: "realistic", description: "", turns: ["x"], expect: { draft: "yes", items: [{ sku: "EVAL-ANK-BLK-M", quantity: 1 }] } };
    const findings = gradeCase(ec, { result: null, error: "model call failed" }, SKU_MAP, null);
    expect(findings.every((f) => !f.ok)).toBe(true);
  });
});

describe("EVAL_CASES", () => {
  it("covers every category VISION.md names (realistic, ambiguous, misspelled, multi-item, adversarial)", () => {
    const categories = new Set(EVAL_CASES.map((c) => c.category));
    for (const required of ["realistic", "ambiguous", "misspelled", "multi-item", "adversarial"]) {
      expect(categories.has(required as EvalCase["category"]), `missing a case in category "${required}"`).toBe(true);
    }
  });

  it("has unique case ids", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every 'yes' case names its expected items, and every drafted case has at least one turn", () => {
    for (const ec of EVAL_CASES) {
      expect(ec.turns.length, ec.id).toBeGreaterThan(0);
      if (ec.expect.draft === "yes") {
        expect(ec.expect.items?.length, `${ec.id} expects a draft but names no items`).toBeGreaterThan(0);
      }
    }
  });
});
