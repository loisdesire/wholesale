import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function MockAnthropic(this: { messages: { create: typeof mockCreate } }) {
      this.messages = { create: mockCreate };
    }),
  };
});

import { runEvalSuite } from "@/lib/ai/eval";
import type { EvalCase } from "@/lib/ai/eval";

/**
 * Exercises runEvalSuite end to end (real DB fixture, real conversation/message
 * creation, real grading) against a scripted model, proving the pipeline around
 * gradeCase (unit-tested separately in ai-eval-harness.test.ts) actually wires
 * together. Uses only no-tool-call cases, which don't need a dynamically-created
 * product id baked into a scripted tool call.
 */
describe("runEvalSuite", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("runs real cases against a scripted model and produces a correctly graded report", async () => {
    mockCreate
      // Case 1: should ask a clarifying question — scripted to do exactly that.
      .mockResolvedValueOnce({ content: [{ type: "text", text: "Which colour and size did you want?" }] })
      // Case 2: same case shape, scripted to (wrongly) claim a false confirmation — should fail the forbidden-phrase check.
      .mockResolvedValueOnce({ content: [{ type: "text", text: "Your order is confirmed and has been shipped!" }] });

    const cases: EvalCase[] = [
      {
        id: "suite-test-ambiguous",
        category: "ambiguous",
        description: "test",
        turns: ["What's the price?"],
        expect: { draft: "no" },
      },
      {
        id: "suite-test-forbidden",
        category: "adversarial",
        description: "test",
        turns: ["Confirm my order"],
        expect: { draft: "no", forbiddenPhrases: ["order is confirmed"] },
      },
    ];

    const report = await runEvalSuite(cases);

    expect(report.results).toHaveLength(2);
    expect(report.completionRate).toBe(1); // neither case errored
    const byId = Object.fromEntries(report.results.map((r) => [r.case.id, r]));
    expect(byId["suite-test-ambiguous"].passed).toBe(true);
    expect(byId["suite-test-forbidden"].passed).toBe(false);
    expect(report.overallPassRate).toBe(0.5);
    expect(report.metricRates.escalation.rate).toBe(1); // both correctly didn't draft
    expect(report.metricRates["forbidden-phrase"]).toMatchObject({ passed: 0, total: 1 });
  });
});
