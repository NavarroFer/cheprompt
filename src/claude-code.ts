import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  NodeProcessExecutor,
  NodeStreamingProcessSpawner,
  ProcessExecutor,
  RuntimeExecutionHandle,
  StreamingProcessSpawner,
} from "./opencode";
import {
  ExecutionUsageMetrics,
  ProviderDescriptor,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeDescriptor,
  RuntimeExecutionEvent,
  RuntimeExecutionOptions,
  RuntimeFailureKind,
  RuntimeExecutionResult,
  RuntimeInventory,
  RuntimeModel,
  UsageSnapshot,
} from "./types";

const RUNTIME_ID = "claude-code";
const PROVIDER_ID = "claude-pro";
const UNAVAILABLE_COOLDOWN_MS = 60 * 1000;
const ENVIRONMENT_OVERRIDES_TO_REMOVE = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

const CLAUDE_DEFAULT_MODEL: RuntimeModel = {
  id: "claude-code/default",
  label: "Claude Code · modelo predeterminado",
  usageImpact: "medium",
  strengths: ["modelo predeterminado configurado en Claude Code"],
  runtimeId: RUNTIME_ID,
  providerId: PROVIDER_ID,
  allowancePoolId: PROVIDER_ID,
  availability: "available",
  // The official CLI documents image input for this runtime.
  capabilities: ["text", "tools", "reasoning", "vision"],
  capabilitiesKnown: false,
};

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string;
}

export function parseClaudeAuthStatus(output: string): ClaudeAuthStatus | undefined {
  try {
    const value: unknown = JSON.parse(output);
    if (!isRecord(value) || typeof value.loggedIn !== "boolean" || typeof value.authMethod !== "string") {
      return undefined;
    }
    return { loggedIn: value.loggedIn, authMethod: value.authMethod };
  } catch {
    return undefined;
  }
}

export function claudeSubscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of ENVIRONMENT_OVERRIDES_TO_REMOVE) delete environment[key];
  return environment;
}

export class ClaudeCodeAdapter implements RuntimeAdapter {
  private unavailableUntil = 0;
  private unavailableMessage?: string;

  constructor(
    private readonly executable = "claude",
    private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
    private readonly processSpawner: StreamingProcessSpawner = new NodeStreamingProcessSpawner(),
  ) {}

  async getInventory(): Promise<RuntimeInventory> {
    if (Date.now() < this.unavailableUntil) {
      return this.inventory("unavailable", this.unavailableMessage ?? "Claude Code está temporalmente no disponible.", true);
    }

    try {
      const environment = claudeSubscriptionEnvironment();
      const version = await this.processExecutor.run(this.executable, ["--version"], { env: environment });
      if (version.exitCode !== 0) {
        return this.inventory("unavailable", "Claude Code no pudo iniciar.", true);
      }

      const auth = await this.processExecutor.run(this.executable, ["auth", "status"], { env: environment });
      const status = parseClaudeAuthStatus(auth.stdout);
      if (!status) {
        return this.inventory("unavailable", "No se pudo validar el inicio de sesión de Claude Code.", true);
      }
      if (!status.loggedIn) {
        return this.inventory(
          "unavailable",
          "Iniciá Claude Code con tu cuenta Claude Pro; no se usarán credenciales de API o de terceros.",
          true,
        );
      }
      if (auth.exitCode !== 0) {
        return this.inventory("unavailable", "Claude Code no pudo confirmar el inicio de sesión.", true);
      }
      if (!isClaudeSubscriptionAuth(status.authMethod)) {
        return this.inventory(
          "unavailable",
          "Iniciá Claude Code con tu cuenta Claude Pro; no se usarán credenciales de API o de terceros.",
          true,
        );
      }

      return this.inventory("available", "Claude Code está autenticado mediante una cuenta de Claude.", true);
    } catch (error) {
      if (isMissingExecutable(error)) {
        return this.inventory("unavailable", "No se encontró Claude Code. Instalá el CLI oficial para habilitarlo.", false);
      }
      return this.inventory("unavailable", "No se pudo consultar Claude Code.", true);
    }
  }

  async getUsageLimits(): Promise<UsageSnapshot> {
    return {
      runtimeId: RUNTIME_ID,
      provider: "Claude Pro",
      allowancePoolId: PROVIDER_ID,
      status: "not-available",
      windows: [],
      source: "Claude Code CLI no informa un porcentaje oficial restante",
      observedAt: Date.now(),
      freshness: "fresh",
    };
  }

  start(
    prompt: string,
    cwd: string | undefined,
    onEvent: (event: RuntimeExecutionEvent) => void,
    options: RuntimeExecutionOptions = {},
  ): RuntimeExecutionHandle {
    const executionId = randomUUID();
    const environment = claudeSubscriptionEnvironment();
    const process = this.processSpawner.start(this.executable, buildClaudePrintArgs(prompt, options), cwd, environment);

    let sessionId: string | undefined;
    let malformedOutput = false;
    let reportedError: string | undefined;
    let authOrQuotaFailure = false;
    let cancelled = false;
    let emittedText = false;
    let retryCount = 0;
    let usageMetrics: ExecutionUsageMetrics | undefined;
    let failureKind: RuntimeFailureKind | undefined;
    let approvalRequired = false;

    const emit = (type: RuntimeExecutionEvent["type"], values: Partial<RuntimeExecutionEvent> = {}) => {
      onEvent({ executionId, type, timestamp: Date.now(), ...values });
    };
    emit("started");

    const consumeLine = (line: string) => {
      const normalized = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (!normalized) return;

      let message: unknown;
      try {
        message = JSON.parse(normalized);
      } catch {
        malformedOutput = true;
        failureKind = "protocol";
        reportedError = "Claude Code devolvió una línea JSON inválida.";
        emit("error", { sessionId, message: reportedError });
        return;
      }
      if (!isRecord(message) || typeof message.type !== "string") {
        malformedOutput = true;
        failureKind = "protocol";
        reportedError = "Claude Code devolvió un evento sin tipo.";
        emit("error", { sessionId, message: reportedError });
        return;
      }

      if (typeof message.session_id === "string") sessionId = message.session_id;
      const eventSessionId = sessionId;
      if (message.type === "system" && message.subtype === "init") {
        emit("step", { sessionId: eventSessionId, message: "Sesión Claude Code iniciada." });
        return;
      }
      if (message.type === "stream_event" && isRecord(message.event)) {
        const event = message.event;
        const delta = isRecord(event.delta) ? event.delta : undefined;
        if (event.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
          emittedText = true;
          emit("text", { sessionId: eventSessionId, text: delta.text });
        }
        if (event.type === "content_block_start" && isRecord(event.content_block) && event.content_block.type === "tool_use") {
          emit("tool", {
            sessionId: eventSessionId,
            message: typeof event.content_block.name === "string" ? event.content_block.name : "Claude Code ejecutó una herramienta.",
          });
        }
        return;
      }
      if (message.type === "system" && message.subtype === "api_retry") {
        retryCount += 1;
        const category = typeof message.error === "string" ? message.error : "";
        if (isAuthOrQuotaFailure(category)) {
          authOrQuotaFailure = true;
          failureKind = classifyClaudeFailure(category);
        }
        emit("diagnostic", {
          sessionId: eventSessionId,
          message: isAuthOrQuotaFailure(category) ? "Claude Code informó un problema de autenticación o cuota." : "Claude Code reintentará una solicitud.",
        });
        return;
      }
      if (message.type === "system" && message.subtype === "permission_denied") {
        approvalRequired = true;
        failureKind = "approval";
        emit("approval_required", {
          sessionId: eventSessionId,
          message: "Claude Code requiere una aprobación interactiva; continuá la sesión en su terminal.",
        });
        return;
      }
      if (message.type === "result") {
        usageMetrics = parseClaudeTokenUsage(message.usage);
        if (message.is_error === true) {
          reportedError = typeof message.result === "string" ? message.result : "Claude Code informó un error.";
          if (isAuthOrQuotaFailure(reportedError)) {
            authOrQuotaFailure = true;
            failureKind = classifyClaudeFailure(reportedError);
          } else {
            failureKind = "tool";
          }
          emit("error", { sessionId: eventSessionId, message: safeClaudeError(reportedError) });
          return;
        }
        if (!emittedText && typeof message.result === "string") {
          emit("text", { sessionId: eventSessionId, text: message.result });
        }
      }
    };

    const consumeStdout = async () => {
      let buffer = "";
      for await (const chunk of process.stdout) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
      if (buffer.trim()) consumeLine(buffer);
    };
    const consumeStderr = async () => {
      let stderr = "";
      for await (const chunk of process.stderr) stderr = (stderr + chunk).slice(-8192);
      if (isAuthOrQuotaFailure(stderr)) authOrQuotaFailure = true;
    };

    const result = (async (): Promise<RuntimeExecutionResult> => {
      const consume = Promise.all([consumeStdout(), consumeStderr()]).catch(() => {
        malformedOutput = true;
        reportedError = "Se interrumpió la lectura de la salida de Claude Code.";
      });
      const completion = await process.completion;
      await consume;
      const status: RuntimeExecutionResult["status"] = cancelled
        ? "cancelled"
        : completion.error || completion.exitCode !== 0 || malformedOutput || reportedError
          ? "failed"
          : "succeeded";
      const error = completion.error
        ? "No se pudo iniciar Claude Code."
        : reportedError ?? (completion.exitCode !== 0 && !cancelled ? `Claude Code terminó con código ${completion.exitCode}.` : undefined);
      if (completion.error || (completion.exitCode !== 0 && !failureKind)) failureKind = "process";
      if (malformedOutput) failureKind = "protocol";
      if (approvalRequired) failureKind = "approval";
      if (status === "failed" && authOrQuotaFailure) {
        this.unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
        this.unavailableMessage = "Claude Code informó un problema temporal de autenticación o cuota.";
      }
      const final: RuntimeExecutionResult = {
        executionId,
        status,
        exitCode: completion.exitCode,
        ...(sessionId ? { sessionId } : {}),
        ...(error ? { error: safeClaudeError(error) } : {}),
        ...(usageMetrics ? { usage: usageMetrics } : {}),
        retries: retryCount,
        ...(status === "failed" && failureKind ? { failureKind } : {}),
        ...(status === "failed" && authOrQuotaFailure ? { runtimeUnavailable: true } : {}),
      };
      emit(cancelled ? "cancelled" : "completed", {
        ...(sessionId ? { sessionId } : {}),
        message: final.error ?? (cancelled ? "Ejecución cancelada." : "Ejecución finalizada."),
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

  private inventory(availability: RuntimeAvailability, message: string, installed: boolean): RuntimeInventory {
    const runtime: RuntimeDescriptor = {
      id: RUNTIME_ID,
      name: "Claude Code",
      availability,
      installed,
      message,
    };
    const provider: ProviderDescriptor = {
      id: PROVIDER_ID,
      name: "Claude Pro",
      runtimeId: RUNTIME_ID,
      availability,
      ...(message ? { message } : {}),
    };
    return {
      runtime,
      providers: [provider],
      models: [{ ...CLAUDE_DEFAULT_MODEL, availability }],
      discoveredAt: new Date().toISOString(),
    };
  }
}

export function isClaudeSubscriptionAuth(method: string): boolean {
  return method === "claude.ai" || method === "oauth_token";
}

export function isAuthOrQuotaFailure(message: string): boolean {
  return /unauthori[sz]ed|authentication|login|subscription|rate.?limit|quota|usage limit|billing|oauth|account_on_hold/i.test(message);
}

function classifyClaudeFailure(message: string): RuntimeFailureKind {
  if (/rate.?limit|quota|usage limit|billing|account_on_hold/i.test(message)) return "quota";
  if (/unauthori[sz]ed|authentication|login|subscription|oauth/i.test(message)) return "authentication";
  return "tool";
}

export function safeClaudeError(message: string): string {
  if (isAuthOrQuotaFailure(message)) {
    return "Claude Code necesita autenticación o alcanzó un límite de uso. Revisá la cuenta en la CLI oficial.";
  }
  return message
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[credencial redactada]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [credencial redactada]")
    .replace(/((?:access|refresh)[_-]?token\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[credencial redactada]")
    .slice(0, 1000);
}

export function buildClaudeInteractiveArgs(prompt: string, sessionId?: string): string[] {
  return sessionId
    ? ["--resume", sessionId, "--permission-mode", "default"]
    : ["--permission-mode", "default", prompt];
}

export function buildClaudePrintArgs(prompt: string, options: RuntimeExecutionOptions = {}): string[] {
  const images = options.imagePaths ?? [];
  // Print mode reads attached images with its Read tool, so their directory must be an allowed working directory.
  const imageDirectories = [...new Set(images.map((path) => dirname(path)))];
  const promptWithImages = images.length
    ? `${prompt}\n\nImágenes adjuntas (abrilas con la herramienta Read):\n${images.map((path) => `- ${path}`).join("\n")}`
    : prompt;
  return [
    "-p",
    ...(options.sessionId ? ["--resume", options.sessionId] : []),
    ...(imageDirectories.length ? ["--add-dir", ...imageDirectories] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "default",
    promptWithImages,
  ];
}

export function launchClaudeCodeInteractive(prompt: string, sessionId?: string): void {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const executable = vscodeApi.workspace.getConfiguration("cheprompt").get<string>("claudeCodePath", "claude");
  const cwd = vscodeApi.workspace.workspaceFolders?.[0]?.uri;
  const env = Object.fromEntries(ENVIRONMENT_OVERRIDES_TO_REMOVE.map((key) => [key, null]));
  const terminal = vscodeApi.window.createTerminal({
    name: "ChePrompt · Claude Code interactivo",
    cwd,
    shellPath: executable,
    shellArgs: buildClaudeInteractiveArgs(prompt, sessionId),
    env,
    iconPath: new vscodeApi.ThemeIcon("sparkle"),
  });
  terminal.show();
}

export function launchClaudeCodeLogin(): void {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const executable = vscodeApi.workspace.getConfiguration("cheprompt").get<string>("claudeCodePath", "claude");
  const terminal = vscodeApi.window.createTerminal({
    name: "Claude Code · iniciar sesión",
    shellPath: executable,
    shellArgs: ["auth", "login"],
    env: Object.fromEntries(ENVIRONMENT_OVERRIDES_TO_REMOVE.map((key) => [key, null])),
    iconPath: new vscodeApi.ThemeIcon("account"),
  });
  terminal.show();
}

function isMissingExecutable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseClaudeTokenUsage(value: unknown): ExecutionUsageMetrics | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = typeof value.input_tokens === "number" && Number.isSafeInteger(value.input_tokens) && value.input_tokens >= 0
    ? value.input_tokens
    : undefined;
  const outputTokens = typeof value.output_tokens === "number" && Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0
    ? value.output_tokens
    : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    source: "Claude Code stream-json result",
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}
