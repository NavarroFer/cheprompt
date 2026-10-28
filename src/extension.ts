import * as vscode from "vscode";
import {
  ClaudeCodeAdapter,
  launchClaudeCodeInteractive,
  launchClaudeCodeLogin,
} from "./claude-code";
import { CodexAdapter } from "./codex";
import {
  launchOpenCodeInteractive,
  OpenCodeAdapter,
  OpenCodeExecutionAdapter,
  RuntimeExecutionHandle,
} from "./opencode";
import { routePrompt } from "./router";
import {
  RoutingDecision,
  RoutingProfile,
  RuntimeExecutionEvent,
  RuntimeInventory,
  RuntimeModel,
  UsageSnapshot,
} from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChePromptViewProvider(context.extensionUri);

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
  private activeExecution?: RuntimeExecutionHandle;
  private activeRuntime: "opencode" | "claude-code" | "codex" = "opencode";
  private lastExecutionRuntime: "opencode" | "claude-code" | "codex" = "opencode";
  private lastExecutionSessionId?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

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
          if (this.activeExecution) {
            throw new Error("Cancelá la ejecución actual antes de analizar otra tarea.");
          }
          await this.initialDiscovery;
          this.lastPrompt = undefined;
          this.lastDecision = undefined;
          this.lastExecutionSessionId = undefined;
          this.lastExecutionRuntime = "opencode";
          this.activeRuntime = "opencode";
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

  private async refreshDecisionForCurrentPrompt(webview: vscode.Webview): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution) return;

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

      if (!previous.manualOverride) {
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
            manualOverride: true,
            reason: `Override manual elegido por vos. ${manual.reason}`,
          };
        } catch {
          this.lastDecision = {
            ...automatic,
            reason: `El override dejó de estar disponible; se recalculó la ruta. ${automatic.reason}`,
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
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution) {
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
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution) {
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

  private startExecution(webview: vscode.Webview, runtime: "opencode" | "claude-code" | "codex"): void {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution) {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: this.activeExecution
          ? "Ya hay una tarea en ejecución. Cancelala antes de iniciar otra."
          : "Analizá la tarea antes de ejecutarla.",
      });
      return;
    }

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

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
      const onEvent = (event: RuntimeExecutionEvent) => {
        if (event.sessionId) this.lastExecutionSessionId = event.sessionId;
        void webview.postMessage({ type: "executionEvent", event, runtimeId: runtime });
      };
      const execution = runtime === "opencode"
        ? new OpenCodeExecutionAdapter(
            vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode"),
          ).start(this.lastPrompt, this.lastDecision, cwd, onEvent)
        : runtime === "claude-code"
          ? this.claudeAdapter!.start(this.lastPrompt, cwd, onEvent)
          : this.codexAdapter!.start(
              this.lastPrompt,
              this.lastDecision.selected.runtimeId === "codex"
                ? this.lastDecision
                : { ...this.lastDecision, selected: this.codexInventory!.models[0] },
              cwd,
              onEvent,
            );
      this.activeExecution = execution;
      this.activeRuntime = runtime;
      this.lastExecutionRuntime = runtime;
      void execution.result.then(async (result) => {
        if (result.sessionId) this.lastExecutionSessionId = result.sessionId;
        if (this.activeExecution === execution) this.activeExecution = undefined;
        await webview.postMessage({ type: "executionResult", result, runtimeId: runtime });
        if (runtime === "claude-code" && result.runtimeUnavailable && this.claudeAdapter) {
          this.claudeInventory = await this.claudeAdapter.getInventory();
          await webview.postMessage({ type: "claudeRuntime", inventory: this.claudeInventory });
          await this.refreshDecisionForCurrentPrompt(webview);
        }
        if (runtime === "codex" && result.runtimeUnavailable && this.codexAdapter) {
          const expiry = vscode.workspace.getConfiguration("cheprompt")
            .get<string>("codex.chatgptSubscriptionExpiresAt", "2026-11-22T00:00:00.000Z");
          this.codexInventory = await this.codexAdapter.getInventory(expiry);
          await webview.postMessage({ type: "codexRuntime", inventory: this.codexInventory });
          await this.refreshDecisionForCurrentPrompt(webview);
        }
      }).catch(async (error: unknown) => {
        if (this.activeExecution === execution) this.activeExecution = undefined;
        await webview.postMessage({
          type: "executionError",
          runtimeId: runtime,
          message: error instanceof Error ? error.message : "No se pudo completar la ejecución.",
        });
      });
    } catch (error) {
      void webview.postMessage({
        type: "executionError",
        runtimeId: runtime,
        message: error instanceof Error ? error.message : "No se pudo iniciar OpenCode.",
      });
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

      <p id="status" class="status-line" role="status" aria-live="polite"></p>

      <details id="inventory" class="inventory">
        <summary>Inventario de runtimes</summary>
        <p id="inventory-status">Consultando runtimes…</p>
        <ul id="inventory-models"></ul>
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
      </section>
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

function isWebviewMessage(value: unknown): value is
  | AnalyzeMessage
  | ExecuteMessage
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
  if ([
    "execute",
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
  });
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join("");
}
