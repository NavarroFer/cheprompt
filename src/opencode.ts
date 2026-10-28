import { spawn } from "node:child_process";
import { routingCatalog } from "./router";
import {
  ProviderDescriptor,
  RoutingDecision,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeInventory,
  RuntimeModel,
  RuntimeDescriptor,
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

export function launchOpenCode(prompt: string, decision: RoutingDecision): void {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const configuration = vscodeApi.workspace.getConfiguration("cheprompt");
  const executable = configuration.get<string>("opencodePath", "opencode");
  const cwd = vscodeApi.workspace.workspaceFolders?.[0]?.uri;
  const title = `ChePrompt: ${prompt.replace(/\s+/g, " ").slice(0, 48)}`;

  const terminal = vscodeApi.window.createTerminal({
    name: `ChePrompt · ${decision.selected.label}`,
    cwd,
    shellPath: executable,
    shellArgs: [
      "run",
      "--model",
      decision.selected.id,
      "--title",
      title,
      prompt,
    ],
    iconPath: new vscodeApi.ThemeIcon("sparkle"),
  });

  terminal.show();
}
