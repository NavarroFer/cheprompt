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
  disabled = false;

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  append(child: FakeElement): void {
    this.children.push(child);
  }

  click(): void {
    this.listeners.get("click")?.({ preventDefault() {} });
  }
}

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
        if (["decision", "execution", "claude-actions", "codex-actions"].includes(id)) {
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
