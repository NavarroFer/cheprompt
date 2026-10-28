import * as vscode from "vscode";
import { launchOpenCode } from "./opencode";
import { routePrompt } from "./router";
import { RoutingDecision, RoutingProfile } from "./types";

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

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isWebviewMessage(message)) {
        return;
      }

      if (message.type === "analyze") {
        try {
          const decision = routePrompt(message.prompt, message.profile);
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

        launchOpenCode(this.lastPrompt, this.lastDecision);
        await view.webview.postMessage({ type: "executed" });
      }
    });
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
        <button id="execute" class="run">Ejecutar con este modelo</button>
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

function isWebviewMessage(value: unknown): value is AnalyzeMessage | ExecuteMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "execute") {
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
