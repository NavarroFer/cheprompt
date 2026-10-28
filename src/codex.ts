import { randomUUID } from "node:crypto";
import {
  NodeProcessExecutor,
  NodeStreamingProcessSpawner,
  ProcessExecutor,
  StreamingProcessSpawner,
} from "./opencode";
import {
  ExecutionUsageMetrics,
  ProviderDescriptor,
  RoutingDecision,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeExecutionEvent,
  RuntimeExecutionResult,
  RuntimeInventory,
  RuntimeModel,
  RuntimeDescriptor,
  UsageSnapshot,
} from "./types";

export const CODEX_CHATGPT_EXPIRES_AT = "2026-11-22T00:00:00.000Z";
export const CODEX_UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1000;
export const CODEX_USAGE_SOURCE = "OpenAI Codex CLI /usage: token activity only; no exact remaining percentage";
export const CODEX_DEFAULT_MODEL_ID = "codex-default";

const CODEX_RUNTIME_ID = "codex";
const CODEX_PROVIDER_ID = "chatgpt-codex";
const OPENAI_API_PROVIDER_ID = "openai-api";
const ENVIRONMENT_OVERRIDES_TO_REMOVE = ["OPENAI_API_KEY", "CODEX_API_KEY"] as const;

export interface CodexExecutionHandle {
  executionId: string;
  result: Promise<RuntimeExecutionResult>;
  cancel(): void;
}

type CodexAuthentication = "chatgpt" | "api-key" | "unauthenticated" | "unknown";
type CodexFailure = "authentication" | "quota" | "approval" | "other";

const CODEX_MODEL: RuntimeModel = {
  id: CODEX_DEFAULT_MODEL_ID,
  label: "Codex configured default",
  usageImpact: "medium",
  strengths: ["modelo predeterminado configurado en Codex"],
  runtimeId: CODEX_RUNTIME_ID,
  providerId: CODEX_PROVIDER_ID,
  allowancePoolId: CODEX_PROVIDER_ID,
  availability: "available",
  capabilities: ["text", "tools", "reasoning"],
  capabilitiesKnown: false,
};

const CODEX_RUNTIME: RuntimeDescriptor = {
  id: CODEX_RUNTIME_ID,
  name: "Codex CLI",
  availability: "available",
};

const CODEX_PROVIDER: ProviderDescriptor = {
  id: CODEX_PROVIDER_ID,
  name: "ChatGPT/Codex",
  runtimeId: CODEX_RUNTIME_ID,
  availability: "available",
};

/**
 * Uses only the official Codex CLI. Credentials stay in Codex's own auth store;
 * inventory checks call `codex login status` and never inspect credential files.
 * API-key environment overrides are removed so discovery and execution use the
 * same stored authentication method. See https://developers.openai.com/codex/auth
 * and https://developers.openai.com/codex/non-interactive-mode.
 */
export class CodexAdapter implements RuntimeAdapter {
  private unavailableUntil = 0;
  private lastAuthentication: CodexAuthentication = "unknown";

  constructor(
    private readonly executable = "codex",
    private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
    private readonly processSpawner: StreamingProcessSpawner = new NodeStreamingProcessSpawner(),
  ) {}

  async getInventory(subscriptionExpiresAt = CODEX_CHATGPT_EXPIRES_AT): Promise<RuntimeInventory> {
    try {
      const environment = codexSubscriptionEnvironment();
      const version = await this.processExecutor.run(this.executable, ["--version"], { env: environment });
      if (version.exitCode !== 0) {
        throw new Error("Codex no pudo iniciar correctamente.");
      }

      const login = await this.processExecutor.run(this.executable, ["login", "status"], { env: environment });
      // Codex CLI 0.165.0 writes the successful status line to stderr.
      const authentication = parseCodexAuthentication(`${login.stdout}\n${login.stderr}`, login.exitCode);
      this.lastAuthentication = authentication;
      const now = Date.now();
      const subscriptionExpiry = authentication === "chatgpt" ? subscriptionExpiresAt : undefined;
      const parsedExpiry = subscriptionExpiry ? Date.parse(subscriptionExpiry) : undefined;
      const expired = authentication === "chatgpt"
        && (parsedExpiry === undefined || !Number.isFinite(parsedExpiry) || parsedExpiry <= now);
      const coolingDown = this.unavailableUntil > now;
      const availability: RuntimeAvailability = expired
        ? "expired"
        : authentication !== "chatgpt" && authentication !== "api-key" || coolingDown
          ? "unavailable"
          : "available";
      const model: RuntimeModel = {
        ...CODEX_MODEL,
        providerId: authentication === "api-key" ? OPENAI_API_PROVIDER_ID : CODEX_PROVIDER_ID,
        allowancePoolId: authentication === "api-key" ? OPENAI_API_PROVIDER_ID : CODEX_PROVIDER_ID,
        availability,
        ...(subscriptionExpiry ? { expiresAt: subscriptionExpiry } : {}),
      };
      const runtimeMessage = coolingDown
        ? "Codex quedó temporalmente no disponible por autenticación o cuota."
        : expired
          ? "La suscripción ChatGPT indicada venció; actualizá la fecha si se renovó."
          : authentication === "api-key"
            ? "Codex usa una API key; el uso se factura por separado de la suscripción ChatGPT."
            : authentication === "chatgpt"
              ? `Autenticado con ChatGPT; elegible hasta ${subscriptionExpiresAt}.`
              : authentication === "unauthenticated"
                ? "Codex no está autenticado. Iniciá sesión con ChatGPT para habilitarlo."
                : "No se pudo validar una autenticación ChatGPT/Codex compatible.";

      return {
        runtime: {
          ...CODEX_RUNTIME,
          availability,
          installed: true,
          message: runtimeMessage,
          ...(subscriptionExpiry ? { expiresAt: subscriptionExpiry } : {}),
        },
        providers: [{
          ...CODEX_PROVIDER,
          ...(authentication === "api-key"
            ? { id: OPENAI_API_PROVIDER_ID, name: "OpenAI API" }
            : {}),
          availability,
          ...(subscriptionExpiry ? { expiresAt: subscriptionExpiry } : {}),
        }],
        models: [model],
        discoveredAt: new Date(now).toISOString(),
      };
    } catch (error) {
      if (isMissingExecutable(error)) {
        const message = "No se encontró Codex CLI. Instalá el CLI oficial de OpenAI o configurá su ruta.";
        return {
          runtime: { ...CODEX_RUNTIME, availability: "unavailable", installed: false, message },
          providers: [{ ...CODEX_PROVIDER, availability: "unavailable" }],
          models: [{ ...CODEX_MODEL, availability: "unavailable" }],
          discoveredAt: new Date().toISOString(),
        };
      }
      return {
        runtime: {
          ...CODEX_RUNTIME,
          availability: "unavailable",
          installed: true,
          message: "No se pudo consultar el estado de Codex CLI.",
        },
        providers: [{ ...CODEX_PROVIDER, availability: "unavailable" }],
        models: [{ ...CODEX_MODEL, availability: "unavailable" }],
        discoveredAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Codex documents interactive `/usage` token activity, not an exact remaining-percent API.
   * See https://developers.openai.com/codex/developer-commands#view-account-usage-with-usage.
   */
  async getUsageLimits(): Promise<UsageSnapshot> {
    const observedAt = Date.now();
    return {
      runtimeId: CODEX_RUNTIME_ID,
      provider: "OpenAI Codex",
      allowancePoolId: this.lastAuthentication === "api-key" ? OPENAI_API_PROVIDER_ID : CODEX_PROVIDER_ID,
      status: "not-available",
      windows: [],
      source: CODEX_USAGE_SOURCE,
      observedAt,
      freshness: "unknown",
    };
  }

  start(
    prompt: string,
    decision: RoutingDecision,
    cwd: string | undefined,
    onEvent: (event: RuntimeExecutionEvent) => void,
  ): CodexExecutionHandle {
    const executionId = randomUUID();
    const process = this.processSpawner.start(
      this.executable,
      buildCodexExecArgs(prompt, decision),
      cwd,
      codexSubscriptionEnvironment(),
    );
    let sessionId: string | undefined;
    let malformedOutput = false;
    let cancelled = false;
    let reportedError: string | undefined;
    let usageMetrics: ExecutionUsageMetrics | undefined;

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
        malformedOutput = true;
        reportedError = "Codex devolvió una línea JSON inválida.";
        emit("error", { sessionId, message: reportedError });
        return;
      }
      if (!isRecord(value) || typeof value.type !== "string") {
        malformedOutput = true;
        reportedError = "Codex devolvió un evento sin tipo.";
        emit("error", { sessionId, message: reportedError });
        return;
      }

      if (typeof value.thread_id === "string") sessionId = value.thread_id;
      if (value.type === "thread.started") {
        emit("step", { sessionId, message: "Sesión de Codex iniciada." });
        return;
      }
      if (value.type === "turn.started") {
        emit("step", { sessionId, message: "Codex inició una etapa de trabajo." });
        return;
      }
      if (value.type === "item.started" || value.type === "item.updated" || value.type === "item.completed") {
        consumeItemEvent(value, sessionId, emit);
        return;
      }
      if (value.type === "turn.completed") {
        usageMetrics = parseCodexTokenUsage(value.usage);
        emit("step", { sessionId, message: "Codex completó la respuesta." });
        return;
      }
      if (value.type === "turn.failed" || value.type === "error") {
        const failure = classifyCodexFailure(readErrorMessage(value));
        reportedError = codexFailureMessage(failure);
        if (failure === "approval") {
          emit("approval_required", { sessionId, message: reportedError });
        }
        if (failure === "authentication" || failure === "quota") {
          this.unavailableUntil = Date.now() + CODEX_UNAVAILABLE_COOLDOWN_MS;
        }
        emit("error", { sessionId, message: reportedError });
      }
    };

    const result = (async (): Promise<RuntimeExecutionResult> => {
      const consume = Promise.all([
        consumeStdout(),
        drain(process.stderr),
      ]).catch(() => {
        malformedOutput = true;
        reportedError = "Se interrumpió la lectura de la salida de Codex.";
      });
      const completion = await process.completion;
      await consume;

      const status: RuntimeExecutionResult["status"] = cancelled
        ? "cancelled"
        : completion.error || completion.exitCode !== 0 || malformedOutput || reportedError
          ? "failed"
          : "succeeded";
      const error = completion.error
        ? "No se pudo iniciar Codex CLI."
        : reportedError ?? (completion.exitCode !== 0 ? "Codex terminó con un error." : undefined);
      const final: RuntimeExecutionResult = {
        executionId,
        status,
        exitCode: completion.exitCode,
        ...(sessionId ? { sessionId } : {}),
        ...(error ? { error } : {}),
        ...(usageMetrics ? { usage: usageMetrics } : {}),
        ...(status === "failed" && this.unavailableUntil > Date.now() ? { runtimeUnavailable: true } : {}),
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

/** Parse only the public status text; never expose or persist the CLI's output. */
export function parseCodexAuthentication(output: string, exitCode: number): CodexAuthentication {
  if (exitCode !== 0) return "unauthenticated";
  const normalized = output.toLocaleLowerCase("en");
  if (/not\s+(?:logged\s+in|authenticated)|no\s+(?:valid\s+)?credentials/.test(normalized)) {
    return "unauthenticated";
  }
  if (/logged\s+in|authenticated/.test(normalized) && /chatgpt/.test(normalized)) {
    return "chatgpt";
  }
  if (/logged\s+in|authenticated/.test(normalized) && /api\s*key/.test(normalized)) {
    return "api-key";
  }
  return "unknown";
}

export function codexSubscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of ENVIRONMENT_OVERRIDES_TO_REMOVE) delete environment[key];
  return environment;
}

export function buildCodexExecArgs(prompt: string, decision: RoutingDecision): string[] {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "on-request",
  ];
  if (decision.selected.id !== CODEX_DEFAULT_MODEL_ID) {
    args.push("--model", decision.selected.id);
  }
  args.push(prompt);
  return args;
}

function consumeItemEvent(
  event: Record<string, unknown>,
  sessionId: string | undefined,
  emit: (type: RuntimeExecutionEvent["type"], values?: Partial<RuntimeExecutionEvent>) => void,
): void {
  const item = isRecord(event.item) ? event.item : undefined;
  if (!item || typeof item.type !== "string") return;

  if (item.type === "agent_message" && event.type === "item.completed" && typeof item.text === "string") {
    emit("text", { sessionId, text: item.text });
    return;
  }
  if (event.type !== "item.completed") return;

  const toolMessages: Record<string, string> = {
    command_execution: "Codex ejecutó un comando.",
    file_change: "Codex preparó cambios en archivos.",
    mcp_tool_call: "Codex usó una herramienta MCP.",
    web_search: "Codex realizó una búsqueda web.",
  };
  const message = toolMessages[item.type];
  if (message) emit("tool", { sessionId, message });
}

function readErrorMessage(value: Record<string, unknown>): string {
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return "";
}

function classifyCodexFailure(message: string): CodexFailure {
  const normalized = message.toLocaleLowerCase("en");
  if (/approval|required approval|needs approval|permission denied|user confirmation/.test(normalized)) {
    return "approval";
  }
  if (/not logged in|not authenticated|authentication failed|unauthorized|invalid api key|sign in/.test(normalized)) {
    return "authentication";
  }
  if (/usage limit|rate limit|quota|too many requests|limit exceeded|limit reached/.test(normalized)) {
    return "quota";
  }
  return "other";
}

function codexFailureMessage(failure: CodexFailure): string {
  switch (failure) {
    case "authentication":
      return "Codex requiere autenticación. Iniciá sesión con `codex login` y volvé a intentar.";
    case "quota":
      return "Codex informó un límite de uso. Revisá la disponibilidad de tu cuenta antes de volver a intentar.";
    case "approval":
      return "Codex necesita una aprobación interactiva. Revisá la solicitud en la terminal de Codex.";
    default:
      return "Codex informó un error durante la ejecución.";
  }
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const _chunk of stream) {
    // Do not forward stderr: it may contain private paths or diagnostic details.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseCodexTokenUsage(value: unknown): ExecutionUsageMetrics | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = typeof value.input_tokens === "number" && Number.isSafeInteger(value.input_tokens) && value.input_tokens >= 0
    ? value.input_tokens
    : undefined;
  const outputTokens = typeof value.output_tokens === "number" && Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0
    ? value.output_tokens
    : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    source: "Codex CLI JSONL turn.completed",
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function isMissingExecutable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
