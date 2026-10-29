import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

type Listener = (event: Record<string, unknown>) => void;

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener>();
  textContent = "";
  className = "";
  value = "";
  src = "";
  disabled = false;
  checked = false;

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  prepend(...children: FakeElement[]): void {
    this.children.unshift(...children);
  }

  focus(): void {}

  click(): void {
    this.listeners.get("click")?.({ preventDefault() {} });
  }
}

class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload?: () => void;
  onerror?: () => void;

  readAsDataURL(file: { type: string; content: string }): void {
    this.result = `data:${file.type};base64,${file.content}`;
    queueMicrotask(() => this.onload?.());
  }
}

const settle = () => new Promise((resolveTick) => setImmediate(resolveTick));

function loadWebview(): {
  elements: Map<string, FakeElement>;
  messages: Array<Record<string, unknown>>;
  receive(data: Record<string, unknown>): void;
} {
  const elements = new Map<string, FakeElement>();
  const messages: Array<Record<string, unknown>> = [];
  let messageListener: Listener | undefined;
  const body = new FakeElement();
  body.dataset.defaultProfile = "balanced";
  const document = {
    body,
    getElementById(id: string): FakeElement {
      let element = elements.get(id);
      if (!element) {
        element = new FakeElement();
        if (["decision", "execution", "claude-actions", "codex-actions", "parallel-plan"].includes(id)) {
          element.classList.add("hidden");
        }
        elements.set(id, element);
      }
      return element;
    },
    createElement(_tag: string): FakeElement { return new FakeElement(); },
  };
  const window = {
    addEventListener(type: string, listener: Listener): void {
      if (type === "message") messageListener = listener;
    },
  };
  const api = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
  const source = readFileSync(resolve(process.cwd(), "media/main.js"), "utf8");

  runInNewContext(source, {
    acquireVsCodeApi: () => api,
    document,
    window,
    FileReader: FakeFileReader,
    Promise,
    String,
    setInterval: () => 0,
    Date,
    JSON,
    Math,
    Number,
  });

  return {
    elements,
    messages,
    receive: (data) => messageListener?.({ data }),
  };
}

const score = {
  taskFit: 88,
  usagePressure: 65,
  contextFit: null,
  capabilityFit: 100,
  availability: 100,
  expiration: 100,
  allowance: null,
  total: 89,
};

const codexModel = {
  id: "codex-default",
  label: "Codex configurado",
  runtimeId: "codex",
  providerId: "chatgpt-codex",
  allowancePoolId: "chatgpt-codex",
  availability: "available",
  usageImpact: "medium",
  capabilities: ["text", "tools"],
  strengths: [],
};

test("Cmd/Ctrl+Enter requests a route analysis from the composer", () => {
  const { elements, messages } = loadWebview();
  elements.get("prompt")!.value = "Revisá el login";
  let prevented = false;
  elements.get("prompt")!.listeners.get("keydown")?.({
    key: "Enter",
    metaKey: false,
    ctrlKey: true,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(messages.at(-1)?.type, "analyze");
  assert.equal(messages.at(-1)?.prompt, "Revisá el login");
  assert.equal(elements.get("status")?.dataset.state, "analyzing");
  assert.equal(elements.get("analyze")?.disabled, true);
});

test("route review shows runtime, pool, score and alternatives before execute", () => {
  const { elements, messages, receive } = loadWebview();
  receive({
    type: "codexRuntime",
    inventory: { runtime: { availability: "unavailable", installed: true }, providers: [], models: [] },
  });
  assert.equal(elements.get("codex-availability")?.textContent, "No disponible");
  assert.equal(elements.get("execute-codex")?.disabled, true);
  receive({
    type: "codexRuntime",
    inventory: { runtime: { availability: "available", installed: true }, providers: [], models: [] },
  });
  assert.equal(elements.get("codex-availability")?.textContent, "Disponible");
  const alternative = { ...codexModel, id: "claude-code/default", runtimeId: "claude-code", providerId: "claude-pro", allowancePoolId: "claude-pro", label: "Claude predeterminado" };
  receive({
    type: "decision",
    decision: {
      profile: "balanced",
      complexity: "standard",
      selected: codexModel,
      alternatives: [alternative],
      selectedScore: score,
      alternativeScores: [{ ...score, total: 84 }],
      allowancePoolId: "chatgpt-codex",
      reason: "Encaja con la tarea.",
      confidence: 0.81,
      pricing: "No disponible",
      manualOverride: false,
    },
  });

  assert.equal(elements.get("model")?.textContent, "Codex configurado");
  assert.equal(elements.get("route-runtime")?.textContent, "codex · proveedor chatgpt-codex");
  assert.match(elements.get("allowance")?.textContent ?? "", /chatgpt-codex · No disponible/);
  assert.equal(elements.get("total-score")?.textContent, "89/100");
  assert.equal(elements.get("alternatives")?.children.length, 1);
  assert.equal(elements.get("decision")?.classList.contains("hidden"), false);
  assert.equal(elements.get("execute")?.disabled, false);
  assert.equal(elements.get("interactive-fallback")?.disabled, false);
  assert.equal(elements.get("status")?.dataset.state, "selected");

  elements.get("override-candidate")!.value = JSON.stringify({
    runtimeId: "claude-code",
    providerId: "claude-pro",
    id: "claude-code/default",
    allowancePoolId: "claude-pro",
  });
  elements.get("apply-override")?.click();
  assert.equal(messages.at(-1)?.type, "overrideCandidate");
  assert.equal(messages.at(-1)?.allowancePoolId, "claude-pro");
});

test("execution status, streaming text and cancellation use accessible runtime cues", () => {
  const { elements, messages, receive } = loadWebview();
  receive({
    type: "codexRuntime",
    inventory: { runtime: { availability: "available", installed: true }, providers: [], models: [] },
  });
  receive({
    type: "decision",
    decision: {
      profile: "balanced",
      complexity: "standard",
      selected: codexModel,
      alternatives: [],
      selectedScore: score,
      alternativeScores: [],
      allowancePoolId: "chatgpt-codex",
      reason: "Ruta Codex.",
      confidence: 0.81,
      pricing: "No disponible",
    },
  });
  elements.get("execute")?.click();
  assert.equal(messages.at(-1)?.type, "execute");
  assert.equal(elements.get("execution")?.classList.contains("hidden"), false);
  assert.equal(elements.get("interactive-fallback")?.disabled, false);

  receive({ type: "executionEvent", event: { type: "started" } });
  assert.equal(elements.get("execution-status")?.textContent, "Codex está trabajando…");
  receive({ type: "executionEvent", event: { type: "text", text: "Prueba lista" } });
  assert.equal(elements.get("execution-output")?.children[0]?.textContent, "Prueba lista");
  elements.get("cancel-execution")?.click();
  assert.equal(messages.at(-1)?.type, "cancelExecution");

  receive({ type: "executionEvent", event: { type: "approval_required", message: "Necesita aprobación" } });
  assert.match(elements.get("execution-status")?.textContent ?? "", /aprobación interactiva/);
  receive({
    type: "executionResult",
    runtimeId: "codex",
    result: { status: "failed", error: "Codex informó un límite de uso." },
  });
  assert.equal(elements.get("execution-status")?.textContent, "Codex informó un límite de uso.");
});

test("interactive handoff is confirmed and reported separately from a cancellation", () => {
  const { elements, messages, receive } = loadWebview();
  receive({
    type: "codexRuntime",
    inventory: { runtime: { availability: "available", installed: true }, providers: [], models: [] },
  });
  receive({
    type: "decision",
    decision: {
      profile: "balanced",
      complexity: "standard",
      selected: codexModel,
      alternatives: [],
      selectedScore: score,
      alternativeScores: [],
      allowancePoolId: "chatgpt-codex",
      reason: "Ruta Codex.",
      confidence: 0.81,
      pricing: "No disponible",
    },
  });
  elements.get("execute")?.click();
  receive({ type: "executionEvent", event: { type: "started" } });

  elements.get("interactive-fallback")?.click();
  assert.equal(messages.at(-1)?.type, "interactiveFallback");
  assert.equal(elements.get("interactive-fallback")?.disabled, true);
  receive({ type: "interactiveFallbackDeclined" });
  assert.equal(elements.get("interactive-fallback")?.disabled, false);
  assert.equal(elements.get("execution-status")?.textContent, "La ejecución sigue en curso.");

  receive({ type: "executionResult", runtimeId: "codex", handedOff: true, result: { status: "cancelled" } });
  assert.match(elements.get("execution-status")?.textContent ?? "", /terminal interactiva/);
  receive({ type: "executionResult", runtimeId: "codex", result: { status: "cancelled" } });
  assert.equal(elements.get("execution-status")?.textContent, "Ejecución cancelada.");
});

test("execute-on-send starts the chosen route and lists files changed while it runs", () => {
  const { elements, messages, receive } = loadWebview();
  receive({
    type: "codexRuntime",
    inventory: { runtime: { availability: "available", installed: true }, providers: [], models: [] },
  });
  elements.get("prompt")!.value = "Respondé aunque haya audios";
  elements.get("analyze")?.click();
  assert.equal(messages.at(-1)?.type, "analyze");

  receive({
    type: "decision",
    autoExecute: true,
    decision: {
      profile: "balanced",
      complexity: "standard",
      selected: codexModel,
      alternatives: [],
      selectedScore: score,
      alternativeScores: [],
      allowancePoolId: "chatgpt-codex",
      reason: "Ruta Codex.",
      confidence: 0.81,
      pricing: "No disponible",
    },
  });
  assert.equal(messages.at(-1)?.type, "analyze", "the extension starts the run; the webview must not request a second execution");
  assert.equal(elements.get("execution")?.classList.contains("hidden"), false);
  assert.equal(elements.get("execute")?.disabled, true);
  assert.equal(elements.get("cancel-execution")?.disabled, false);
  assert.match(elements.get("status")?.textContent ?? "", /Codex configurado elegido automáticamente/);

  receive({ type: "workspaceChanges", changes: [{ path: "src/lib/asistente/nucleo.ts", kind: "changed" }] });
  receive({ type: "workspaceChanges", changes: [
    { path: "src/lib/asistente/nucleo.ts", kind: "changed" },
    { path: "tests/asistente/audios.test.ts", kind: "created" },
  ] });
  const list = elements.get("execution-changes-list")!;
  assert.equal(elements.get("execution-changes")?.classList.contains("hidden"), false);
  assert.equal(list.children.length, 2);
  assert.equal(elements.get("execution-changes-title")?.textContent, "Archivos modificados · 2");
  const createdButton = list.children[1].children[0];
  assert.equal(createdButton.children[0].textContent, "NUEVO");
  assert.equal(createdButton.children[1].textContent, "tests/asistente/audios.test.ts");
  createdButton.click();
  assert.equal(messages.at(-1)?.type, "openChange");
  assert.equal(messages.at(-1)?.path, "tests/asistente/audios.test.ts");

  elements.get("execute")?.click();
  assert.equal(list.children.length, 2, "a retry keeps the files changed earlier in the conversation");
  elements.get("new-conversation")?.click();
  assert.equal(list.children.length, 0, "a new conversation starts with an empty change list");
  assert.equal(elements.get("execution-changes")?.classList.contains("hidden"), true);
});

test("pasted images travel with the prompt and the conversation continues in the same thread", async () => {
  const { elements, messages, receive } = loadWebview();
  const prompt = elements.get("prompt")!;
  const screenshot = { type: "image/png", size: 12, name: "captura.png", content: "iVBORw0KGgo=" };
  let prevented = false;
  prompt.listeners.get("paste")?.({
    clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => screenshot }] },
    preventDefault() { prevented = true; },
  });
  await settle();
  assert.equal(prevented, true);
  const chips = elements.get("prompt-attachments")!;
  assert.equal(chips.classList.contains("hidden"), false);
  assert.equal(chips.children.length, 1);

  prompt.value = "El botón de la captura no responde";
  elements.get("analyze")?.click();
  const analyze = messages.at(-1)!;
  assert.equal(analyze.type, "analyze");
  const [attachment] = analyze.attachments as Array<Record<string, string>>;
  assert.equal(attachment.mimeType, "image/png");
  assert.equal(attachment.data, "iVBORw0KGgo=");
  assert.equal(prompt.value, "", "the composer clears after sending, like a chat");
  assert.equal(chips.children.length, 0);
  const thread = elements.get("execution-output")!;
  assert.equal(thread.children[0].className, "execution-user");
  assert.equal(thread.children[0].children[0].textContent, "El botón de la captura no responde");
  assert.equal(thread.children[0].children[1].children[0].src, "data:image/png;base64,iVBORw0KGgo=");

  receive({
    type: "decision",
    autoExecute: true,
    decision: {
      profile: "balanced",
      complexity: "standard",
      selected: codexModel,
      alternatives: [],
      selectedScore: score,
      alternativeScores: [],
      allowancePoolId: "chatgpt-codex",
      reason: "Ruta Codex.",
      confidence: 0.81,
      pricing: "No disponible",
    },
  });
  receive({ type: "executionEvent", event: { type: "text", text: "Listo, ajusté el handler." } });
  receive({
    type: "executionResult",
    runtimeId: "codex",
    result: { status: "succeeded", sessionId: "thread-1" },
    conversation: { runtimeId: "codex", label: "Codex configurado" },
  });
  assert.equal(elements.get("analyze")?.textContent, "Enviar");
  assert.match(elements.get("composer-title")?.textContent ?? "", /Seguí la conversación · Codex configurado/);
  assert.equal(elements.get("new-conversation")?.classList.contains("hidden"), false);
  assert.equal(elements.get("profile")?.disabled, true);

  prompt.value = "Ahora agregá un test";
  elements.get("analyze")?.click();
  assert.equal(messages.at(-1)?.type, "followUp");
  assert.equal(messages.at(-1)?.prompt, "Ahora agregá un test");
  assert.equal(thread.children.length, 3, "the follow-up is appended to the thread without a retry marker");
  assert.equal(thread.children[2].className, "execution-user");
  assert.equal(elements.get("cancel-execution")?.disabled, false);

  receive({ type: "executionError", runtimeId: "codex", message: "Ya hay una tarea en ejecución." });
  assert.equal(prompt.value, "Ahora agregá un test", "a turn that never started is restored for editing");
  assert.equal(thread.children.length, 2);

  elements.get("new-conversation")?.click();
  assert.equal(messages.at(-1)?.type, "newConversation");
  assert.equal(elements.get("analyze")?.textContent, "Dale");
  assert.equal(elements.get("profile")?.disabled, false);
  assert.equal(thread.children.length, 0);
});

test("parallel workflow requires an independence confirmation, reviews both routes, and keeps worktrees explicit", () => {
  const { elements, messages, receive } = loadWebview();
  elements.get("parallel-task-1")!.value = "Implementá la paginación del endpoint y agregá pruebas.";
  elements.get("parallel-task-2")!.value = "Actualizá el manual del CLI con los argumentos actuales.";
  elements.get("analyze-parallel")?.click();
  assert.equal(messages.some((message) => message.type === "analyzeParallel"), false);

  elements.get("parallel-independent")!.checked = true;
  elements.get("analyze-parallel")?.click();
  assert.equal(messages.at(-1)?.type, "analyzeParallel");
  assert.equal((messages.at(-1)?.tasks as string[]).length, 2);
  assert.equal(messages.at(-1)?.independenceConfirmed, true);

  const decision = {
    selected: codexModel,
    selectedScore: score,
    confidence: 0.81,
    allowancePoolId: "chatgpt-codex",
    reason: "Ruta independiente de prueba.",
  };
  receive({
    type: "parallelPlan",
    tasks: [
      { id: "task-1", taskNumber: 1, decision },
      { id: "task-2", taskNumber: 2, decision: { ...decision, selected: { ...codexModel, id: "codex-next" } } },
    ],
  });
  assert.equal(elements.get("parallel-plan")?.children.length, 2);
  assert.match(elements.get("parallel-plan")?.children[0]?.children[1]?.textContent ?? "", /Codex configurado/);
  assert.equal(elements.get("execute-parallel")?.disabled, false);
  elements.get("execute-parallel")?.click();
  assert.equal(messages.at(-1)?.type, "executeParallel");

  const record = {
    id: "run-1",
    recordedAt: "2026-10-28T00:00:00.000Z",
    status: "running",
    tasks: [
      { id: "task-1", taskNumber: 1, runtimeId: "codex", modelId: "codex-default", status: "running", worktreePath: "/worktrees/task-1" },
      { id: "task-2", taskNumber: 2, runtimeId: "codex", modelId: "codex-next", status: "running", worktreePath: "/worktrees/task-2" },
    ],
  };
  receive({ type: "parallelStarted", record });
  receive({ type: "parallelEvent", taskId: "task-1", runtimeId: "codex", event: { type: "text", text: "Listo" } });
  assert.equal(elements.get("parallel-results")?.children[0]?.children[2]?.children[0]?.textContent, "Listo");
  receive({
    type: "parallelCompleted",
    record: {
      ...record,
      status: "succeeded",
      wallClockMs: 1000,
      summedTaskDurationMs: 1700,
      observedTimeSavedMs: 700,
      reportedUsageTaskCount: 0,
    },
  });
  assert.match(elements.get("parallel-results")?.children[0]?.textContent ?? "", /diferencia observada 700 ms/);
  assert.equal(messages.some((message) => message.type === "removeParallelWorktree"), false);
});

test("synthetic evaluation tasks load locally and verification is recorded without prompt text", () => {
  const { elements, messages, receive } = loadWebview();
  const syntheticPrompt = "Tarea sintética de referencia, sin información de usuario.";
  receive({
    type: "evaluationState",
    cases: [{ id: "case-01", title: "Prueba pequeña", complexity: "simple", profile: "economy", prompt: syntheticPrompt }],
    records: [],
  });
  assert.equal(elements.get("evaluation-case")?.children.length, 2);
  elements.get("evaluation-case")!.value = "case-01";
  elements.get("load-evaluation-case")?.click();
  assert.equal(elements.get("prompt")?.value, syntheticPrompt);
  assert.equal(messages.at(-1)?.type, "webviewReady");

  receive({
    type: "executionResult",
    runtimeId: "codex",
    evaluationRecordId: "record-1",
    result: { status: "succeeded" },
  });
  assert.equal(elements.get("verification-controls")?.classList.contains("hidden"), false);
  elements.get("verification-passed")?.click();
  assert.equal(messages.at(-1)?.type, "verificationOutcome");
  assert.equal(messages.at(-1)?.recordId, "record-1");
  assert.equal(messages.at(-1)?.outcome, "passed");

  receive({
    type: "evaluationHistory",
    records: [{
      id: "record-1",
      recordedAt: "2026-10-28T00:00:00.000Z",
      evaluationCaseTitle: "Prueba pequeña",
      complexity: "simple",
      profile: "economy",
      runtimeId: "codex",
      providerId: "chatgpt-codex",
      modelId: "codex-default",
      modelLabel: "Codex",
      allowancePoolId: "chatgpt-codex",
      routingReason: "Ruta de prueba.",
      routingScore: 90,
      executionStatus: "succeeded",
      latencyMs: 1200,
      chepromptRetries: 0,
      runtimeRetries: null,
      verificationOutcome: "passed",
    }],
    updatedRecordId: "record-1",
    verificationOutcome: "passed",
  });
  assert.match(elements.get("evaluation-history-list")?.children[0]?.textContent ?? "", /Prueba pequeña/);
  assert.equal(elements.get("verification-status")?.textContent, "Verificación registrada: verificado.");
  assert.equal(elements.get("evaluation-history-list")?.children[0]?.textContent.includes(syntheticPrompt), false);
});

test("fluorescent theme has visible focus, reduced-motion and narrow-layout rules", () => {
  const css = readFileSync(resolve(process.cwd(), "media/styles.css"), "utf8");
  const extension = readFileSync(resolve(process.cwd(), "src/extension.ts"), "utf8");
  for (const token of ["--cp-bg: #070a0f", "--cp-cyan: #39f2ff", "--cp-lime: #b8ff3d", "--cp-magenta: #ff4fd8", "--cp-hornero: #ff7849"]) {
    assert.ok(css.includes(token), `missing design token ${token}`);
  }
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /max-width:\s*360px/);
  assert.match(extension, /alt="Hornero de ChePrompt"/);
  assert.match(extension, /aria-label="Cupos por runtime"/);
  assert.match(extension, /id="execution-output" class="execution-output" aria-live="off"/);
  assert.match(extension, /id="execution-status" role="status"/);

  const token = (name: string): string => {
    const match = css.match(new RegExp(`--cp-${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `missing color token ${name}`);
    return match[1];
  };
  const ratio = (foreground: string, background: string): number => {
    const luminance = (hex: string): number => {
      const channels = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255);
      const [red, green, blue] = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  const surfaces = [token("bg"), token("surface"), token("surface-raised")];
  for (const foreground of ["text", "muted", "cyan", "lime", "magenta", "hornero", "warning", "danger"]) {
    for (const background of surfaces) {
      assert.ok(ratio(token(foreground), background) >= 4.5, `${foreground} lacks AA contrast on ${background}`);
    }
  }
  assert.ok(ratio(token("bg"), token("hornero")) >= 4.5, "primary button text lacks AA contrast");
});
