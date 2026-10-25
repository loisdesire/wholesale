import { isAIConfigured } from "../src/lib/ai/engine";
import { runEvalSuite, formatReport } from "../src/lib/ai/eval";

/**
 * Runs the AI eval suite against the REAL model (never scripted/mocked) and prints a
 * report. Per VISION.md: "The AI is never called production-ready without evaluation
 * against defined acceptance criteria." Needs a real OPENAI_API_KEY and a real
 * database — not part of `npm test`, which stays mock-based and credential-free.
 * Exits non-zero if the suite's overall pass rate falls below ACCEPTANCE_THRESHOLD, so
 * this can gate a release the same way a test suite does.
 */
const ACCEPTANCE_THRESHOLD = 0.8;

async function main() {
  if (!isAIConfigured()) {
    console.error("AI eval cannot run: OPENAI_API_KEY is not set. See .env.example.");
    process.exit(2);
  }

  const report = await runEvalSuite();
  console.log(formatReport(report));

  if (report.overallPassRate < ACCEPTANCE_THRESHOLD) {
    console.error(`\nBelow the acceptance threshold (${(ACCEPTANCE_THRESHOLD * 100).toFixed(0)}%) — not production-ready.`);
    process.exit(1);
  }
  console.log(`\nMeets the acceptance threshold (${(ACCEPTANCE_THRESHOLD * 100).toFixed(0)}%).`);
}

main().catch((err) => {
  console.error("AI eval run failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
