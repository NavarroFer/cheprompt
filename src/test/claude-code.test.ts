import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeInteractiveArgs,
  ClaudeCodeAdapter,
  claudeSubscriptionEnvironment,
  isClaudeSubscriptionAuth,
  parseClaudeAuthStatus,
  safeClaudeError,
} from "../claude-code";
import {
  ProcessCompletion,
  ProcessExecutionOptions,
  ProcessExecutor,
  StreamingProcess,
  StreamingProcessSpawner,
} from "../opencode";
import { RuntimeExecutionEvent } from "../types";

interface FakeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

class FakeProcessExecutor implements ProcessExecutor {
  readonly calls: Array<{ args: string[]; options?: ProcessExecutionOptions }> = [];

  constructor(private readonly results: Array<FakeResult | Error>) {}

  async run(_executable: string, args: readonly string[], options?: ProcessExecutionOptions): Promise<FakeResult> {
    this.calls.push({ args: [...args], options });
    const result = this.results.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Unexpected process invocation");
    return result;
  }
}

async function* stream(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

class FakeStreamingProcess implements StreamingProcess {
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly completion: Promise<ProcessCompletion>;
  cancelCalls = 0;
  private finish!: (completion: ProcessCompletion) => void;

  constructor(stdout: readonly string[], exitCode: number, stderr: readonly string[] = []) {
    this.stdout = stream(stdout);
    this.stderr = stream(stderr);
    this.completion = new Promise((resolve) => { this.finish = resolve; });
    this.finish({ exitCode });
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

const success = (stdout: string): FakeResult => ({ stdout, stderr: "", exitCode: 0 });
const claudeAuth = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiKey: "do-not-copy-this" });

test("validates Claude Pro through the official auth status without retaining account details", async () => {
  const process = new FakeProcessExecutor([success("2.1.312"), success(claudeAuth)]);
  const adapter = new ClaudeCodeAdapter("fake-claude", process);
  const inventory = await adapter.getInventory();

  assert.deepEqual(process.calls.map((call) => call.args), [["--version"], ["auth", "status"]]);
  assert.equal(process.calls[0].options?.env?.ANTHROPIC_API_KEY, undefined);
  assert.equal(process.calls[1].options?.env?.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(inventory.runtime.id, "claude-code");
  assert.equal(inventory.runtime.availability, "available");
  assert.equal(inventory.providers[0].name, "Claude Pro");
  assert.equal(inventory.models.length, 0);
  assert.equal(JSON.stringify(inventory).includes("do-not-copy-this"), false);
});

test("keeps unsupported auth methods unavailable and accepts only subscription OAuth methods", async () => {
  const process = new FakeProcessExecutor([
    success("2.1.312"),
    success(JSON.stringify({ loggedIn: true, authMethod: "api_key" })),
  ]);
  const inventory = await new ClaudeCodeAdapter("fake-claude", process).getInventory();

  assert.equal(inventory.runtime.availability, "unavailable");
  assert.match(inventory.runtime.message ?? "", /Claude Pro/);
  assert.equal(isClaudeSubscriptionAuth("claude.ai"), true);
  assert.equal(isClaudeSubscriptionAuth("oauth_token"), true);
  assert.equal(isClaudeSubscriptionAuth("api_key"), false);
  assert.equal(parseClaudeAuthStatus("not-json"), undefined);
});

test("reports an unauthenticated Claude Code install as unavailable without blocking CLI installation", async () => {
  const process = new FakeProcessExecutor([
    success("2.1.312"),
    { stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }), stderr: "", exitCode: 1 },
  ]);
  const inventory = await new ClaudeCodeAdapter("fake-claude", process).getInventory();

  assert.equal(inventory.runtime.availability, "unavailable");
  assert.equal(inventory.runtime.installed, true);
  assert.match(inventory.runtime.message ?? "", /Iniciá Claude Code/);
});

test("reports missing Claude Code without leaking process details", async () => {
  const missing = Object.assign(new Error("spawn ENOENT with private path"), { code: "ENOENT" });
  const inventory = await new ClaudeCodeAdapter(
    "missing-claude",
    new FakeProcessExecutor([missing]),
  ).getInventory();

  assert.equal(inventory.runtime.availability, "unavailable");
  assert.equal(inventory.runtime.installed, false);
  assert.equal(JSON.stringify(inventory).includes("private path"), false);
});

test("does not expose a guessed Claude usage percentage", async () => {
  const snapshot = await new ClaudeCodeAdapter("fake-claude", new FakeProcessExecutor([])).getUsageLimits();

  assert.equal(snapshot.status, "not-available");
  assert.deepEqual(snapshot.windows, []);
  assert.equal(snapshot.provider, "Claude Pro");
});

test("streams official Claude JSON events through the shared execution contract", async () => {
  const process = new FakeStreamingProcess([
    `${JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session" })}\n`,
    `${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hola" } },
    })}\n`,
    `${JSON.stringify({ type: "result", subtype: "success", result: "Hola", session_id: "claude-session" })}\n`,
  ], 0);
  const spawner = new FakeSpawner(process);
  const events: RuntimeExecutionEvent[] = [];
  const adapter = new ClaudeCodeAdapter("fake-claude", new FakeProcessExecutor([]), spawner);
  const execution = adapter.start("Hacé una tarea", "/workspace", (event) => events.push(event));
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(result.sessionId, "claude-session");
  assert.equal(spawner.cwd, "/workspace");
  assert.ok(spawner.args?.includes("--output-format"));
  assert.ok(spawner.args?.includes("stream-json"));
  assert.ok(spawner.args?.includes("--include-partial-messages"));
  assert.ok(spawner.args?.includes("default"));
  assert.ok(!spawner.args?.includes("--dangerously-skip-permissions"));
  assert.equal(events.find((event) => event.type === "text")?.text, "Hola");
  assert.equal(events.at(-1)?.type, "completed");
});

test("marks Claude Code temporarily unavailable after an official rate-limit failure", async () => {
  const retry = JSON.stringify({
    type: "system",
    subtype: "api_retry",
    error: "rate_limit",
    session_id: "claude-limited",
  });
  const resultEvent = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "rate limit reached",
    session_id: "claude-limited",
  });
  const spawner = new FakeSpawner(new FakeStreamingProcess([`${retry}\n${resultEvent}\n`], 1));
  const adapter = new ClaudeCodeAdapter("fake-claude", new FakeProcessExecutor([]), spawner);
  const execution = adapter.start("Hacé una tarea", undefined, () => {});
  const result = await execution.result;
  const inventory = await adapter.getInventory();

  assert.equal(result.status, "failed");
  assert.equal(result.runtimeUnavailable, true);
  assert.equal(inventory.runtime.availability, "unavailable");
  assert.match(inventory.runtime.message ?? "", /temporal/);
});

test("surfaces non-interactive permission denials as a TUI fallback event", async () => {
  const permission = JSON.stringify({
    type: "system",
    subtype: "permission_denied",
    session_id: "claude-permission",
    tool_name: "Bash",
  });
  const result = JSON.stringify({ type: "result", subtype: "success", result: "Done", session_id: "claude-permission" });
  const process = new FakeStreamingProcess([`${permission}\n${result}\n`], 0);
  const events: RuntimeExecutionEvent[] = [];
  const adapter = new ClaudeCodeAdapter("fake-claude", new FakeProcessExecutor([]), new FakeSpawner(process));

  await adapter.start("Hacé una tarea", undefined, (event) => events.push(event)).result;

  assert.ok(events.some((event) => event.type === "approval_required" && event.sessionId === "claude-permission"));
});

test("removes API-key and third-party overrides while leaving the official subscription token alone", () => {
  const environment = claudeSubscriptionEnvironment({
    ANTHROPIC_API_KEY: "not-forwarded",
    ANTHROPIC_AUTH_TOKEN: "not-forwarded-either",
    ANTHROPIC_BASE_URL: "https://custom.invalid",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "official-subscription-token",
    PATH: "/bin",
  });

  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(environment.ANTHROPIC_BASE_URL, undefined);
  assert.equal(environment.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, "official-subscription-token");
  assert.deepEqual(buildClaudeInteractiveArgs("prompt", "session-1"), [
    "--resume",
    "session-1",
    "--permission-mode",
    "default",
  ]);
});

test("redacts credentials from Claude CLI errors before showing them", () => {
  const message = safeClaudeError("Failed with sk-ant-api03-secret-value and Bearer oauth-secret");
  assert.equal(message.includes("sk-ant-api03-secret-value"), false);
  assert.equal(message.includes("oauth-secret"), false);
});
