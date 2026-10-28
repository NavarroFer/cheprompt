import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  ClaudeCodeAdapter,
  launchClaudeCodeInteractive,
  launchClaudeCodeLogin,
} from "./claude-code";
import { CodexAdapter } from "./codex";
import { canStartExecution, MAX_TASK_EXECUTION_ATTEMPTS, shouldProposeFallback } from "./fallback";
import {
  appendParallelHistory,
  cancelPendingParallelTasks,
  createParallelPlan,
  createParallelRunRecord,
  finishParallelRun,
  loadParallelHistory,
  markParallelWorktreeRemoved,
  PARALLEL_HISTORY_KEY,
  ParallelPlan,
  ParallelRunRecord,
  recoverInterruptedParallelHistory,
  setParallelTaskStatus,
  updateParallelTask,
} from "./parallel";
import {
  appendEvaluationRecord,
  createEvaluationRecord,
  EVALUATION_HISTORY_KEY,
  evaluationCases,
  EvaluationRecord,
  loadEvaluationHistory,
  updateVerificationOutcome,
  VerificationOutcome,
} from "./evaluation";
import {
  launchOpenCodeInteractive,
  OpenCodeAdapter,
  OpenCodeExecutionAdapter,
  RuntimeExecutionHandle,
} from "./opencode";
import { LOW_CONFIDENCE_THRESHOLD, routePrompt } from "./router";
import { GitWorktreeManager } from "./worktree";
import {
  RoutingDecision,
  RoutingProfile,
  RuntimeExecutionEvent,
  RuntimeExecutionResult,
  RuntimeInventory,
  RuntimeModel,
  UsageSnapshot,
} from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChePromptViewProvider(
    context.extensionUri,
    context.globalState,
    context.globalStorageUri.fsPath,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cheprompt.sidebar", provider),
    vscode.commands.registerCommand("cheprompt.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.cheprompt");
    }),
  );
}

export function deactivate(): void {}

class ChePromptViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private initialDiscovery: Promise<void> = Promise.resolve();
  private lastPrompt?: string;
  private lastDecision?: RoutingDecision;
  private inventory?: RuntimeInventory;
  private usageSnapshots: UsageSnapshot[] = [];
  private claudeAdapter?: ClaudeCodeAdapter;
  private claudeInventory?: RuntimeInventory;
  private codexAdapter?: CodexAdapter;
  private codexInventory?: RuntimeInventory;
  private evaluationHistory: EvaluationRecord[];
  private activeExecution?: RuntimeExecutionHandle;
  private activeRuntime: "opencode" | "claude-code" | "codex" = "opencode";
  private lastExecutionRuntime: "opencode" | "claude-code" | "codex" = "opencode";
  private lastExecutionSessionId?: string;
  private executionsForPrompt = 0;
  private fallbackProposed = false;
  private taskSucceeded = false;
  private latestEvaluationRecordId?: string;
  private parallelPlan?: ParallelPlan;
  private parallelHistory: ParallelRunRecord[];
  private parallelRunRecord?: ParallelRunRecord;
  private parallelRunStartedAt?: number;
  private cancelParallelRequested = false;
  private parallelLaunching = false;
  private readonly parallelHandles = new Map<string, RuntimeExecutionHandle>();
  private readonly worktreeManager = new GitWorktreeManager();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly globalStoragePath: string,
  ) {
    this.evaluationHistory = loadEvaluationHistory(
      globalState.get<unknown>(EVALUATION_HISTORY_KEY, []),
    );
    const loadedParallelHistory = loadParallelHistory(globalState.get<unknown>(PARALLEL_HISTORY_KEY, []));
    this.parallelHistory = recoverInterruptedParallelHistory(loadedParallelHistory);
    if (this.parallelHistory.some((record, index) => record !== loadedParallelHistory[index])) {
      void globalState.update(PARALLEL_HISTORY_KEY, this.parallelHistory);
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.getHtml(view.webview);
    this.initialDiscovery = Promise.allSettled([
      this.discoverInventory(view.webview),
      this.discoverClaudeCode(view.webview),
      this.discoverCodex(view.webview),
    ]).then(() => undefined);

    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isWebviewMessage(message)) {
        return;
      }

      if (message.type === "webviewReady") {
        await view.webview.postMessage({
          type: "evaluationState",
          cases: evaluationCases,
          records: this.evaluationHistory,
          parallelHistory: this.parallelHistory,
        });
        return;
      }

      if (message.type === "analyzeParallel") {
        await this.analyzeParallel(view.webview, message);
        return;
      }

      if (message.type === "executeParallel") {
        await this.executeParallel(view.webview, message);
        return;
      }

      if (message.type === "cancelParallel") {
        this.cancelParallelRequested = true;
        for (const execution of this.parallelHandles.values()) execution.cancel();
        return;
      }

      if (message.type === "openParallelWorktree") {
        await this.openParallelWorktree(view.webview, message);
        return;
      }

      if (message.type === "removeParallelWorktree") {
        await this.removeParallelWorktree(view.webview, message);
        return;
      }

      if (message.type === "verificationOutcome") {
        await this.setVerificationOutcome(view.webview, message);
        return;
      }

      if (message.type === "refreshUsage") {
        await this.discoverUsage(view.webview);
        return;
      }

      if (message.type === "cancelExecution") {
        this.activeExecution?.cancel();
        return;
      }

      if (message.type === "interactiveFallback") {
        await this.openInteractiveFallback(view.webview);
        return;
      }

      if (message.type === "claudeInteractive") {
        await this.openClaudeInteractive(view.webview);
        return;
      }

      if (message.type === "refreshClaude") {
        await this.discoverClaudeCode(view.webview);
        return;
      }

      if (message.type === "claudeLogin") {
        try {
          launchClaudeCodeLogin();
          await view.webview.postMessage({ type: "claudeLoginOpened" });
        } catch (error) {
          await view.webview.postMessage({
            type: "executionError",
            runtimeId: "claude-code",
            message: error instanceof Error ? error.message : "No se pudo abrir el login de Claude Code.",
          });
        }
        return;
      }

      if (message.type === "refreshCodex") {
        await this.discoverCodex(view.webview);
        return;
      }

      if (message.type === "codexLogin") {
        this.openCodexLogin(view.webview);
        return;
      }

      if (message.type === "codexInteractive") {
        await this.openCodexInteractive(view.webview);
        return;
      }

      if (message.type === "analyze") {
        try {
          if (this.activeExecution || this.parallelHandles.size > 0 || this.parallelLaunching) {
            throw new Error("Cancelá las ejecuciones actuales antes de analizar otra tarea.");
          }
          await this.initialDiscovery;
          this.lastPrompt = undefined;
          this.lastDecision = undefined;
          this.lastExecutionSessionId = undefined;
          this.lastExecutionRuntime = "opencode";
          this.activeRuntime = "opencode";
          this.executionsForPrompt = 0;
          this.fallbackProposed = false;
          this.taskSucceeded = false;
          this.latestEvaluationRecordId = undefined;
          if (!this.inventory) {
            throw new Error("El inventario de modelos todavía no está disponible. Revisá OpenCode e intentá de nuevo.");
          }
          const decision = routePrompt(
            message.prompt,
            message.profile,
            this.routingCandidates(),
            Date.now(),
            this.usageSnapshots,
          );
          this.lastPrompt = message.prompt.trim();
          this.lastDecision = decision;
          await view.webview.postMessage({ type: "decision", decision });
        } catch (error) {
          await view.webview.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : "No pudimos analizar la tarea.",
          });
        }
        return;
      }

      if (message.type === "overrideCandidate") {
        await this.applyCandidateOverride(view.webview, message);
        return;
      }

      if (message.type === "execute") {
        if (!this.lastPrompt || !this.lastDecision) {
          await view.webview.postMessage({
            type: "error",
            message: "Analizá la tarea antes de ejecutarla.",
          });
          return;
        }

        const reviewedDecision = decisionReviewSignature(this.lastDecision);
        await this.refreshDecisionForCurrentPrompt(view.webview);
        if (!this.lastDecision) return;
        if (reviewedDecision !== decisionReviewSignature(this.lastDecision)) {
          await view.webview.postMessage({ type: "routeNeedsReview" });
          return;
        }

        const selectedRuntime = this.lastDecision.selected.runtimeId;
        if (!isRuntimeId(selectedRuntime)) {
          await view.webview.postMessage({ type: "executionError", message: "El runtime seleccionado no es compatible." });
          return;
        }
        this.startExecution(view.webview, selectedRuntime);
        return;
      }

      if (message.type === "selectClaude") {
        await this.applyRuntimeOverride(view.webview, "claude-code");
        return;
      }

      if (message.type === "selectCodex") {
        await this.applyRuntimeOverride(view.webview, "codex");
      }
    });
  }

  private async discoverInventory(webview: vscode.Webview): Promise<void> {
    const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode");
    const adapter = new OpenCodeAdapter(executable);
    try {
      const inventory = await adapter.getInventory();
      this.inventory = inventory;
      await webview.postMessage({ type: "inventory", inventory });
    } catch (error) {
      this.inventory = undefined;
      await webview.postMessage({
        type: "inventoryError",
        message: error instanceof Error ? error.message : "No pudimos consultar el inventario de OpenCode.",
      });
    } finally {
      await this.discoverUsage(webview, adapter);
    }
  }

  private async discoverUsage(webview: vscode.Webview, adapter?: OpenCodeAdapter): Promise<void> {
    const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode");
    const usageAdapter = adapter ?? new OpenCodeAdapter(executable);
    const snapshot = await usageAdapter.getUsageLimits();
    this.rememberUsage(snapshot);
    await webview.postMessage({ type: "usage", snapshot });
    await this.refreshDecisionForCurrentPrompt(webview);
  }

  private async discoverClaudeCode(webview: vscode.Webview): Promise<void> {
    const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("claudeCodePath", "claude");
    const adapter = this.claudeAdapter ?? new ClaudeCodeAdapter(executable);
    this.claudeAdapter = adapter;
    const inventory = await adapter.getInventory();
    this.claudeInventory = inventory;
    await webview.postMessage({ type: "claudeRuntime", inventory });
    await this.refreshDecisionForCurrentPrompt(webview);
    const usage = await adapter.getUsageLimits?.();
    if (usage) {
      this.rememberUsage(usage);
      await webview.postMessage({ type: "claudeUsage", snapshot: usage });
      await this.refreshDecisionForCurrentPrompt(webview);
    }
  }

  private async discoverCodex(webview: vscode.Webview): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("cheprompt");
    const executable = configuration.get<string>("codexPath", "codex");
    const subscriptionExpiry = configuration.get<string>(
      "codex.chatgptSubscriptionExpiresAt",
      "2026-11-22T00:00:00.000Z",
    );
    const adapter = this.codexAdapter ?? new CodexAdapter(executable);
    this.codexAdapter = adapter;
    const inventory = await adapter.getInventory(subscriptionExpiry);
    this.codexInventory = inventory;
    await webview.postMessage({ type: "codexRuntime", inventory });
    await this.refreshDecisionForCurrentPrompt(webview);
    const usage = await adapter.getUsageLimits();
    this.rememberUsage(usage);
    await webview.postMessage({ type: "codexUsage", snapshot: usage });
    await this.refreshDecisionForCurrentPrompt(webview);
  }

  private rememberUsage(snapshot: UsageSnapshot): void {
    this.usageSnapshots = [
      ...this.usageSnapshots.filter((item) => item.allowancePoolId !== snapshot.allowancePoolId),
      snapshot,
    ];
  }

  private async setVerificationOutcome(
    webview: vscode.Webview,
    message: VerificationOutcomeMessage,
  ): Promise<void> {
    if (!this.evaluationHistory.some((record) => record.id === message.recordId)) {
      await webview.postMessage({ type: "error", message: "No encontramos ese registro local de evaluación." });
      return;
    }
    this.evaluationHistory = updateVerificationOutcome(
      this.evaluationHistory,
      message.recordId,
      message.outcome,
    );
    try {
      await this.globalState.update(EVALUATION_HISTORY_KEY, this.evaluationHistory);
    } catch {
      await webview.postMessage({
        type: "error",
        message: "No se pudo guardar la verificación en el historial local.",
      });
    }
    await webview.postMessage({
      type: "evaluationHistory",
      records: this.evaluationHistory,
      updatedRecordId: message.recordId,
      verificationOutcome: message.outcome,
    });

    if (message.outcome === "failed" && message.recordId === this.latestEvaluationRecordId && this.lastDecision) {
      const failedDecision = { ...this.lastDecision };
      delete failedDecision.routingNotice;
      this.lastDecision = failedDecision;
      this.taskSucceeded = false;
      const verificationFailure: RuntimeExecutionResult = {
        executionId: message.recordId,
        status: "failed",
        exitCode: 1,
        failureKind: "verification",
      };
      if (shouldProposeFallback(verificationFailure, this.executionsForPrompt, this.fallbackProposed)) {
        await this.proposeFallback(webview, failedDecision, failedDecision.selected.runtimeId, "verification");
      } else if (this.executionsForPrompt >= MAX_TASK_EXECUTION_ATTEMPTS) {
        await this.markFallbackBudgetExhausted(webview);
      }
    }
  }

  private async saveEvaluationRecord(
    decision: RoutingDecision,
    result: RuntimeExecutionResult,
    startedAt: number,
    prompt: string,
    chepromptRetries = 0,
  ): Promise<EvaluationRecord> {
    const record = createEvaluationRecord(prompt, decision, result, startedAt, chepromptRetries);
    this.evaluationHistory = appendEvaluationRecord(this.evaluationHistory, record);
    this.latestEvaluationRecordId = record.id;
    try {
      await this.globalState.update(EVALUATION_HISTORY_KEY, this.evaluationHistory);
    } catch {
      // Keep this session's record visible even if VS Code's local state store fails.
    }
    return record;
  }

  private async proposeFallback(
    webview: vscode.Webview,
    failedDecision: RoutingDecision,
    failedRuntime: string,
    failureKind: NonNullable<RuntimeExecutionResult["failureKind"]>,
  ): Promise<void> {
    if (!this.lastPrompt || this.fallbackProposed || this.executionsForPrompt >= MAX_TASK_EXECUTION_ATTEMPTS) return;
    this.fallbackProposed = true;

    const remaining = this.routingCandidates().filter((candidate) => !sameCandidate(candidate, failedDecision.selected));
    const crossRuntime = remaining.filter((candidate) => candidate.runtimeId !== failedRuntime);
    const preferred = crossRuntime.length ? crossRuntime : remaining;
    const attempt = this.executionsForPrompt + 1;
    const unavailableDecision = (message: string): RoutingDecision => ({
      ...failedDecision,
      routingNotice: {
        kind: "fallback-unavailable",
        message: `${message} Presupuesto: ${this.executionsForPrompt}/${MAX_TASK_EXECUTION_ATTEMPTS} intentos usados.`,
        attempt,
        maxAttempts: MAX_TASK_EXECUTION_ATTEMPTS,
      },
    });

    if (!preferred.length) {
      this.lastDecision = unavailableDecision("No hay un candidato alternativo elegible para el fallback.");
      await webview.postMessage({ type: "decision", decision: this.lastDecision });
      return;
    }

    try {
      const fallback = routePrompt(
        this.lastPrompt,
        failedDecision.profile,
        preferred,
        Date.now(),
        this.usageSnapshots,
      );
      const allowance = fallback.remainingPercent === undefined
        ? "El cupo exacto de este pool no está disponible."
        : `${fallback.remainingPercent}% del cupo reportado está disponible.`;
      const confidence = fallback.confidence < LOW_CONFIDENCE_THRESHOLD
        ? " La confianza sigue baja; revisá las alternativas."
        : "";
      this.lastDecision = {
        ...fallback,
        routingNotice: {
          kind: "fallback",
          attempt,
          maxAttempts: MAX_TASK_EXECUTION_ATTEMPTS,
          fromRuntimeId: failedRuntime,
          message: `${failedDecision.selected.label} falló por ${failureKindLabel(failureKind)}. Se propone ${fallback.selected.label} (${fallback.selected.runtimeId}/${fallback.selected.providerId}) como intento ${attempt}/${MAX_TASK_EXECUTION_ATTEMPTS}. ${allowance}${confidence} Revisá la ruta y aprobá antes de ejecutar.`,
        },
      };
      await webview.postMessage({ type: "decision", decision: this.lastDecision });
    } catch {
      this.lastDecision = unavailableDecision("No queda una alternativa elegible por disponibilidad o cupo oficial.");
      await webview.postMessage({ type: "decision", decision: this.lastDecision });
    }
  }

  private async markFallbackBudgetExhausted(webview: vscode.Webview): Promise<void> {
    if (!this.lastDecision) return;
    this.lastDecision = {
      ...this.lastDecision,
      routingNotice: {
        kind: "budget-exhausted",
        attempt: this.executionsForPrompt,
        maxAttempts: MAX_TASK_EXECUTION_ATTEMPTS,
        message: `Presupuesto agotado: máximo ${MAX_TASK_EXECUTION_ATTEMPTS} ejecuciones para esta tarea. Analizá una nueva tarea para reiniciar el ciclo.`,
      },
    };
    await webview.postMessage({ type: "decision", decision: this.lastDecision });
  }

  private async refreshDecisionForCurrentPrompt(webview: vscode.Webview): Promise<void> {
    if (
      !this.lastPrompt
      || !this.lastDecision
      || this.activeExecution
      || this.taskSucceeded
      || this.executionsForPrompt >= MAX_TASK_EXECUTION_ATTEMPTS
    ) return;

    const previous = this.lastDecision;
    const asOf = Date.now();
    try {
      const automatic = routePrompt(
        this.lastPrompt,
        previous.profile,
        this.routingCandidates(),
        asOf,
        this.usageSnapshots,
      );

      if (!previous.manualOverride && previous.routingNotice?.kind !== "fallback") {
        this.lastDecision = automatic;
      } else {
        try {
          const manual = routePrompt(
            this.lastPrompt,
            previous.profile,
            [previous.selected],
            asOf,
            this.usageSnapshots,
          );
          const alternatives = [automatic.selected, ...automatic.alternatives]
            .filter((model) => !sameCandidate(model, previous.selected))
            .slice(0, 2);
          const automaticRanked = [
            { model: automatic.selected, score: automatic.selectedScore },
            ...automatic.alternatives.map((model, index) => ({
              model,
              score: automatic.alternativeScores[index],
            })),
          ];
          this.lastDecision = {
            ...manual,
            alternatives,
            alternativeScores: alternatives.map((model) =>
              automaticRanked.find((candidate) => sameCandidate(candidate.model, model))!.score,
            ),
            ...(previous.manualOverride ? { manualOverride: true } : {}),
            ...(previous.routingNotice ? { routingNotice: previous.routingNotice } : {}),
            reason: previous.manualOverride
              ? `Override manual elegido por vos. ${manual.reason}`
              : previous.reason,
          };
        } catch {
          this.lastDecision = {
            ...automatic,
            reason: `El override dejó de estar disponible; se recalculó la ruta. ${automatic.reason}`,
            ...(previous.routingNotice?.kind === "fallback" ? {
              routingNotice: {
                kind: "fallback-unavailable",
                message: "La ruta de fallback dejó de estar disponible por cupo o estado del runtime.",
                attempt: previous.routingNotice.attempt,
                maxAttempts: previous.routingNotice.maxAttempts,
              },
            } : {}),
          };
        }
      }

      await webview.postMessage({ type: "decision", decision: this.lastDecision });
    } catch (error) {
      this.lastDecision = undefined;
      await webview.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "No quedan candidatos disponibles para esta tarea.",
      });
    }
  }

  private routingCandidates(): RuntimeModel[] {
    const candidates: RuntimeModel[] = [];
    if (this.inventory?.runtime.availability === "available") {
      candidates.push(...this.inventory.models.filter((model) => model.providerId === "opencode-go"));
    }
    if (this.claudeInventory?.runtime.availability === "available") {
      candidates.push(...this.claudeInventory.models);
    }
    if (this.codexInventory?.runtime.availability === "available") {
      candidates.push(...this.codexInventory.models);
    }
    return candidates;
  }

  private async applyCandidateOverride(
    webview: vscode.Webview,
    choice: OverrideCandidateMessage,
  ): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution || this.taskSucceeded) {
      await webview.postMessage({ type: "error", message: "Analizá la tarea y detené cualquier ejecución antes del override." });
      return;
    }

    const candidate = this.routingCandidates().find((model) =>
      model.runtimeId === choice.runtimeId
        && model.providerId === choice.providerId
        && model.id === choice.id
        && model.allowancePoolId === choice.allowancePoolId,
    );
    if (!candidate) {
      await webview.postMessage({ type: "error", message: "El candidato de override ya no está en las alternativas vigentes." });
      return;
    }

    await this.setManualCandidate(webview, candidate);
  }

  private async applyRuntimeOverride(
    webview: vscode.Webview,
    runtimeId: "claude-code" | "codex",
  ): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution || this.taskSucceeded) {
      await webview.postMessage({ type: "error", message: "Analizá la tarea y detené cualquier ejecución antes del override." });
      return;
    }
    const candidate = this.routingCandidates().find((model) => model.runtimeId === runtimeId);
    if (!candidate) {
      await webview.postMessage({
        type: "error",
        message: runtimeId === "claude-code" ? "Claude Code no está disponible para este override." : "Codex no está disponible para este override.",
      });
      return;
    }
    await this.setManualCandidate(webview, candidate);
  }

  private async setManualCandidate(webview: vscode.Webview, candidate: RuntimeModel): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision) return;
    const profile = this.lastDecision.profile;
    const asOf = Date.now();
    try {
      const manual = routePrompt(
        this.lastPrompt,
        profile,
        [candidate],
        asOf,
        this.usageSnapshots,
      );
      const automatic = routePrompt(
        this.lastPrompt,
        profile,
        this.routingCandidates(),
        asOf,
        this.usageSnapshots,
      );
      const automaticRanked = [
        { model: automatic.selected, score: automatic.selectedScore },
        ...automatic.alternatives.map((model, index) => ({
          model,
          score: automatic.alternativeScores[index],
        })),
      ];
      const alternatives = automaticRanked
        .filter((entry) => !sameCandidate(entry.model, candidate))
        .slice(0, 2);
      this.lastDecision = {
        ...manual,
        alternatives: alternatives.map((entry) => entry.model),
        alternativeScores: alternatives.map((entry) => entry.score),
        manualOverride: true,
        ...(this.lastDecision.routingNotice?.kind === "fallback"
          ? { routingNotice: this.lastDecision.routingNotice }
          : {}),
        reason: `Override manual elegido por vos. ${manual.reason}`,
      };
      await webview.postMessage({ type: "decision", decision: this.lastDecision });
    } catch (error) {
      await webview.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "El candidato dejó de estar disponible.",
      });
    }
  }

  private openCodexLogin(webview: vscode.Webview): void {
    const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("codexPath", "codex");
    try {
      const terminal = vscode.window.createTerminal({
        name: "Codex · iniciar sesión",
        shellPath: executable,
        shellArgs: ["login"],
        env: { OPENAI_API_KEY: null, CODEX_API_KEY: null },
        iconPath: new vscode.ThemeIcon("account"),
      });
      terminal.show();
      void webview.postMessage({ type: "codexLoginOpened" });
    } catch (error) {
      void webview.postMessage({
        type: "executionError",
        runtimeId: "codex",
        message: error instanceof Error ? error.message : "No se pudo abrir el login de Codex.",
      });
    }
  }

  private async analyzeParallel(webview: vscode.Webview, message: AnalyzeParallelMessage): Promise<void> {
    try {
      if (this.activeExecution || this.parallelHandles.size > 0 || this.parallelLaunching) {
        throw new Error("Cancelá las ejecuciones actuales antes de analizar subtareas.");
      }
      if (!message.independenceConfirmed) {
        throw new Error("Confirmá que las dos subtareas son independientes antes de analizarlas.");
      }
      await this.initialDiscovery;
      if (!this.inventory) throw new Error("El inventario de modelos todavía no está disponible.");
      this.parallelPlan = createParallelPlan(
        message.tasks,
        message.profile,
        this.routingCandidates(),
        Date.now(),
        this.usageSnapshots,
      );
      await webview.postMessage({
        type: "parallelPlan",
        runId: this.parallelPlan.id,
        tasks: this.parallelPlan.tasks.map((task, index) => ({
          id: task.id,
          taskNumber: index + 1,
          decision: task.decision,
        })),
      });
    } catch (error) {
      this.parallelPlan = undefined;
      await webview.postMessage({
        type: "parallelError",
        message: error instanceof Error ? error.message : "No se pudieron analizar las subtareas.",
      });
    }
  }

  private async executeParallel(webview: vscode.Webview, message: ExecuteParallelMessage): Promise<void> {
    const plan = this.parallelPlan;
    if (!plan) {
      await webview.postMessage({ type: "parallelError", message: "Analizá y revisá las dos subtareas antes de ejecutarlas." });
      return;
    }
    if (!message.independenceConfirmed) {
      await webview.postMessage({ type: "parallelError", message: "Confirmá que las subtareas no dependen entre sí." });
      return;
    }
    if (message.profile !== plan.profile || message.tasks.length !== plan.tasks.length
      || message.tasks.some((task, index) => task.trim() !== plan.tasks[index].prompt)) {
      this.parallelPlan = undefined;
      await webview.postMessage({
        type: "parallelError",
        message: "Cambiaste una subtarea o el perfil. Volvé a analizar y revisar ambas rutas.",
      });
      return;
    }
    if (this.activeExecution || this.parallelHandles.size > 0 || this.parallelLaunching) {
      await webview.postMessage({ type: "parallelError", message: "Ya hay una ejecución activa." });
      return;
    }

    this.parallelLaunching = true;
    this.cancelParallelRequested = false;
    try {
      const currentCandidates = this.routingCandidates();
      const refreshedTasks = plan.tasks.map((task) => ({
        ...task,
        decision: routePrompt(task.prompt, plan.profile, currentCandidates, Date.now(), this.usageSnapshots),
      }));
      const changed = refreshedTasks.some((task, index) =>
        decisionReviewSignature(task.decision) !== decisionReviewSignature(plan.tasks[index].decision));
      if (changed) {
        this.parallelPlan = { ...plan, tasks: refreshedTasks };
        await webview.postMessage({
          type: "parallelPlan",
          runId: plan.id,
          needsReview: true,
          tasks: refreshedTasks.map((task, index) => ({ id: task.id, taskNumber: index + 1, decision: task.decision })),
        });
        return;
      }

      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const repository = await this.worktreeManager.resolveCleanRepository(workspacePath);
      const startedAt = Date.now();
      this.parallelRunRecord = createParallelRunRecord(
        plan,
        new Date(startedAt).toISOString(),
        repository.root,
        repository.head,
      );
      this.parallelRunStartedAt = startedAt;
      await this.persistParallelRecord(this.parallelRunRecord);
      const worktrees: string[] = [];
      for (const task of plan.tasks) {
        if (this.cancelParallelRequested) throw new Error("Ejecución paralela cancelada antes de iniciar los agentes.");
        const worktreePath = await this.worktreeManager.createWorktree(
          repository.root,
          this.globalStoragePath,
          plan.id,
          task.id,
          repository.head,
        );
        worktrees.push(worktreePath);
        this.parallelRunRecord = setParallelTaskStatus(this.parallelRunRecord!, task.id, "queued", worktreePath);
        await this.persistParallelRecord(this.parallelRunRecord);
      }

      plan.tasks.forEach((task, index) => {
        this.parallelRunRecord = setParallelTaskStatus(
          this.parallelRunRecord!,
          task.id,
          "running",
          worktrees[index],
        );
      });
      if (this.cancelParallelRequested) {
        this.parallelRunRecord = cancelPendingParallelTasks(this.parallelRunRecord!);
        const cancelled = finishParallelRun(this.parallelRunRecord, Date.now() - startedAt);
        this.parallelRunRecord = cancelled;
        await this.persistParallelRecord(cancelled);
        await webview.postMessage({ type: "parallelCompleted", record: cancelled });
        return;
      }
      await this.persistParallelRecord(this.parallelRunRecord);
      await webview.postMessage({ type: "parallelStarted", record: this.parallelRunRecord });

      await Promise.all(plan.tasks.map((task, index) => this.startParallelTask(
        webview,
        task,
        worktrees[index],
      )));

      if (this.parallelRunRecord) {
        const finished = finishParallelRun(this.parallelRunRecord, Date.now() - startedAt);
        this.parallelRunRecord = finished;
        await this.persistParallelRecord(finished);
        await webview.postMessage({ type: "parallelCompleted", record: finished });
      }
      this.parallelPlan = undefined;
    } catch (error) {
      if (this.parallelRunRecord?.status === "running" && this.parallelHandles.size === 0) {
        const unfinished = this.parallelRunRecord.tasks.find((task) =>
          (task.status === "queued" || task.status === "running") && !task.worktreePath,
        ) ?? this.parallelRunRecord.tasks.find((task) => task.status === "queued" || task.status === "running");
        if (unfinished) {
          const interrupted = this.cancelParallelRequested
            ? cancelPendingParallelTasks(this.parallelRunRecord)
            : cancelPendingParallelTasks(updateParallelTask(this.parallelRunRecord, unfinished.id, {
                executionId: randomUUID(),
                status: "failed",
                exitCode: -1,
                error: "No se pudo preparar el worktree.",
                failureKind: "process",
              }, 0));
          const finished = finishParallelRun(interrupted, Date.now() - (this.parallelRunStartedAt ?? Date.now()));
          this.parallelRunRecord = finished;
          await this.persistParallelRecord(finished);
          await webview.postMessage({ type: "parallelCompleted", record: finished });
        }
      }
      if (!this.cancelParallelRequested) {
        await webview.postMessage({
          type: "parallelError",
          message: error instanceof Error ? error.message : "No se pudieron iniciar las subtareas paralelas.",
        });
      }
    } finally {
      this.cancelParallelRequested = false;
      this.parallelLaunching = false;
    }
  }

  private async startParallelTask(
    webview: vscode.Webview,
    task: ParallelPlan["tasks"][number],
    worktreePath: string,
  ): Promise<void> {
    const runtime = task.decision.selected.runtimeId;
    const startedAt = Date.now();
    let execution: RuntimeExecutionHandle | undefined;
    let result: RuntimeExecutionResult;
    try {
      if (!isRuntimeId(runtime)) throw new Error("El runtime seleccionado no es compatible.");
      execution = this.startRuntimeExecution(runtime, task.prompt, task.decision, worktreePath, (event) => {
        void webview.postMessage({
          type: "parallelEvent",
          runId: this.parallelRunRecord?.id,
          taskId: task.id,
          taskNumber: this.parallelRunRecord?.tasks.find((item) => item.id === task.id)?.taskNumber,
          runtimeId: runtime,
          event,
        });
      });
      this.parallelHandles.set(task.id, execution);
      result = await execution.result;
    } catch {
      result = {
        executionId: execution?.executionId ?? randomUUID(),
        status: "failed",
        exitCode: -1,
        error: "No se pudo completar la subtarea.",
        failureKind: "process",
      };
    } finally {
      this.parallelHandles.delete(task.id);
    }

    if (!this.parallelRunRecord) return;
    const updated = updateParallelTask(this.parallelRunRecord, task.id, result!, Date.now() - startedAt, worktreePath);
    this.parallelRunRecord = updated;
    await this.persistParallelRecord(updated);
    await webview.postMessage({
      type: "parallelTaskCompleted",
      runId: updated.id,
      taskId: task.id,
      taskNumber: updated.tasks.find((item) => item.id === task.id)?.taskNumber,
      record: updated.tasks.find((item) => item.id === task.id),
      error: result!.error,
    });
  }

  private startRuntimeExecution(
    runtime: "opencode" | "claude-code" | "codex",
    prompt: string,
    decision: RoutingDecision,
    cwd: string,
    onEvent: (event: RuntimeExecutionEvent) => void,
  ): RuntimeExecutionHandle {
    if (runtime === "opencode") {
      return new OpenCodeExecutionAdapter(
        vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode"),
      ).start(prompt, decision, cwd, onEvent);
    }
    if (runtime === "claude-code") {
      if (this.claudeInventory?.runtime.availability !== "available" || !this.claudeAdapter) {
        throw new Error("Claude Code dejó de estar disponible antes de iniciar la subtarea.");
      }
      return this.claudeAdapter.start(prompt, cwd, onEvent);
    }
    if (this.codexInventory?.runtime.availability !== "available" || !this.codexAdapter) {
      throw new Error("Codex dejó de estar disponible antes de iniciar la subtarea.");
    }
    return this.codexAdapter.start(prompt, decision, cwd, onEvent);
  }

  private async persistParallelRecord(record: ParallelRunRecord): Promise<void> {
    this.parallelHistory = appendParallelHistory(this.parallelHistory, record);
    await this.globalState.update(PARALLEL_HISTORY_KEY, this.parallelHistory);
  }

  private async openParallelWorktree(
    webview: vscode.Webview,
    message: ParallelWorktreeMessage,
  ): Promise<void> {
    const task = this.findParallelTask(message.runId, message.taskId);
    if (!task?.worktreePath || task.worktreeRemoved) {
      await webview.postMessage({ type: "parallelError", message: "Ese worktree ya no está disponible." });
      return;
    }
    try {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(task.worktreePath), { forceNewWindow: true });
    } catch {
      await webview.postMessage({ type: "parallelError", message: "No se pudo abrir el worktree en otra ventana." });
    }
  }

  private async removeParallelWorktree(
    webview: vscode.Webview,
    message: ParallelWorktreeMessage,
  ): Promise<void> {
    const run = this.parallelHistory.find((record) => record.id === message.runId);
    const task = run?.tasks.find((item) => item.id === message.taskId);
    if (this.parallelHandles.has(message.taskId)) {
      await webview.postMessage({ type: "parallelError", message: "Esperá a que termine o cancelá la subtarea antes de quitar su worktree." });
      return;
    }
    if (!run?.repositoryRoot || !task?.worktreePath || task.worktreeRemoved) {
      await webview.postMessage({ type: "parallelError", message: "Ese worktree ya no está disponible." });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Quitar este worktree elimina su carpeta. Revisá o guardá antes; Git bloqueará la acción si contiene cambios sin guardar.",
      { modal: true },
      "Quitar worktree",
    );
    if (choice !== "Quitar worktree") return;
    try {
      await this.worktreeManager.removeWorktree(run.repositoryRoot, this.globalStoragePath, task.worktreePath);
      const updated = markParallelWorktreeRemoved(run, task.id);
      await this.persistParallelRecord(updated);
      await webview.postMessage({ type: "parallelHistory", records: this.parallelHistory });
    } catch (error) {
      await webview.postMessage({
        type: "parallelError",
        message: error instanceof Error ? error.message : "No se pudo quitar el worktree.",
      });
    }
  }

  private findParallelTask(runId: string, taskId: string) {
    return this.parallelHistory.find((record) => record.id === runId)?.tasks.find((task) => task.id === taskId);
  }

  private startExecution(webview: vscode.Webview, runtime: "opencode" | "claude-code" | "codex"): void {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution || this.parallelHandles.size > 0 || this.parallelLaunching) {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: this.activeExecution || this.parallelHandles.size > 0 || this.parallelLaunching
          ? "Ya hay una tarea en ejecución. Cancelala antes de iniciar otra."
          : "Analizá la tarea antes de ejecutarla.",
      });
      return;
    }
    if (!canStartExecution(this.executionsForPrompt, this.taskSucceeded)) {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: this.taskSucceeded
          ? "Esta tarea ya terminó correctamente. Analizá una nueva tarea para iniciar otra ejecución."
          : `Presupuesto agotado: máximo ${MAX_TASK_EXECUTION_ATTEMPTS} ejecuciones por análisis. Analizá una nueva tarea para continuar.`,
      });
      return;
    }

    const prompt = this.lastPrompt;
    const decision = this.lastDecision;
    const startedAt = Date.now();

    if (runtime === "claude-code" && this.claudeInventory?.runtime.availability !== "available") {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: this.claudeInventory?.runtime.message ?? "Claude Code no está autenticado con una cuenta Claude Pro.",
      });
      return;
    }
    if (runtime === "codex" && this.codexInventory?.runtime.availability !== "available") {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: this.codexInventory?.runtime.message ?? "Codex no está autenticado o disponible.",
      });
      return;
    }

    this.executionsForPrompt += 1;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
      const onEvent = (event: RuntimeExecutionEvent) => {
        if (event.sessionId) this.lastExecutionSessionId = event.sessionId;
        void webview.postMessage({ type: "executionEvent", event, runtimeId: runtime });
      };
      const execution = runtime === "opencode"
        ? new OpenCodeExecutionAdapter(
            vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode"),
          ).start(prompt, decision, cwd, onEvent)
        : runtime === "claude-code"
          ? this.claudeAdapter!.start(prompt, cwd, onEvent)
          : this.codexAdapter!.start(
              prompt,
              decision.selected.runtimeId === "codex"
                ? decision
                : { ...decision, selected: this.codexInventory!.models[0] },
              cwd,
              onEvent,
            );
      this.activeExecution = execution;
      this.activeRuntime = runtime;
      this.lastExecutionRuntime = runtime;
      void execution.result.then(async (result) => {
        if (result.sessionId) this.lastExecutionSessionId = result.sessionId;
        if (this.activeExecution === execution) this.activeExecution = undefined;
        const evaluationRecord = await this.saveEvaluationRecord(
          decision,
          result,
          startedAt,
          prompt,
          Math.max(0, this.executionsForPrompt - 1),
        );
        this.taskSucceeded = result.status === "succeeded";
        if (this.taskSucceeded) {
          this.lastDecision = {
            ...decision,
            routingNotice: {
              kind: "task-completed",
              attempt: this.executionsForPrompt,
              maxAttempts: MAX_TASK_EXECUTION_ATTEMPTS,
              message: "La ejecución terminó correctamente. Analizá una nueva tarea para iniciar otro ciclo.",
            },
          };
        }
        await webview.postMessage({
          type: "executionResult",
          result,
          runtimeId: runtime,
          evaluationRecordId: evaluationRecord.id,
          canExecuteAgain: !this.taskSucceeded && this.executionsForPrompt < MAX_TASK_EXECUTION_ATTEMPTS,
        });
        if (this.taskSucceeded && this.lastDecision) {
          await webview.postMessage({ type: "decision", decision: this.lastDecision });
        }
        if (runtime === "claude-code" && result.runtimeUnavailable && this.claudeAdapter) {
          this.claudeInventory = await this.claudeAdapter.getInventory();
          await webview.postMessage({ type: "claudeRuntime", inventory: this.claudeInventory });
        }
        if (runtime === "codex" && result.runtimeUnavailable && this.codexAdapter) {
          const expiry = vscode.workspace.getConfiguration("cheprompt")
            .get<string>("codex.chatgptSubscriptionExpiresAt", "2026-11-22T00:00:00.000Z");
          this.codexInventory = await this.codexAdapter.getInventory(expiry);
          await webview.postMessage({ type: "codexRuntime", inventory: this.codexInventory });
        }
        if (result.status === "failed" && this.executionsForPrompt >= MAX_TASK_EXECUTION_ATTEMPTS) {
          await this.markFallbackBudgetExhausted(webview);
        } else if (shouldProposeFallback(result, this.executionsForPrompt, this.fallbackProposed)) {
          await this.proposeFallback(webview, decision, runtime, result.failureKind!);
        } else if (result.runtimeUnavailable) {
          await this.refreshDecisionForCurrentPrompt(webview);
        }
      }).catch(async (error: unknown) => {
        if (this.activeExecution === execution) this.activeExecution = undefined;
        const failedResult: RuntimeExecutionResult = {
          executionId: execution.executionId,
          status: "failed",
          exitCode: -1,
          error: "No se pudo completar la ejecución.",
          failureKind: "process",
        };
        const evaluationRecord = await this.saveEvaluationRecord(
          decision,
          failedResult,
          startedAt,
          prompt,
          Math.max(0, this.executionsForPrompt - 1),
        );
        await webview.postMessage({
          type: "executionResult",
          result: failedResult,
          runtimeId: runtime,
          evaluationRecordId: evaluationRecord.id,
        });
        if (shouldProposeFallback(failedResult, this.executionsForPrompt, this.fallbackProposed)) {
          await this.proposeFallback(webview, decision, runtime, failedResult.failureKind!);
        } else if (this.executionsForPrompt >= MAX_TASK_EXECUTION_ATTEMPTS) {
          await this.markFallbackBudgetExhausted(webview);
        }
      });
    } catch (error) {
      const failedResult: RuntimeExecutionResult = {
        executionId: randomUUID(),
        status: "failed",
        exitCode: -1,
        error: "No se pudo iniciar la ejecución.",
        failureKind: "process",
      };
      void this.saveEvaluationRecord(
        decision,
        failedResult,
        startedAt,
        prompt,
        Math.max(0, this.executionsForPrompt - 1),
      ).then((evaluationRecord) => webview.postMessage({
        type: "executionResult",
        result: failedResult,
        runtimeId: runtime,
        evaluationRecordId: evaluationRecord.id,
      })).catch(() => webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: "No se pudo iniciar la ejecución.",
      }));
    }
  }

  private async openInteractiveFallback(webview: vscode.Webview): Promise<void> {
    const runtime = this.activeExecution
      ? this.activeRuntime
      : this.lastDecision?.selected.runtimeId ?? this.lastExecutionRuntime;
    if (runtime === "claude-code") {
      await this.openClaudeInteractive(webview);
      return;
    }
    if (runtime === "codex") {
      await this.openCodexInteractive(webview);
      return;
    }
    if (!this.lastPrompt || !this.lastDecision) {
      await webview.postMessage({ type: "executionError", message: "Analizá la tarea antes de abrir OpenCode." });
      return;
    }

    let sessionId = this.lastExecutionRuntime === "opencode" ? this.lastExecutionSessionId : undefined;
    if (this.activeExecution) {
      const execution = this.activeExecution;
      execution.cancel();
      const result = await execution.result;
      sessionId = result.sessionId ?? sessionId;
      if (this.activeExecution === execution) this.activeExecution = undefined;
    }

    try {
      launchOpenCodeInteractive(this.lastPrompt, this.lastDecision, sessionId);
      this.lastExecutionRuntime = "opencode";
      await webview.postMessage({ type: "interactiveFallbackOpened" });
    } catch (error) {
      await webview.postMessage({
        type: "executionError",
        message: error instanceof Error ? error.message : "No se pudo abrir la terminal interactiva.",
      });
    }
  }

  private async openClaudeInteractive(webview: vscode.Webview): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision || this.claudeInventory?.runtime.availability !== "available") {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "claude-code",
        message: this.claudeInventory?.runtime.message ?? "Analizá la tarea y verificá Claude Code antes de abrirlo.",
      });
      return;
    }
    if (this.activeExecution && this.activeRuntime !== "claude-code") {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "claude-code",
        message: "Cancelá la ejecución actual antes de cambiar a Claude Code.",
      });
      return;
    }

    let sessionId = this.lastExecutionRuntime === "claude-code" ? this.lastExecutionSessionId : undefined;
    if (this.activeExecution) {
      const execution = this.activeExecution;
      execution.cancel();
      const result = await execution.result;
      sessionId = result.sessionId ?? sessionId;
      if (this.activeExecution === execution) this.activeExecution = undefined;
    }

    try {
      launchClaudeCodeInteractive(this.lastPrompt, sessionId);
      this.lastExecutionRuntime = "claude-code";
      await webview.postMessage({ type: "claudeInteractiveOpened" });
    } catch (error) {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "claude-code",
        message: error instanceof Error ? error.message : "No se pudo abrir Claude Code interactivo.",
      });
    }
  }

  private async openCodexInteractive(webview: vscode.Webview): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision || this.codexInventory?.runtime.availability !== "available") {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "codex",
        message: this.codexInventory?.runtime.message ?? "Analizá la tarea y verificá Codex antes de abrirlo.",
      });
      return;
    }
    if (this.activeExecution && this.activeRuntime !== "codex") {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "codex",
        message: "Cancelá la ejecución actual antes de cambiar a Codex.",
      });
      return;
    }

    let sessionId = this.lastExecutionRuntime === "codex" ? this.lastExecutionSessionId : undefined;
    if (this.activeExecution) {
      const execution = this.activeExecution;
      execution.cancel();
      const result = await execution.result;
      sessionId = result.sessionId ?? sessionId;
      if (this.activeExecution === execution) this.activeExecution = undefined;
    }

    try {
      const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("codexPath", "codex");
      const terminal = vscode.window.createTerminal({
        name: "ChePrompt · Codex interactivo",
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri,
        shellPath: executable,
        shellArgs: sessionId ? ["resume", sessionId] : [],
        env: { OPENAI_API_KEY: null, CODEX_API_KEY: null },
        iconPath: new vscode.ThemeIcon("sparkle"),
      });
      terminal.show();
      this.lastExecutionRuntime = "codex";
      await webview.postMessage({ type: "codexInteractiveOpened" });
    } catch (error) {
      await webview.postMessage({
        type: "executionError",
        runtimeId: "codex",
        message: error instanceof Error ? error.message : "No se pudo abrir Codex interactivo.",
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "styles.css"));
    const markUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "hornero.svg"));
    const defaultProfile = vscode.workspace
      .getConfiguration("cheprompt")
      .get<RoutingProfile>("defaultProfile", "balanced");

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>ChePrompt</title>
  </head>
  <body data-default-profile="${defaultProfile}">
    <header class="brand-header">
      <div>
        <span class="eyebrow">CHEPROMPT <span aria-hidden="true">·</span> ROUTER</span>
        <h1>El modelo justo para cada laburo.</h1>
        <p>Una ruta clara, antes de gastar el cupo.</p>
      </div>
      <img class="hornero-mark" src="${markUri}" alt="Hornero de ChePrompt" />
    </header>

    <main>
      <section class="allowance-strip" aria-label="Cupos por runtime">
        <article id="usage" class="allowance-card allowance-opencode">
          <div class="card-heading">
            <div><span class="eyebrow">POOL 01</span><h2>OpenCode Go</h2></div>
            <span id="opencode-availability" class="state-chip" data-state="checking">Consultando</span>
          </div>
          <p id="usage-status" class="allowance-summary">Consultando cupos oficiales…</p>
          <ul id="usage-windows" class="allowance-windows"></ul>
          <button id="refresh-usage" class="compact secondary" type="button" disabled>Actualizar cupo</button>
        </article>

        <article id="claude-runtime" class="allowance-card">
          <div class="card-heading">
            <div><span class="eyebrow">POOL 02</span><h2>Claude Pro</h2></div>
            <span id="claude-availability" class="state-chip" data-state="checking">Consultando</span>
          </div>
          <p id="claude-runtime-status" class="allowance-summary" role="status" aria-live="polite">Verificando Claude Code…</p>
          <p id="claude-usage-status" class="quota-note">Uso exacto: no disponible</p>
          <div class="runtime-controls">
            <button id="claude-login" class="compact secondary" type="button" disabled>Iniciar sesión</button>
            <button id="refresh-claude" class="compact secondary" type="button">Actualizar</button>
          </div>
          <div id="claude-actions" class="runtime-actions hidden">
            <button id="execute-claude" class="compact secondary" type="button" disabled>Elegir Claude</button>
            <button id="claude-interactive" class="compact secondary" type="button" disabled>Abrir terminal</button>
          </div>
        </article>

        <article id="codex-runtime" class="allowance-card">
          <div class="card-heading">
            <div><span class="eyebrow">POOL 03</span><h2>ChatGPT · Codex</h2></div>
            <span id="codex-availability" class="state-chip" data-state="checking">Consultando</span>
          </div>
          <p id="codex-runtime-status" class="allowance-summary" role="status" aria-live="polite">Verificando Codex…</p>
          <p id="codex-usage-status" class="quota-note">Uso exacto: no disponible</p>
          <div class="runtime-controls">
            <button id="codex-login" class="compact secondary" type="button" disabled>Iniciar sesión</button>
            <button id="refresh-codex" class="compact secondary" type="button">Actualizar</button>
          </div>
          <div id="codex-actions" class="runtime-actions hidden">
            <button id="execute-codex" class="compact secondary" type="button" disabled>Elegir Codex</button>
            <button id="codex-interactive" class="compact secondary" type="button" disabled>Abrir terminal</button>
          </div>
          <p class="quota-note">La API key usa facturación aparte.</p>
        </article>
      </section>

      <section class="composer" aria-labelledby="composer-title">
        <div class="composer-heading">
          <label id="composer-title" for="prompt">¿Qué querés resolver?</label>
          <span class="composer-shortcut">⌘/Ctrl + Enter</span>
        </div>
        <textarea id="prompt" rows="5" placeholder="Ej.: Investigá por qué falla el login y proponé un arreglo con tests."></textarea>
        <div class="composer-footer">
          <label class="profile-label" for="profile">Perfil
            <select id="profile">
              <option value="economy">Económico</option>
              <option value="balanced">Equilibrado</option>
              <option value="quality">Máxima calidad</option>
            </select>
          </label>
          <button id="analyze" class="primary" type="button">Dale</button>
        </div>
      </section>

      <details id="parallel-panel" class="parallel-panel inventory">
        <summary>Dos subtareas independientes · worktrees aislados</summary>
        <p>Definí exactamente dos tareas que no dependan entre sí. ChePrompt las enruta por separado, crea un worktree por tarea y no combina los cambios automáticamente. El repositorio debe estar limpio.</p>
        <label for="parallel-task-1">Subtarea 1</label>
        <textarea id="parallel-task-1" rows="4" placeholder="Ej.: Agregá paginación al endpoint de artículos y sus tests."></textarea>
        <label for="parallel-task-2">Subtarea 2</label>
        <textarea id="parallel-task-2" rows="4" placeholder="Ej.: Actualizá la documentación del CLI con los argumentos actuales."></textarea>
        <label class="independence-confirmation">
          <input id="parallel-independent" type="checkbox" />
          Confirmo que ambas tareas son independientes y pueden ejecutarse desde el mismo commit.
        </label>
        <button id="analyze-parallel" class="compact secondary" type="button">Analizar ambas</button>
        <div id="parallel-plan" class="parallel-plan hidden" aria-live="polite"></div>
        <div class="parallel-controls">
          <button id="execute-parallel" class="primary" type="button" disabled>Revisé las dos rutas · ejecutar</button>
          <button id="cancel-parallel" class="secondary" type="button" disabled>Cancelar ambas</button>
        </div>
        <p id="parallel-status" class="status-line" role="status" aria-live="polite"></p>
        <div id="parallel-results" class="parallel-results"></div>
      </details>

      <p id="status" class="status-line" role="status" aria-live="polite"></p>

      <details id="inventory" class="inventory">
        <summary>Inventario de runtimes</summary>
        <p id="inventory-status">Consultando runtimes…</p>
        <ul id="inventory-models"></ul>
      </details>

      <details id="evaluation-dataset" class="inventory">
        <summary>Evaluación manual · 20 tareas sintéticas</summary>
        <p>Elegí una tarea de referencia. No se ejecuta sola; se manda únicamente al presionar Dale y luego ejecutar.</p>
        <label for="evaluation-case">Tarea de evaluación</label>
        <select id="evaluation-case">
          <option value="">Seleccioná una tarea…</option>
        </select>
        <button id="load-evaluation-case" class="compact secondary" type="button">Usar en el composer</button>
      </details>

      <section id="decision" class="decision hidden" aria-labelledby="decision-title">
        <div class="decision-heading">
          <span class="state-chip" data-state="selected">Elegido</span>
          <span id="complexity" class="complexity-chip"></span>
          <span id="confidence" class="confidence"></span>
        </div>
        <h2 id="decision-title"><span id="model"></span></h2>
        <p id="route-runtime" class="mono"></p>
        <p id="model-id" class="mono"></p>
        <p id="reason"></p>
        <p id="routing-notice" class="routing-notice hidden" role="status" aria-live="polite"></p>
        <dl>
          <div><dt>Impacto de uso</dt><dd id="impact"></dd></div>
          <div><dt>Cupo de ejecución</dt><dd id="allowance"></dd></div>
          <div><dt>Puntaje</dt><dd id="total-score"></dd></div>
        </dl>
        <details>
          <summary>Componentes del puntaje</summary>
          <ul id="score-components"></ul>
        </details>
        <details>
          <summary>Alternativas consideradas</summary>
          <ul id="alternatives"></ul>
        </details>
        <details>
          <summary>Override manual</summary>
          <label for="override-candidate">Ejecutar con otro candidato</label>
          <select id="override-candidate"></select>
          <button id="apply-override" class="compact secondary" type="button">Aplicar override</button>
        </details>
        <button id="execute" class="run">Ejecutar ruta elegida</button>
      </section>

      <section id="execution" class="execution hidden" aria-labelledby="execution-title">
        <div class="execution-heading">
          <span class="eyebrow">EN CURSO</span>
          <span class="state-chip" data-state="running">Ejecución</span>
        </div>
        <h2 id="execution-title">Salida del runtime</h2>
        <p id="execution-status" role="status"></p>
        <div id="execution-output" class="execution-output" aria-live="off"></div>
        <div class="execution-controls">
          <button id="cancel-execution" class="secondary" type="button">Cancelar</button>
          <button id="interactive-fallback" class="secondary" type="button">Abrir terminal interactiva</button>
        </div>
        <div id="verification-controls" class="verification hidden">
          <h3>¿Pudiste verificar el resultado?</h3>
          <p id="verification-status" role="status" aria-live="polite">El registro local no guarda el texto del prompt.</p>
          <div class="verification-actions">
            <button id="verification-passed" class="compact secondary" type="button">Verificado</button>
            <button id="verification-failed" class="compact secondary" type="button">Falló la verificación</button>
            <button id="verification-not-run" class="compact secondary" type="button">No lo probé</button>
          </div>
        </div>
      </section>

      <details id="evaluation-history" class="inventory">
        <summary>Historial local · sin prompts</summary>
        <p id="evaluation-history-summary">Todavía no hay ejecuciones registradas.</p>
        <ol id="evaluation-history-list"></ol>
      </details>

      <details id="parallel-history" class="inventory">
        <summary>Historial de ejecuciones paralelas · sin prompts</summary>
        <p id="parallel-history-summary">Todavía no hay ejecuciones paralelas.</p>
        <ol id="parallel-history-list"></ol>
      </details>
    </main>

    <footer>Scoring local con hipótesis iniciales. Revisá la ruta y el cupo antes de ejecutar.</footer>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

type AnalyzeMessage = {
  type: "analyze";
  prompt: string;
  profile: RoutingProfile;
};

type ExecuteMessage = { type: "execute" };
type AnalyzeParallelMessage = {
  type: "analyzeParallel";
  tasks: string[];
  profile: RoutingProfile;
  independenceConfirmed: boolean;
};
type ExecuteParallelMessage = {
  type: "executeParallel";
  tasks: string[];
  profile: RoutingProfile;
  independenceConfirmed: boolean;
};
type CancelParallelMessage = { type: "cancelParallel" };
type ParallelWorktreeMessage = { type: "openParallelWorktree" | "removeParallelWorktree"; runId: string; taskId: string };
type RefreshUsageMessage = { type: "refreshUsage" };
type CancelExecutionMessage = { type: "cancelExecution" };
type InteractiveFallbackMessage = { type: "interactiveFallback" };
type SelectClaudeMessage = { type: "selectClaude" };
type ClaudeInteractiveMessage = { type: "claudeInteractive" };
type RefreshClaudeMessage = { type: "refreshClaude" };
type ClaudeLoginMessage = { type: "claudeLogin" };
type SelectCodexMessage = { type: "selectCodex" };
type CodexInteractiveMessage = { type: "codexInteractive" };
type RefreshCodexMessage = { type: "refreshCodex" };
type CodexLoginMessage = { type: "codexLogin" };
type OverrideCandidateMessage = {
  type: "overrideCandidate";
  runtimeId: string;
  providerId: string;
  id: string;
  allowancePoolId: string;
};
type WebviewReadyMessage = { type: "webviewReady" };
type VerificationOutcomeMessage = {
  type: "verificationOutcome";
  recordId: string;
  outcome: VerificationOutcome;
};

function isWebviewMessage(value: unknown): value is
  | WebviewReadyMessage
  | VerificationOutcomeMessage
  | AnalyzeMessage
  | AnalyzeParallelMessage
  | ExecuteMessage
  | ExecuteParallelMessage
  | CancelParallelMessage
  | ParallelWorktreeMessage
  | RefreshUsageMessage
  | CancelExecutionMessage
  | InteractiveFallbackMessage
  | SelectClaudeMessage
  | ClaudeInteractiveMessage
  | RefreshClaudeMessage
  | ClaudeLoginMessage
  | SelectCodexMessage
  | CodexInteractiveMessage
  | RefreshCodexMessage
  | CodexLoginMessage
  | OverrideCandidateMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.type === "overrideCandidate" &&
    typeof candidate.runtimeId === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.allowancePoolId === "string"
  ) {
    return true;
  }
  if (
    candidate.type === "verificationOutcome" &&
    typeof candidate.recordId === "string" &&
    ["unverified", "passed", "failed", "not-run"].includes(String(candidate.outcome))
  ) {
    return true;
  }
  if (
    candidate.type === "analyzeParallel" &&
    Array.isArray(candidate.tasks) &&
    candidate.tasks.every((task) => typeof task === "string") &&
    ["economy", "balanced", "quality"].includes(String(candidate.profile)) &&
    typeof candidate.independenceConfirmed === "boolean"
  ) {
    return true;
  }
  if (
    candidate.type === "executeParallel" &&
    Array.isArray(candidate.tasks) &&
    candidate.tasks.every((task) => typeof task === "string") &&
    ["economy", "balanced", "quality"].includes(String(candidate.profile)) &&
    typeof candidate.independenceConfirmed === "boolean"
  ) return true;
  if (
    ["openParallelWorktree", "removeParallelWorktree"].includes(String(candidate.type)) &&
    typeof candidate.runId === "string" &&
    typeof candidate.taskId === "string"
  ) return true;
  if ([
    "webviewReady",
    "execute",
    "cancelParallel",
    "openParallelWorktree",
    "removeParallelWorktree",
    "refreshUsage",
    "cancelExecution",
    "interactiveFallback",
    "selectClaude",
    "claudeInteractive",
    "refreshClaude",
    "claudeLogin",
    "selectCodex",
    "codexInteractive",
    "refreshCodex",
    "codexLogin",
  ].includes(String(candidate.type))) {
    return true;
  }

  return (
    candidate.type === "analyze" &&
    typeof candidate.prompt === "string" &&
    ["economy", "balanced", "quality"].includes(String(candidate.profile))
  );
}

function isRuntimeId(value: string): value is "opencode" | "claude-code" | "codex" {
  return ["opencode", "claude-code", "codex"].includes(value);
}

function sameCandidate(left: RuntimeModel, right: RuntimeModel): boolean {
  return left.runtimeId === right.runtimeId
    && left.providerId === right.providerId
    && left.id === right.id
    && left.allowancePoolId === right.allowancePoolId;
}

function decisionReviewSignature(decision: RoutingDecision): string {
  const candidateKey = (model: RuntimeModel) => [
    model.runtimeId,
    model.providerId,
    model.id,
    model.allowancePoolId,
  ].join("/");
  return JSON.stringify({
    selected: candidateKey(decision.selected),
    alternatives: decision.alternatives.map(candidateKey),
    score: decision.selectedScore.total.toFixed(1),
    alternativeScores: decision.alternativeScores.map((score) => score.total.toFixed(1)),
    allowancePoolId: decision.allowancePoolId,
    remainingPercent: decision.remainingPercent ?? null,
    allowanceSource: decision.allowanceSource ?? null,
    allowanceObservedAt: decision.allowanceObservedAt ?? null,
    manualOverride: decision.manualOverride ?? false,
    routingNotice: decision.routingNotice ?? null,
  });
}

function failureKindLabel(failureKind: RuntimeExecutionResult["failureKind"]): string {
  switch (failureKind) {
    case "authentication": return "un problema de autenticación";
    case "quota": return "un límite de uso";
    case "tool": return "un error de herramienta";
    case "process": return "un error del runtime";
    case "approval": return "una aprobación pendiente";
    case "protocol": return "un error de protocolo";
    case "verification": return "una verificación humana fallida";
    default: return "un error objetivo";
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join("");
}
