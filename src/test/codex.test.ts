import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexExecArgs,
  CODEX_CHATGPT_EXPIRES_AT,
  CODEX_USAGE_SOURCE,
  CodexAdapter,
  codexSubscriptionEnvironment,
  parseCodexAuthentication,
} from "../codex";
import {
  ProcessCompletion,
  ProcessExecutor,
  ProcessResult,
  StreamingProcess,
  StreamingProcessSpawner,
} from "../opencode";
import { routingCatalog } from "../router";
import { RoutingDecision, RuntimeExecutionEvent } from "../types";

async function* chunks(values: readonly string[]): AsyncIterable<string> {
  for (const value of values) yield value;
}

class FakeProcessExecutor implements ProcessExecutor {
  calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];

  constructor(private readonly results: Array<ProcessResult | Error>) {}

  async run(_executable: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }): Promise<ProcessResult> {
    this.calls.push({ args: [...args], env: options?.env });
    const result = this.results.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Unexpected process invocation");
    return result;
  }
}

class FakeStreamingProcess implements StreamingProcess {
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly completion: Promise<ProcessCompletion>;
  cancelCalls = 0;
  private finish!: (completion: ProcessCompletion) => void;

  constructor(stdout: readonly string[], exitCode: number | undefined) {
    this.stdout = chunks(stdout);
    this.stderr = chunks(["private diagnostic detail"]);
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
  env?: NodeJS.ProcessEnv;

  constructor(readonly process: FakeStreamingProcess) {}

  start(_executable: string, args: readonly string[], cwd?: string, env?: NodeJS.ProcessEnv): StreamingProcess {
    this.args = [...args];
    this.cwd = cwd;
    this.env = env;
    return this.process;
  }
}

const success = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0 });

const decision: RoutingDecision = {
  profile: "balanced",
  complexity: "standard",
  selected: {
    id: "codex-default",
    label: "Codex configured default",
    usageImpact: "medium",
    strengths: [],
    runtimeId: "codex",
    providerId: "chatgpt-codex",
    allowancePoolId: "chatgpt-codex",
    availability: "available",
    capabilities: ["text", "tools", "reasoning"],
    capabilitiesKnown: true,
  },
  alternatives: [],
  selectedScore: {
    taskFit: 100,
    usagePressure: 65,
    contextFit: null,
    capabilityFit: 100,
    availability: 100,
    expiration: 100,
    allowance: null,
    total: 100,
  },
  alternativeScores: [],
  allowancePoolId: "chatgpt-codex",
  matchedSignals: [],
  reason: "test",
  confidence: 0.8,
  pricing: "test",
};

test("discovers Codex CLI and ChatGPT auth status without reading credentials", async () => {
  const process = new FakeProcessExecutor([
    success("codex 0.159.0"),
    success("Logged in using ChatGPT"),
  ]);
  const inventory = await new CodexAdapter("fake-codex", process).getInventory();

  assert.deepEqual(process.calls.map((call) => call.args), [["--version"], ["login", "status"]]);
  assert.ok(process.calls.every((call) => call.env?.OPENAI_API_KEY === undefined && call.env?.CODEX_API_KEY === undefined));
  assert.equal(inventory.runtime.id, "codex");
  assert.equal(inventory.runtime.availability, "available");
  assert.equal(inventory.providers[0].id, "chatgpt-codex");
  assert.equal(inventory.models[0].id, "codex-default");
  assert.equal(inventory.models[0].capabilitiesKnown, false);
  assert.equal(inventory.models[0].expiresAt, CODEX_CHATGPT_EXPIRES_AT);
  assert.equal(JSON.stringify(inventory).includes("token"), false);
});

test("recognizes ChatGPT login status when Codex CLI writes it to stderr", async () => {
  const process = new FakeProcessExecutor([
    success("codex 0.165.0"),
    { stdout: "", stderr: "Logged in using ChatGPT", exitCode: 0 },
  ]);
  const inventory = await new CodexAdapter("fake-codex", process).getInventory();

  assert.equal(inventory.runtime.availability, "available");
  assert.equal(inventory.runtime.message?.startsWith("Autenticado con ChatGPT"), true);
});

test("recognizes API-key auth but does not apply the ChatGPT subscription expiration", async () => {
  const process = new FakeProcessExecutor([
    success("codex 0.159.0"),
    success("Logged in using API key"),
  ]);
  const inventory = await new CodexAdapter("fake-codex", process).getInventory();

  assert.equal(inventory.runtime.availability, "available");
  assert.equal(inventory.runtime.expiresAt, undefined);
  assert.equal(inventory.models[0].expiresAt, undefined);
  assert.equal(inventory.providers[0].id, "openai-api");
  assert.match(inventory.runtime.message ?? "", /factura por separado/);
});

test("marks the ChatGPT runtime expired after the configured subscription date", async () => {
  const process = new FakeProcessExecutor([
    success("codex 0.159.0"),
    success("Logged in using ChatGPT"),
  ]);
  const inventory = await new CodexAdapter("fake-codex", process).getInventory("2000-01-01T00:00:00.000Z");

  assert.equal(inventory.runtime.availability, "expired");
  assert.equal(inventory.providers[0].availability, "expired");
  assert.equal(inventory.models[0].availability, "expired");
});

test("reports missing or unrecognized authentication as unavailable without leaking output", async () => {
  const process = new FakeProcessExecutor([
    success("codex 0.159.0"),
    { stdout: "Not logged in; private diagnostic", stderr: "private stderr", exitCode: 1 },
  ]);
  const inventory = await new CodexAdapter("fake-codex", process).getInventory();

  assert.equal(inventory.runtime.availability, "unavailable");
  assert.equal(inventory.runtime.installed, true);
  assert.equal(inventory.models[0].availability, "unavailable");
  assert.match(inventory.runtime.message ?? "", /Iniciá sesión con ChatGPT/);
  assert.equal(JSON.stringify(inventory).includes("private"), false);
  assert.equal(parseCodexAuthentication("Logged in using an unknown method", 0), "unknown");
});

test("reports a missing Codex executable clearly", async () => {
  const missing = Object.assign(new Error("spawn failed"), { code: "ENOENT" });
  const process = new FakeProcessExecutor([missing]);
  const inventory = await new CodexAdapter("missing-codex", process).getInventory();

  assert.equal(inventory.runtime.availability, "unavailable");
  assert.equal(inventory.runtime.installed, false);
  assert.match(inventory.runtime.message ?? "", /No se encontró Codex CLI/);
});

test("reports Codex usage as unavailable instead of estimating a percentage", async () => {
  const snapshot = await new CodexAdapter("unused", new FakeProcessExecutor([])).getUsageLimits();

  assert.equal(snapshot.status, "not-available");
  assert.deepEqual(snapshot.windows, []);
  assert.equal(snapshot.source, CODEX_USAGE_SOURCE);
  assert.equal(snapshot.freshness, "unknown");
});

test("exec streams documented JSONL events and uses only workspace-write/on-request flags", async () => {
  const output = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
    JSON.stringify({ type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Done" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }),
  ].join("\n");
  const process = new FakeStreamingProcess([`${output}\n`], 0);
  const spawner = new FakeSpawner(process);
  const events: RuntimeExecutionEvent[] = [];
  const adapter = new CodexAdapter("fake-codex", new FakeProcessExecutor([]), spawner);
  const execution = adapter.start("Fix this", decision, "/workspace", (event) => events.push(event));
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(result.sessionId, "thread-123");
  assert.equal(spawner.cwd, "/workspace");
  assert.equal(spawner.env?.OPENAI_API_KEY, undefined);
  assert.equal(spawner.env?.CODEX_API_KEY, undefined);
  assert.deepEqual(spawner.args, [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "on-request",
    "Fix this",
  ]);
  assert.ok(!spawner.args?.some((arg) => /full-auto|approve-for-me|dangerously|yolo/.test(arg)));
  assert.equal(events.find((event) => event.type === "text")?.text, "Done");
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(JSON.stringify(events).includes("private diagnostic"), false);
});

test("removes API-key overrides without mutating the parent environment", () => {
  const source = { PATH: "/bin", OPENAI_API_KEY: "private-openai", CODEX_API_KEY: "private-codex" };
  const sanitized = codexSubscriptionEnvironment(source);

  assert.deepEqual(sanitized, { PATH: "/bin" });
  assert.equal(source.OPENAI_API_KEY, "private-openai");
  assert.equal(source.CODEX_API_KEY, "private-codex");
});

test("passes an explicitly selected model while the default remains Codex-configured", () => {
  const customDecision: RoutingDecision = {
    ...decision,
    selected: { ...routingCatalog[0], id: "gpt-6.1-sol" },
  };

  assert.deepEqual(buildCodexExecArgs("Task", customDecision), [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "on-request",
    "--model",
    "gpt-6.1-sol",
    "Task",
  ]);
});

test("classifies quota and auth errors safely and temporarily disables the runtime", async () => {
  for (const [detail, expected] of [
    ["Rate limit reached for account", /límite de uso/],
    ["Not authenticated; secret token=value", /requiere autenticación/],
  ] as const) {
    const failed = new FakeStreamingProcess([
      `${JSON.stringify({ type: "turn.failed", error: { message: detail } })}\n`,
    ], 1);
    const spawner = new FakeSpawner(failed);
    const executor = new FakeProcessExecutor([
      success("codex 0.159.0"),
      success("Logged in using ChatGPT"),
    ]);
    const events: RuntimeExecutionEvent[] = [];
    const adapter = new CodexAdapter("fake-codex", executor, spawner);
    const result = await adapter.start("Task", decision, undefined, (event) => events.push(event)).result;

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", expected);
    assert.equal(JSON.stringify(events).includes("secret token=value"), false);
    const inventory = await adapter.getInventory();
    assert.equal(inventory.runtime.availability, "unavailable");
  }
});

test("surfaces approval-needed events without enabling automatic approval", async () => {
  const process = new FakeStreamingProcess([
    `${JSON.stringify({ type: "turn.failed", error: { message: "Action requires approval" } })}\n`,
  ], 1);
  const events: RuntimeExecutionEvent[] = [];
  const execution = new CodexAdapter("fake-codex", new FakeProcessExecutor([]), new FakeSpawner(process)).start(
    "Task",
    decision,
    undefined,
    (event) => events.push(event),
  );
  const result = await execution.result;

  assert.equal(result.status, "failed");
  assert.ok(events.some((event) => event.type === "approval_required"));
  assert.ok(!buildCodexExecArgs("Task", decision).includes("--full-auto"));
});

test("treats malformed JSONL as failed and supports cancellation", async () => {
  const malformed = new FakeStreamingProcess(["not json\n"], 0);
  const malformedEvents: RuntimeExecutionEvent[] = [];
  const malformedResult = await new CodexAdapter("fake-codex", new FakeProcessExecutor([]), new FakeSpawner(malformed))
    .start("Task", decision, undefined, (event) => malformedEvents.push(event)).result;
  assert.equal(malformedResult.status, "failed");
  assert.match(malformedResult.error ?? "", /JSON inválida/);
  assert.ok(malformedEvents.some((event) => event.type === "error"));

  const pending = new FakeStreamingProcess([], undefined);
  const execution = new CodexAdapter("fake-codex", new FakeProcessExecutor([]), new FakeSpawner(pending))
    .start("Task", decision, undefined, () => {});
  execution.cancel();
  const cancelled = await execution.result;
  assert.equal(pending.cancelCalls, 1);
  assert.equal(cancelled.status, "cancelled");
});
