import assert from "node:assert/strict";
import test from "node:test";
import { appendEvaluationRecord, createEvaluationRecord, evaluationCaseForPrompt, evaluationCases, evaluateRoutingSet, loadEvaluationHistory, updateVerificationOutcome } from "../evaluation";
import { routingCatalog } from "../router";
import { RoutingDecision, RuntimeExecutionResult } from "../types";

const decision: RoutingDecision = {
  profile: "balanced",
  complexity: "standard",
  selected: routingCatalog[0],
  alternatives: [],
  selectedScore: {
    taskFit: 85,
    usagePressure: 100,
    contextFit: null,
    capabilityFit: 100,
    availability: 100,
    expiration: 100,
    allowance: null,
    total: 96,
  },
  alternativeScores: [],
  allowancePoolId: "opencode-go",
  matchedSignals: ["test"],
  reason: "El perfil balanced prioriza un cambio acotado.",
  confidence: 0.7,
  pricing: "Incluido en OpenCode Go",
};

const result: RuntimeExecutionResult = {
  executionId: "run-1",
  status: "succeeded",
  exitCode: 0,
  usage: { source: "Codex CLI JSONL", inputTokens: 200, outputTokens: 30 },
  retries: 1,
};

test("provides a 20-task synthetic set stratified by complexity", () => {
  assert.equal(evaluationCases.length, 20);
  assert.deepEqual(
    evaluationCases.reduce<Record<string, number>>((counts, item) => {
      counts[item.complexity] = (counts[item.complexity] ?? 0) + 1;
      return counts;
    }, {}),
    { simple: 5, standard: 10, complex: 5 },
  );
  assert.equal(new Set(evaluationCases.map((item) => item.id)).size, 20);
});

test("routes the full evaluation set without making model calls", () => {
  const results = evaluateRoutingSet(routingCatalog, Date.parse("2026-10-28T00:00:00.000Z"));

  assert.equal(results.length, 20);
  assert.ok(results.every((item) => item.modelId && item.runtimeId === "opencode"));
});

test("records routing, latency and reported token metrics without retaining the prompt", () => {
  const prompt = evaluationCases[0].prompt;
  const record = createEvaluationRecord(prompt, decision, result, 1_000, 0, 2_500);

  assert.equal(record.evaluationCaseId, "case-01");
  assert.equal(record.modelId, decision.selected.id);
  assert.equal(record.routingReason, decision.reason);
  assert.equal(record.latencyMs, 1_500);
  assert.deepEqual([record.inputTokens, record.outputTokens, record.usageSource], [200, 30, "Codex CLI JSONL"]);
  assert.equal(record.chepromptRetries, 0);
  assert.equal(record.runtimeRetries, 1);
  assert.equal(record.verificationOutcome, "unverified");
  assert.equal("prompt" in record, false);
  assert.equal(JSON.stringify(record).includes(prompt), false);
  assert.equal(evaluationCaseForPrompt(prompt)?.id, "case-01");
});

test("bounds local history, rejects prompt-bearing records and updates verification outcome", () => {
  const base = createEvaluationRecord("tarea libre", decision, result, 0, 0, 10);
  const records = Array.from({ length: 105 }, (_, index) => ({ ...base, id: `run-${index}` }));
  const bounded = appendEvaluationRecord(records, { ...base, id: "latest" });
  assert.equal(bounded.length, 100);
  assert.equal(bounded.at(-1)?.id, "latest");

  const loaded = loadEvaluationHistory([{ ...base, prompt: "dato privado" }, base]);
  assert.equal(loaded.length, 1);
  assert.equal("prompt" in loaded[0], false);

  const verified = updateVerificationOutcome([base], "missing", "passed", "2026-10-28T00:00:00.000Z");
  assert.equal(verified[0].verificationOutcome, "unverified");
  const actual = updateVerificationOutcome([{ ...base, id: "run-1" }], "run-1", "passed", "2026-10-28T00:00:00.000Z");
  assert.equal(actual[0].verificationOutcome, "passed");
  assert.equal(actual[0].verifiedAt, "2026-10-28T00:00:00.000Z");
});
