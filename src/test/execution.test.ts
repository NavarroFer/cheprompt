import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInteractiveOpenCodeArgs,
  OpenCodeExecutionAdapter,
  ProcessCompletion,
  StreamingProcess,
  StreamingProcessSpawner,
} from "../opencode";
import { routingCatalog } from "../router";
import { RoutingDecision, RuntimeExecutionEvent } from "../types";

async function* chunks(values: readonly string[]): AsyncIterable<string> {
  for (const value of values) yield value;
}

class FakeStreamingProcess implements StreamingProcess {
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly completion: Promise<ProcessCompletion>;
  cancelCalls = 0;
  private finish!: (completion: ProcessCompletion) => void;

  constructor(stdout: readonly string[], exitCode: number | undefined) {
    this.stdout = chunks(stdout);
    this.stderr = chunks([]);
    this.completion = new Promise((resolve) => { this.finish = resolve; });
    if (exitCode !== undefined) this.finish({ exitCode });
  }

  cancel(): void {
    this.cancelCalls += 1;
    this.finish({ exitCode: 130 });
  }
}

class FakeSpawner implements StreamingProcessSpawner {
  args?: readonly string[];
  cwd?: string;

  constructor(readonly process: FakeStreamingProcess) {}

  start(_executable: string, args: readonly string[], cwd?: string): StreamingProcess {
    this.args = [...args];
    this.cwd = cwd;
    return this.process;
  }
}

const decision: RoutingDecision = {
  profile: "balanced",
  complexity: "simple",
  selected: routingCatalog[0],
  alternatives: [],
  matchedSignals: [],
  reason: "test",
  confidence: 0.8,
  pricing: "test",
  selectedScore: {
    taskFit: 100,
    usagePressure: 100,
    contextFit: null,
    capabilityFit: 100,
    availability: 100,
    expiration: 100,
    allowance: null,
    total: 100,
  },
  alternativeScores: [],
  allowancePoolId: "opencode-go",
};

test("streams JSON events incrementally and captures the OpenCode session", async () => {
  const textEvent = JSON.stringify({ type: "text", timestamp: 123, sessionID: "ses_test", part: { text: "Hola" } });
  const process = new FakeStreamingProcess([textEvent.slice(0, 19), `${textEvent.slice(19)}\n`], 0);
  const spawner = new FakeSpawner(process);
  const events: RuntimeExecutionEvent[] = [];
  const execution = new OpenCodeExecutionAdapter("fake-opencode", spawner).start(
    "Hacé una tarea",
    decision,
    "/workspace",
    (event) => events.push(event),
  );
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(result.sessionId, "ses_test");
  assert.equal(spawner.cwd, "/workspace");
  assert.ok(spawner.args?.includes("--format"));
  assert.ok(spawner.args?.includes("json"));
  assert.ok(!spawner.args?.includes("--auto"));
  assert.equal(events.find((event) => event.type === "text")?.text, "Hola");
  assert.equal(events.at(-1)?.type, "completed");
});

test("treats malformed JSONL as a failed execution and emits a clear error", async () => {
  const process = new FakeStreamingProcess(["this is not json\n"], 0);
  const events: RuntimeExecutionEvent[] = [];
  const execution = new OpenCodeExecutionAdapter("fake-opencode", new FakeSpawner(process)).start(
    "Hacé una tarea",
    decision,
    undefined,
    (event) => events.push(event),
  );
  const result = await execution.result;

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /JSON inválida/);
  assert.equal(result.failureKind, "protocol");
  assert.ok(events.some((event) => event.type === "error"));
});

test("cancels the child process and reports a cancelled result", async () => {
  const process = new FakeStreamingProcess([], undefined);
  const execution = new OpenCodeExecutionAdapter("fake-opencode", new FakeSpawner(process)).start(
    "Hacé una tarea",
    decision,
    undefined,
    () => {},
  );

  execution.cancel();
  const result = await execution.result;

  assert.equal(process.cancelCalls, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.exitCode, 130);
});

test("recognizes approval output and provides interactive terminal arguments", async () => {
  const sessionEvent = JSON.stringify({ type: "step_start", sessionID: "ses_approval", part: { type: "step-start" } });
  const process = new FakeStreamingProcess([`${sessionEvent}\npermission requested: bash (pwd)\n`], 1);
  const events: RuntimeExecutionEvent[] = [];
  const execution = new OpenCodeExecutionAdapter("fake-opencode", new FakeSpawner(process)).start(
    "Hacé una tarea",
    decision,
    undefined,
    (event) => events.push(event),
  );
  const result = await execution.result;

  assert.equal(result.failureKind, "approval");
  const approval = events.find((event) => event.type === "approval_required");
  assert.equal(approval?.sessionId, "ses_approval");
  assert.deepEqual(buildInteractiveOpenCodeArgs("ignored", decision, "ses_approval"), ["--session", "ses_approval"]);
  assert.deepEqual(buildInteractiveOpenCodeArgs("Hacé una tarea", decision), [
    "--model",
    decision.selected.id,
    "--prompt",
    "Hacé una tarea",
  ]);
});
