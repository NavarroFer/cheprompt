import * as vscode from "vscode";
import {
  launchOpenCodeInteractive,
  OpenCodeAdapter,
  OpenCodeExecutionAdapter,
  OpenCodeExecutionHandle,
} from "./opencode";
import { routePrompt } from "./router";
import { RoutingDecision, RoutingProfile, RuntimeExecutionEvent, RuntimeInventory } from "./types";

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
  private lastPrompt?: string;
  private lastDecision?: RoutingDecision;
  private inventory?: RuntimeInventory;
  private activeExecution?: OpenCodeExecutionHandle;
  private lastExecutionSessionId?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.getHtml(view.webview);
    void this.discoverInventory(view.webview);

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

      if (message.type === "analyze") {
        try {
          if (this.activeExecution) {
            throw new Error("Cancelá la ejecución actual antes de analizar otra tarea.");
          }
          this.lastPrompt = undefined;
          this.lastDecision = undefined;
          this.lastExecutionSessionId = undefined;
          if (!this.inventory) {
            throw new Error("El inventario de modelos todavía no está disponible. Revisá OpenCode e intentá de nuevo.");
          }
          const decision = routePrompt(message.prompt, message.profile, this.inventory.models, Date.now());
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

      if (message.type === "execute") {
        if (!this.lastPrompt || !this.lastDecision) {
          await view.webview.postMessage({
            type: "error",
            message: "Analizá la tarea antes de ejecutarla.",
          });
          return;
        }

        this.startExecution(view.webview);
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
    await webview.postMessage({ type: "usage", snapshot });
  }

  private startExecution(webview: vscode.Webview): void {
    if (!this.lastPrompt || !this.lastDecision || this.activeExecution) {
      void webview.postMessage({
        type: "executionError",
        message: this.activeExecution
          ? "Ya hay una tarea en ejecución. Cancelala antes de iniciar otra."
          : "Analizá la tarea antes de ejecutarla.",
      });
      return;
    }

    const executable = vscode.workspace.getConfiguration("cheprompt").get<string>("opencodePath", "opencode");
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
      const execution = new OpenCodeExecutionAdapter(executable).start(
        this.lastPrompt,
        this.lastDecision,
        cwd,
        (event: RuntimeExecutionEvent) => {
          if (event.sessionId) this.lastExecutionSessionId = event.sessionId;
          void webview.postMessage({ type: "executionEvent", event });
        },
      );
      this.activeExecution = execution;
      void execution.result.then(async (result) => {
        if (result.sessionId) this.lastExecutionSessionId = result.sessionId;
        if (this.activeExecution === execution) this.activeExecution = undefined;
        await webview.postMessage({ type: "executionResult", result });
      }).catch(async (error: unknown) => {
        if (this.activeExecution === execution) this.activeExecution = undefined;
        await webview.postMessage({
          type: "executionError",
          message: error instanceof Error ? error.message : "No se pudo completar la ejecución.",
        });
      });
    } catch (error) {
      void webview.postMessage({
        type: "executionError",
        message: error instanceof Error ? error.message : "No se pudo iniciar OpenCode.",
      });
    }
  }

  private async openInteractiveFallback(webview: vscode.Webview): Promise<void> {
    if (!this.lastPrompt || !this.lastDecision) {
      await webview.postMessage({ type: "executionError", message: "Analizá la tarea antes de abrir OpenCode." });
      return;
    }

    let sessionId = this.lastExecutionSessionId;
    if (this.activeExecution) {
      const execution = this.activeExecution;
      execution.cancel();
      const result = await execution.result;
      sessionId = result.sessionId ?? sessionId;
      if (this.activeExecution === execution) this.activeExecution = undefined;
    }

    try {
      launchOpenCodeInteractive(this.lastPrompt, this.lastDecision, sessionId);
      await webview.postMessage({ type: "interactiveFallbackOpened" });
    } catch (error) {
      await webview.postMessage({
        type: "executionError",
        message: error instanceof Error ? error.message : "No se pudo abrir la terminal interactiva.",
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "styles.css"));
    const defaultProfile = vscode.workspace
      .getConfiguration("cheprompt")
      .get<RoutingProfile>("defaultProfile", "balanced");

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>ChePrompt</title>
  </head>
  <body data-default-profile="${defaultProfile}">
    <header>
      <span class="eyebrow">CHEPROMPT</span>
      <h1>El modelo justo para cada laburo.</h1>
      <p>Analizá la decisión antes de consumir uso de OpenCode Go.</p>
    </header>

    <main>
      <label for="prompt">¿Qué querés hacer?</label>
      <textarea id="prompt" rows="8" placeholder="Ej.: Investigá por qué falla el login y proponé un arreglo con tests."></textarea>

      <label for="profile">Perfil</label>
      <select id="profile">
        <option value="economy">Económico</option>
        <option value="balanced">Equilibrado</option>
        <option value="quality">Máxima calidad</option>
      </select>

      <button id="analyze" class="primary">Analizar ruta</button>
      <p id="status" role="status" aria-live="polite"></p>

      <section id="inventory" class="inventory" aria-live="polite">
        <h2>Inventario de runtimes</h2>
        <p id="inventory-status">Consultando OpenCode…</p>
        <ul id="inventory-models"></ul>
      </section>

      <section id="usage" class="usage" aria-live="polite">
        <div class="usage-heading">
          <h2>Uso de OpenCode Go</h2>
          <button id="refresh-usage" class="compact" type="button" disabled>Actualizar</button>
        </div>
        <p id="usage-status">Consultando límites oficiales…</p>
        <ul id="usage-windows"></ul>
      </section>

      <section id="decision" class="decision hidden" aria-live="polite">
        <div class="decision-heading">
          <span id="complexity" class="pill"></span>
          <span id="confidence" class="confidence"></span>
        </div>
        <h2 id="model"></h2>
        <p id="model-id" class="mono"></p>
        <p id="reason"></p>
        <dl>
          <div><dt>Impacto de uso</dt><dd id="impact"></dd></div>
          <div><dt>Precio</dt><dd id="pricing"></dd></div>
        </dl>
        <details>
          <summary>Alternativas consideradas</summary>
          <ul id="alternatives"></ul>
        </details>
        <button id="execute" class="run">Ejecutar en ChePrompt</button>
        <button id="interactive-fallback" class="secondary" type="button">Abrir terminal interactiva</button>
        <p class="hint">Usá la terminal si OpenCode necesita una aprobación interactiva.</p>
      </section>

      <section id="execution" class="execution hidden" aria-live="polite">
        <h2>Salida de OpenCode</h2>
        <p id="execution-status" role="status"></p>
        <div id="execution-output" class="execution-output"></div>
        <button id="cancel-execution" class="secondary" type="button">Cancelar ejecución</button>
      </section>
    </main>

    <footer>Routing inicial basado en reglas. Medir antes de automatizar más.</footer>
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

function isWebviewMessage(value: unknown): value is
  | AnalyzeMessage
  | ExecuteMessage
  | RefreshUsageMessage
  | CancelExecutionMessage
  | InteractiveFallbackMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (["execute", "refreshUsage", "cancelExecution", "interactiveFallback"].includes(String(candidate.type))) {
    return true;
  }

  return (
    candidate.type === "analyze" &&
    typeof candidate.prompt === "string" &&
    ["economy", "balanced", "quality"].includes(String(candidate.profile))
  );
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join("");
}
