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
} from "./types";

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
