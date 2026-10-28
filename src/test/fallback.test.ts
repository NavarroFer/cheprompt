import assert from "node:assert/strict";
import test from "node:test";
import { canStartExecution, MAX_TASK_EXECUTION_ATTEMPTS, shouldProposeFallback } from "../fallback";
import { RuntimeExecutionResult } from "../types";

const result = (status: RuntimeExecutionResult["status"], failureKind?: RuntimeExecutionResult["failureKind"]): RuntimeExecutionResult => ({
  executionId: "run-1",
  status,
  exitCode: status === "succeeded" ? 0 : 1,
  ...(failureKind ? { failureKind } : {}),
});

test("proposes one reviewed fallback only for objective runtime failures", () => {
  for (const kind of ["authentication", "quota", "tool", "process", "verification"] as const) {
    assert.equal(shouldProposeFallback(result("failed", kind), 1, false), true);
  }
  for (const kind of ["approval", "protocol", "unknown"] as const) {
    assert.equal(shouldProposeFallback(result("failed", kind), 1, false), false);
  }
  assert.equal(shouldProposeFallback(result("cancelled"), 1, false), false);
  assert.equal(shouldProposeFallback(result("succeeded"), 1, false), false);
});

test("hard-caps each analyzed task at one initial run plus one fallback attempt", () => {
  assert.equal(MAX_TASK_EXECUTION_ATTEMPTS, 2);
  assert.equal(canStartExecution(0, false), true);
  assert.equal(canStartExecution(1, false), true);
  assert.equal(canStartExecution(2, false), false);
  assert.equal(canStartExecution(0, true), false);
  assert.equal(shouldProposeFallback(result("failed", "process"), 2, false), false);
  assert.equal(shouldProposeFallback(result("failed", "process"), 1, true), false);
});
