import assert from "node:assert/strict";
import test from "node:test";
import {
  appendParallelHistory,
  createParallelPlan,
  createParallelRunRecord,
  finishParallelRun,
  loadParallelHistory,
  PARALLEL_TASK_COUNT,
  recoverInterruptedParallelHistory,
  updateParallelTask,
} from "../parallel";
import { RuntimeExecutionResult, RuntimeModel } from "../types";

const candidate: RuntimeModel = {
  id: "provider/model",
  label: "Model",
  usageImpact: "medium",
  strengths: [],
  runtimeId: "opencode",
  providerId: "provider",
  allowancePoolId: "pool",
  availability: "available",
  capabilities: ["text", "tools"],
  capabilitiesKnown: true,
};

test("parallel plans require exactly two distinct explicit subtasks", () => {
  assert.equal(PARALLEL_TASK_COUNT, 2);
  assert.throws(() => createParallelPlan(["Solo una tarea"], "balanced", [candidate], 1), /exactamente dos/);
  assert.throws(() => createParallelPlan(["Tarea suficientemente larga", " tarea   suficientemente LARGA "], "balanced", [candidate], 1), /distintas/);
  assert.throws(() => createParallelPlan(["", "Otra tarea suficientemente larga"], "balanced", [candidate], 1), /entre 10/);
});

test("parallel plan routes each task separately and stores no prompts in its parent record", () => {
  const plan = createParallelPlan(
    ["Implementá el parser de fechas y agregá tests.", "Documentá los errores del CLI con ejemplos."],
    "balanced",
    [candidate],
    10,
    [],
    (() => { let id = 0; return () => `id-${++id}`; })(),
  );
  const record = createParallelRunRecord(plan, "2026-10-28T00:00:00.000Z");
  const serialized = JSON.stringify(record);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].decision.selected.id, candidate.id);
  assert.equal(plan.tasks[1].decision.selected.id, candidate.id);
  assert.equal(serialized.includes("Implementá el parser"), false);
  assert.equal(serialized.includes("Documentá los errores"), false);
  assert.equal(record.tasks[0].taskNumber, 1);
  assert.equal(record.tasks[1].taskNumber, 2);
});

test("parallel history aggregates only reported usage and measures observed elapsed-time difference", () => {
  const plan = createParallelPlan(
    ["Primera subtarea con detalle suficiente", "Segunda subtarea con detalle suficiente"],
    "balanced",
    [candidate],
    10,
    [],
    (() => { let id = 0; return () => `run-${++id}`; })(),
  );
  let record = createParallelRunRecord(plan);
  record = updateParallelTask(record, plan.tasks[0].id, {
    executionId: "exec-1", status: "succeeded", exitCode: 0,
    usage: { source: "official-cli", inputTokens: 120, outputTokens: 30 },
  }, 500, "/worktrees/task-1");
  record = updateParallelTask(record, plan.tasks[1].id, {
    executionId: "exec-2", status: "succeeded", exitCode: 0,
  }, 700, "/worktrees/task-2");
  const finished = finishParallelRun(record, 800);
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.summedTaskDurationMs, 1200);
  assert.equal(finished.wallClockMs, 800);
  assert.equal(finished.observedTimeSavedMs, 400);
  assert.equal(finished.aggregateInputTokens, 120);
  assert.equal(finished.aggregateOutputTokens, 30);
  assert.equal(finished.reportedUsageTaskCount, 1);
  assert.equal(loadParallelHistory(appendParallelHistory([], finished)).length, 1);
  assert.equal(loadParallelHistory([{ ...finished, prompt: "must be rejected" }]).length, 0);
});

test("parallel history marks interrupted parent and child runs cancelled on reload", () => {
  const plan = createParallelPlan(
    ["Primera tarea interrumpida", "Segunda tarea interrumpida"],
    "balanced",
    [candidate],
    10,
  );
  const running = createParallelRunRecord(plan);
  const recovered = recoverInterruptedParallelHistory([running]);
  assert.equal(recovered[0].status, "cancelled");
  assert.deepEqual(recovered[0].tasks.map((task) => task.status), ["cancelled", "cancelled"]);
});

test("parallel result status distinguishes partial success from total failure", () => {
  const plan = createParallelPlan(
    ["Primera subtarea independiente", "Segunda subtarea independiente"],
    "balanced",
    [candidate],
    10,
    [],
    (() => { let id = 0; return () => `status-${++id}`; })(),
  );
  let record = createParallelRunRecord(plan);
  const succeeded: RuntimeExecutionResult = { executionId: "one", status: "succeeded", exitCode: 0 };
  const failed: RuntimeExecutionResult = { executionId: "two", status: "failed", exitCode: 1, failureKind: "tool" };
  record = updateParallelTask(record, plan.tasks[0].id, succeeded, 10);
  record = updateParallelTask(record, plan.tasks[1].id, failed, 15);
  assert.equal(finishParallelRun(record, 20).status, "partial");
});
