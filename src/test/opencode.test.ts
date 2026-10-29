import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NodeStreamingProcessSpawner,
  MODEL_METADATA_ENDPOINT,
  OpenCodeAdapter,
  parseOpenCodeImageModels,
  parseOpenCodeUsageLimits,
  ProcessExecutor,
  ProcessResult,
  streamingProcessEnvironment,
  USAGE_LIMITS_ENDPOINT,
  USAGE_SNAPSHOT_MAX_AGE_MS,
} from "../opencode";

class FakeProcessExecutor implements ProcessExecutor {
  calls: string[][] = [];

  constructor(private readonly results: Array<ProcessResult | Error>) {}

  async run(_executable: string, args: readonly string[]): Promise<ProcessResult> {
    this.calls.push([...args]);
    const result = this.results.shift();
    if (result instanceof Error) {
      throw result;
    }
    if (!result) {
      throw new Error("Unexpected process invocation");
    }
    return result;
  }
}

const success = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0 });

function usageResponse() {
  return {
    workspace: { id: "workspace-1", usageURL: "https://opencode.ai/console/workspace-1/activity/overview" },
    go: {
      rolling: { percent: 23, limited: false, resetsAt: 1_800_000_000_000 },
      weekly: { percent: 75, limited: false, resetsAt: 1_800_100_000_000 },
      monthly: { percent: 100, limited: true, resetsAt: 1_800_200_000_000 },
    },
    budgets: [],
  };
}

test("discovers OpenCode models and provider inventory without credentials", async () => {
  const process = new FakeProcessExecutor([
    success("OpenCode 1.2.3"),
    success("opencode-go/gpt-6-luna\nopencode-go/gemini-4-argon\n"),
    success(JSON.stringify({
      data: [
        { providerID: "opencode-go", modelID: "gemini-4-argon", capabilities: { input: ["text", "image"] } },
        { providerID: "opencode-go", modelID: "gpt-6-luna", capabilities: { input: ["text"] } },
      ],
    })),
  ]);
  const inventory = await new OpenCodeAdapter("fake-opencode", process).getInventory();

  assert.deepEqual(process.calls, [["--version"], ["models"], ["api", "GET", MODEL_METADATA_ENDPOINT]]);
  assert.equal(inventory.models.find((model) => model.id === "opencode-go/gemini-4-argon")?.capabilities.includes("vision"), true);
  assert.equal(inventory.models.find((model) => model.id === "opencode-go/gpt-6-luna")?.capabilities.includes("vision"), false);
  assert.equal(inventory.runtime.id, "opencode");
  assert.deepEqual(inventory.providers.map((provider) => provider.id), ["opencode-go"]);
  assert.deepEqual(inventory.models.map((model) => model.id), [
    "opencode-go/gpt-6-luna",
    "opencode-go/gemini-4-argon",
  ]);
  assert.ok(inventory.models.every((model) => model.availability === "available"));
  assert.equal(JSON.stringify(inventory).includes("credential"), false);
});

test("reports a missing OpenCode CLI clearly", async () => {
  const missing = Object.assign(new Error("spawn failed"), { code: "ENOENT" });
  const process = new FakeProcessExecutor([missing]);

  await assert.rejects(
    new OpenCodeAdapter("missing-opencode", process).getInventory(),
    /No se encontró OpenCode/,
  );
});

test("reports malformed model output clearly", async () => {
  const process = new FakeProcessExecutor([success("OpenCode 1.2.3"), success("not a model list")]);

  await assert.rejects(
    new OpenCodeAdapter("fake-opencode", process).getInventory(),
    /formato no reconocido/,
  );
});

test("reports an empty model list clearly", async () => {
  const process = new FakeProcessExecutor([success("OpenCode 1.2.3"), success("")]);

  await assert.rejects(
    new OpenCodeAdapter("fake-opencode", process).getInventory(),
    /no encontró modelos disponibles/,
  );
});

test("reads all official Go usage windows and normalizes used percent to remaining", async () => {
  const payload = JSON.stringify(usageResponse());
  const process = new FakeProcessExecutor([success(payload)]);
  const snapshot = await new OpenCodeAdapter("fake-opencode", process).getUsageLimits();

  assert.deepEqual(process.calls, [["api", "GET", USAGE_LIMITS_ENDPOINT]]);
  assert.equal(snapshot.status, "available");
  assert.equal(snapshot.runtimeId, "opencode");
  assert.equal(snapshot.provider, "OpenCode Go");
  assert.equal(snapshot.source, `OpenCode API ${USAGE_LIMITS_ENDPOINT}`);
  assert.deepEqual(snapshot.windows, [
    { window: "rolling", remainingPercent: 77, resetsAt: 1_800_000_000_000, limited: false },
    { window: "weekly", remainingPercent: 25, resetsAt: 1_800_100_000_000, limited: false },
    { window: "monthly", remainingPercent: 0, resetsAt: 1_800_200_000_000, limited: true },
  ]);
  assert.equal(snapshot.freshness, "fresh");
});

test("reports unsupported percentage data as unavailable rather than zero", () => {
  const observedAt = 1_800_000_000_000;
  const snapshots = [
    parseOpenCodeUsageLimits("null", observedAt, observedAt + 1),
    parseOpenCodeUsageLimits(
      JSON.stringify({ workspace: { id: "workspace-1" }, budgets: [] }),
      observedAt,
      observedAt + 1,
    ),
  ];

  for (const snapshot of snapshots) {
    assert.equal(snapshot.status, "not-available");
    assert.deepEqual(snapshot.windows, []);
    assert.equal(snapshot.freshness, "fresh");
  }
});

test("treats stale usage snapshots as unknown and hides their percentages", () => {
  const observedAt = 1_800_000_000_000;
  const snapshot = parseOpenCodeUsageLimits(
    JSON.stringify(usageResponse()),
    observedAt,
    observedAt + USAGE_SNAPSHOT_MAX_AGE_MS,
  );

  assert.equal(snapshot.status, "unknown");
  assert.equal(snapshot.freshness, "stale");
  assert.deepEqual(snapshot.windows, []);
});

test("treats malformed and out-of-range usage responses as unknown", () => {
  const observedAt = 1_800_000_000_000;
  const malformed = parseOpenCodeUsageLimits("{not-json", observedAt, observedAt);
  const invalidPayload = usageResponse();
  invalidPayload.go.rolling.percent = 101;
  const invalid = parseOpenCodeUsageLimits(JSON.stringify(invalidPayload), observedAt, observedAt);

  for (const snapshot of [malformed, invalid]) {
    assert.equal(snapshot.status, "unknown");
    assert.equal(snapshot.freshness, "unknown");
    assert.deepEqual(snapshot.windows, []);
  }
});

test("treats a failed official usage request as unknown, never as exhausted", async () => {
  const process = new FakeProcessExecutor([{ stdout: "", stderr: "private detail", exitCode: 1 }]);
  const snapshot = await new OpenCodeAdapter("fake-opencode", process).getUsageLimits();

  assert.equal(snapshot.status, "unknown");
  assert.deepEqual(snapshot.windows, []);
  assert.equal(JSON.stringify(snapshot).includes("private detail"), false);
});

test("aligns PWD with the execution directory so runtimes do not resolve the extension host directory", () => {
  const inherited = { PATH: "/usr/bin", PWD: "/" };

  assert.deepEqual(streamingProcessEnvironment("/repo", inherited), { PATH: "/usr/bin", PWD: "/repo" });
  assert.equal(inherited.PWD, "/");
  assert.equal(streamingProcessEnvironment("/repo", undefined)?.PWD, "/repo");
  assert.equal(streamingProcessEnvironment(undefined, inherited), inherited);
});

test("starts streaming processes with PWD set to their working directory", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "cheprompt-pwd-")));
  const child = new NodeStreamingProcessSpawner().start(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify({ pwd: process.env.PWD, cwd: process.cwd() }))"],
    cwd,
    { ...process.env, PWD: "/" },
  );
  let stdout = "";
  for await (const chunk of child.stdout) stdout += chunk;
  const completion = await child.completion;

  assert.equal(completion.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), { pwd: cwd, cwd });
});

test("reads image input support from OpenCode model metadata and ignores malformed data", () => {
  const metadata = JSON.stringify({
    data: [
      { providerID: "opencode-go", modelID: "deepseek-v4.1-flash", capabilities: { input: ["text", "image"] } },
      { providerID: "opencode-go", modelID: "hy4-preview", capabilities: { input: ["text"] } },
      { providerID: "opencode-go", capabilities: { input: ["image"] } },
    ],
  });

  assert.deepEqual([...parseOpenCodeImageModels(metadata)], ["opencode-go/deepseek-v4.1-flash"]);
  assert.deepEqual([...parseOpenCodeImageModels("<html>")], []);
  assert.deepEqual([...parseOpenCodeImageModels("{}")], []);
});
