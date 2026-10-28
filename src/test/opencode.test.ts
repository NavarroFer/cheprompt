import assert from "node:assert/strict";
import test from "node:test";
import { OpenCodeAdapter, ProcessExecutor, ProcessResult } from "../opencode";

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

test("discovers OpenCode models and provider inventory without credentials", async () => {
  const process = new FakeProcessExecutor([
    success("OpenCode 1.2.3"),
    success("opencode-go/gpt-6-luna\nopencode-go/gemini-4-argon\n"),
  ]);
  const inventory = await new OpenCodeAdapter("fake-opencode", process).getInventory();

  assert.deepEqual(process.calls, [["--version"], ["models"]]);
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
