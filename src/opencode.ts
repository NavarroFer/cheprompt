import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { routingCatalog } from "./router";
import {
  ProviderDescriptor,
  RoutingDecision,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeInventory,
  RuntimeModel,
  RuntimeDescriptor,
  RuntimeExecutionEvent,
  RuntimeExecutionResult,
  UsageSnapshot,
  UsageWindow,
} from "./types";

export const USAGE_LIMITS_ENDPOINT = "/api/experimental/usage/limits";
export const USAGE_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const USAGE_SOURCE = `OpenCode API ${USAGE_LIMITS_ENDPOINT}`;
const USAGE_WINDOWS: readonly UsageWindow[] = ["rolling", "weekly", "monthly"];

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessExecutor {
  run(executable: string, args: readonly string[]): Promise<ProcessResult>;
}

export interface ProcessCompletion {
  exitCode: number;
  error?: Error;
}

export interface StreamingProcess {
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  completion: Promise<ProcessCompletion>;
  cancel(): void;
}

export interface StreamingProcessSpawner {
  start(executable: string, args: readonly string[], cwd?: string): StreamingProcess;
}

export interface OpenCodeExecutionHandle {
  executionId: string;
  result: Promise<RuntimeExecutionResult>;
  cancel(): void;
}

export class NodeProcessExecutor implements ProcessExecutor {
  run(executable: string, args: readonly string[]): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });
    });
  }
}

export class NodeStreamingProcessSpawner implements StreamingProcessSpawner {
  start(executable: string, args: readonly string[], cwd?: string): StreamingProcess {
    const child = spawn(executable, [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const completion = new Promise<ProcessCompletion>((resolve) => {
      child.once("error", (error) => { spawnError = error; });
      child.once("close", (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, ...(spawnError ? { error: spawnError } : {}) });
      });
    });
    return {
      stdout: child.stdout as AsyncIterable<string>,
      stderr: child.stderr as AsyncIterable<string>,
      completion,
      cancel: () => { child.kill("SIGINT"); },
    };
  }
}

export class OpenCodeExecutionAdapter {
  constructor(
    private readonly executable = "opencode",
    private readonly processSpawner: StreamingProcessSpawner = new NodeStreamingProcessSpawner(),
  ) {}

  start(
    prompt: string,
    decision: RoutingDecision,
    cwd: string | undefined,
    onEvent: (event: RuntimeExecutionEvent) => void,
  ): OpenCodeExecutionHandle {
    const executionId = randomUUID();
    const title = `ChePrompt: ${prompt.replace(/\s+/g, " ").slice(0, 48)}`;
    const process = this.processSpawner.start(this.executable, [
      "run",
      "--format",
      "json",
      "--model",
      decision.selected.id,
      "--title",
      title,
      prompt,
    ], cwd);
    let sessionId: string | undefined;
    let malformedOutput = false;
    let reportedError: string | undefined;
    let cancelled = false;

    const emit = (type: RuntimeExecutionEvent["type"], values: Partial<RuntimeExecutionEvent> = {}) => {
      onEvent({ executionId, type, timestamp: Date.now(), ...values });
    };
    emit("started");

    const consumeStdout = async () => {
      let buffer = "";
      for await (const chunk of process.stdout) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) consumeJsonLine(line);
      }
      if (buffer.trim()) consumeJsonLine(buffer);
    };

    const consumeJsonLine = (line: string) => {
      const normalized = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (!normalized) return;
      let value: unknown;
      try {
        value = JSON.parse(normalized);
      } catch {
        if (/permission requested:/i.test(normalized)) {
          emit("approval_required", { sessionId, message: normalized });
          return;
        }
        malformedOutput = true;
        reportedError = "OpenCode devolvió una línea JSON inválida.";
        emit("error", { sessionId, message: reportedError });
        return;
      }
      if (!isRecord(value) || typeof value.type !== "string") {
        malformedOutput = true;
        reportedError = "OpenCode devolvió un evento sin tipo.";
        emit("error", { sessionId, message: reportedError });
        return;
      }

      if (typeof value.sessionID === "string") sessionId = value.sessionID;
      const eventSessionId = sessionId;
      const time = typeof value.timestamp === "number" ? value.timestamp : Date.now();
      if (value.type === "text") {
        const part = isRecord(value.part) ? value.part : undefined;
        if (typeof part?.text === "string") emit("text", { sessionId: eventSessionId, timestamp: time, text: part.text });
        return;
      }
      if (value.type === "step_start" || value.type === "step_finish") {
        const part = isRecord(value.part) ? value.part : undefined;
        emit("step", {
          sessionId: eventSessionId,
          timestamp: time,
          message: typeof part?.type === "string" ? part.type : value.type,
        });
        return;
      }
      if (value.type === "tool_use") {
        const part = isRecord(value.part) ? value.part : undefined;
        emit("tool", {
          sessionId: eventSessionId,
          timestamp: time,
          message: typeof part?.tool === "string" ? part.tool : "OpenCode ejecutó una herramienta.",
        });
        return;
      }
      if (value.type === "error") {
        const error = isRecord(value.error) ? value.error : undefined;
        reportedError = typeof error?.message === "string"
          ? error.message
          : typeof value.message === "string" ? value.message : "OpenCode informó un error.";
        emit("error", { sessionId: eventSessionId, timestamp: time, message: reportedError });
        return;
      }
      if (value.type === "approval_required" || value.type === "permission.asked") {
        emit("approval_required", { sessionId: eventSessionId, timestamp: time, message: "OpenCode requiere una aprobación interactiva." });
      }
    };

    const result = (async (): Promise<RuntimeExecutionResult> => {
      const consume = Promise.all([
        consumeStdout(),
        drain(process.stderr),
      ]).catch(() => {
        malformedOutput = true;
        reportedError = "Se interrumpió la lectura de la salida de OpenCode.";
      });
      const completion = await process.completion;
      await consume;
      const status: RuntimeExecutionResult["status"] = cancelled
        ? "cancelled"
        : completion.error || completion.exitCode !== 0 || malformedOutput || reportedError
          ? "failed"
          : "succeeded";
      const error = completion.error
        ? "No se pudo iniciar OpenCode."
        : reportedError ?? (completion.exitCode !== 0 ? `OpenCode terminó con código ${completion.exitCode}.` : undefined);
      const final: RuntimeExecutionResult = {
        executionId,
        status,
        exitCode: completion.exitCode,
        ...(sessionId ? { sessionId } : {}),
        ...(error ? { error } : {}),
      };
      emit(cancelled ? "cancelled" : "completed", {
        ...(sessionId ? { sessionId } : {}),
        message: error ?? (cancelled ? "Ejecución cancelada." : "Ejecución finalizada."),
      });
      return final;
    })();

    return {
      executionId,
      result,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        process.cancel();
      },
    };
  }
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const _chunk of stream) {
    // Drain stderr without forwarding potentially sensitive process details into the webview.
  }
}

const OPENCODE_RUNTIME: RuntimeDescriptor = {
  id: "opencode",
  name: "OpenCode",
  availability: "available",
};

export class OpenCodeAdapter implements RuntimeAdapter {
  constructor(
    private readonly executable = "opencode",
    private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
  ) {}

  async getInventory(): Promise<RuntimeInventory> {
    try {
      const version = await this.processExecutor.run(this.executable, ["--version"]);
      if (version.exitCode !== 0) {
        throw new Error("OpenCode no pudo iniciar correctamente.");
      }

      const result = await this.processExecutor.run(this.executable, ["models"]);
      if (result.exitCode !== 0) {
        throw new Error("OpenCode no pudo listar modelos. Revisá la instalación de OpenCode.");
      }

      const ids = parseModelIds(result.stdout);
      if (!ids.length) {
        if (!result.stdout.trim()) {
          throw new Error("OpenCode no encontró modelos disponibles.");
        }
        throw new Error("OpenCode devolvió una lista de modelos con formato no reconocido.");
      }

      const models = ids.map(toRuntimeModel);
      const providers = uniqueProviders(models);
      return {
        runtime: OPENCODE_RUNTIME,
        providers,
        models,
        discoveredAt: new Date().toISOString(),
      };
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error("No se encontró OpenCode. Instalá el CLI o configurá cheprompt.opencodePath.");
      }
      throw error;
    }
  }

  async getUsageLimits(): Promise<UsageSnapshot> {
    try {
      // The official CLI resolves its managed server and credentials from OpenCode's own store.
      const result = await this.processExecutor.run(this.executable, ["api", "GET", USAGE_LIMITS_ENDPOINT]);
      const observedAt = Date.now();
      if (result.exitCode !== 0) {
        return unknownUsageSnapshot(observedAt);
      }
      return parseOpenCodeUsageLimits(result.stdout, observedAt, observedAt);
    } catch {
      return unknownUsageSnapshot(Date.now());
    }
  }
}

export function parseOpenCodeUsageLimits(
  output: string,
  observedAt: number,
  now: number,
): UsageSnapshot {
  const base = {
    runtimeId: OPENCODE_RUNTIME.id,
    provider: "OpenCode Go",
    source: USAGE_SOURCE,
    observedAt,
  };

  let response: unknown;
  try {
    response = JSON.parse(output);
  } catch {
    return { ...base, status: "unknown", windows: [], freshness: "unknown" };
  }

  const freshness = usageFreshness(observedAt, now);
  if (freshness !== "fresh") {
    return { ...base, status: "unknown", windows: [], freshness };
  }

  if (response === null) {
    return { ...base, status: "not-available", windows: [], freshness };
  }
  if (!isRecord(response) || !isRecord(response.workspace) || !Array.isArray(response.budgets)) {
    return { ...base, status: "unknown", windows: [], freshness: "unknown" };
  }
  if (response.go === undefined) {
    return { ...base, status: "not-available", windows: [], freshness };
  }
  if (!isRecord(response.go)) {
    return { ...base, status: "unknown", windows: [], freshness: "unknown" };
  }

  const windows = [];
  for (const window of USAGE_WINDOWS) {
    const meter = response.go[window];
    if (
      !isRecord(meter)
      || typeof meter.percent !== "number"
      || !Number.isFinite(meter.percent)
      || meter.percent < 0
      || meter.percent > 100
      || typeof meter.limited !== "boolean"
      || typeof meter.resetsAt !== "number"
      || !Number.isFinite(meter.resetsAt)
    ) {
      return { ...base, status: "unknown", windows: [], freshness: "unknown" };
    }
    windows.push({
      window,
      // The official schema documents percent as allowance already used.
      remainingPercent: 100 - meter.percent,
      resetsAt: meter.resetsAt,
    });
  }

  return { ...base, status: "available", windows, freshness };
}

export function usageFreshness(observedAt: number, now: number): "fresh" | "stale" | "unknown" {
  if (!Number.isFinite(observedAt) || !Number.isFinite(now) || observedAt > now) {
    return "unknown";
  }
  return now - observedAt >= USAGE_SNAPSHOT_MAX_AGE_MS ? "stale" : "fresh";
}

function unknownUsageSnapshot(observedAt: number): UsageSnapshot {
  return {
    runtimeId: OPENCODE_RUNTIME.id,
    provider: "OpenCode Go",
    status: "unknown",
    windows: [],
    source: USAGE_SOURCE,
    observedAt,
    freshness: "unknown",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseModelIds(output: string): string[] {
  const ids = new Set<string>();
  const normalized = output.replace(/\u001b\[[0-9;]*m/g, "");
  for (const line of normalized.split(/\r?\n/)) {
    const matches = line.matchAll(/(?:^|\s)([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?=$|\s)/g);
    for (const match of matches) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

function toRuntimeModel(id: string): RuntimeModel {
  const known = routingCatalog.find((model) => model.id === id);
  const [providerId, modelId] = id.split("/", 2);
  return {
    id,
    label: known?.label ?? modelId,
    usageImpact: known?.usageImpact ?? "medium",
    strengths: known?.strengths ?? ["modelo descubierto en OpenCode"],
    runtimeId: OPENCODE_RUNTIME.id,
    providerId,
    availability: "available",
    capabilities: known ? ["text", "tools"] : ["text"],
  };
}

function uniqueProviders(models: readonly RuntimeModel[]): ProviderDescriptor[] {
  const providers = new Map<string, ProviderDescriptor>();
  for (const model of models) {
    providers.set(model.providerId, {
      id: model.providerId,
      name: model.providerId,
      runtimeId: model.runtimeId,
      availability: "available" satisfies RuntimeAvailability,
    });
  }
  return [...providers.values()];
}

function isMissingExecutable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

export function buildInteractiveOpenCodeArgs(
  prompt: string,
  decision: RoutingDecision,
  sessionId?: string,
): string[] {
  return sessionId
    ? ["--session", sessionId]
    : ["--model", decision.selected.id, "--prompt", prompt];
}

export function launchOpenCodeInteractive(
  prompt: string,
  decision: RoutingDecision,
  sessionId?: string,
): void {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const configuration = vscodeApi.workspace.getConfiguration("cheprompt");
  const executable = configuration.get<string>("opencodePath", "opencode");
  const cwd = vscodeApi.workspace.workspaceFolders?.[0]?.uri;

  const terminal = vscodeApi.window.createTerminal({
    name: `ChePrompt · ${decision.selected.label} · interactivo`,
    cwd,
    shellPath: executable,
    shellArgs: buildInteractiveOpenCodeArgs(prompt, decision, sessionId),
    iconPath: new vscodeApi.ThemeIcon("sparkle"),
  });

  terminal.show();
}
