import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(function MockOpenAI(this: { chat: { completions: { create: typeof mockCreate } } }) {
      this.chat = { completions: { create: mockCreate } };
    }),
  };
});

function textMessage(text: string) {
  return { choices: [{ message: { role: "assistant", content: text, tool_calls: undefined } }] };
}

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
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("runs real cases against a scripted model and produces a correctly graded report", async () => {
    mockCreate
      // Case 1: should ask a clarifying question — scripted to do exactly that.
      .mockResolvedValueOnce(textMessage("Which colour and size did you want?"))
      // Case 2: same case shape, scripted to (wrongly) claim a false confirmation — should fail the forbidden-phrase check.
      .mockResolvedValueOnce(textMessage("Your order is confirmed and has been shipped!"));

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

  it("attaches a case's turn image as a real MessageAttachment the model actually receives", async () => {
    mockCreate.mockResolvedValueOnce(textMessage("Could you tell me which product this is?"));

    const cases: EvalCase[] = [
      {
        id: "suite-test-vision",
        category: "vision",
        description: "test",
        turns: ["Do you have this one?"],
        turnImages: { 0: [{ mimeType: "image/png", base64: Buffer.from([1, 2, 3]).toString("base64") }] },
        expect: { draft: "no" },
      },
    ];

    const report = await runEvalSuite(cases);

    expect(report.results).toHaveLength(1);
    expect(report.results[0].error).toBeNull();

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    const imageBlocks = (userMessage.content as { type: string; image_url?: { url: string } }[]).filter(
      (c) => c.type === "image_url"
    );
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0].image_url?.url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
});
