const vscode = acquireVsCodeApi();

const promptInput = document.getElementById("prompt");
const profileInput = document.getElementById("profile");
const analyzeButton = document.getElementById("analyze");
const executeButton = document.getElementById("execute");
const interactiveFallbackButton = document.getElementById("interactive-fallback");
const executionPanel = document.getElementById("execution");
const executionStatus = document.getElementById("execution-status");
const executionOutput = document.getElementById("execution-output");
const cancelExecutionButton = document.getElementById("cancel-execution");
const decisionPanel = document.getElementById("decision");
const overrideCandidateSelect = document.getElementById("override-candidate");
const applyOverrideButton = document.getElementById("apply-override");
const status = document.getElementById("status");
const inventoryStatus = document.getElementById("inventory-status");
const inventoryModels = document.getElementById("inventory-models");
const usageStatus = document.getElementById("usage-status");
const usageWindows = document.getElementById("usage-windows");
const refreshUsageButton = document.getElementById("refresh-usage");
const opencodeAvailability = document.getElementById("opencode-availability");
const claudeRuntimeStatus = document.getElementById("claude-runtime-status");
const claudeUsageStatus = document.getElementById("claude-usage-status");
const claudeAvailability = document.getElementById("claude-availability");
const claudeActions = document.getElementById("claude-actions");
const executeClaudeButton = document.getElementById("execute-claude");
const claudeInteractiveButton = document.getElementById("claude-interactive");
const claudeLoginButton = document.getElementById("claude-login");
const refreshClaudeButton = document.getElementById("refresh-claude");
const codexRuntimeStatus = document.getElementById("codex-runtime-status");
const codexUsageStatus = document.getElementById("codex-usage-status");
const codexAvailability = document.getElementById("codex-availability");
const codexActions = document.getElementById("codex-actions");
const executeCodexButton = document.getElementById("execute-codex");
const codexInteractiveButton = document.getElementById("codex-interactive");
const codexLoginButton = document.getElementById("codex-login");
const refreshCodexButton = document.getElementById("refresh-codex");
let latestUsageSnapshot;
let opencodeAvailable = false;
let claudeAvailable = false;
let claudeInstalled = false;
let codexAvailable = false;
let codexInstalled = false;
let currentExecutionRuntime = "opencode";
let latestDecision;

profileInput.value = document.body.dataset.defaultProfile || "balanced";

promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    analyzeButton.click();
  }
});

analyzeButton.addEventListener("click", () => {
  analyzeButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Enrutando… Analizando tarea y disponibilidad.";
  latestDecision = undefined;
  decisionPanel.classList.add("hidden");
  claudeActions.classList.add("hidden");
  codexActions.classList.add("hidden");
  executionPanel.classList.add("hidden");
  executionOutput.replaceChildren();
  vscode.postMessage({
    type: "analyze",
    prompt: promptInput.value,
    profile: profileInput.value,
  });
});

executeButton.addEventListener("click", () => {
  currentExecutionRuntime = latestDecision?.selected.runtimeId || "opencode";
  const runtimeName = currentExecutionRuntime === "claude-code"
    ? "Claude Code"
    : currentExecutionRuntime === "codex" ? "Codex" : "OpenCode";
  executeButton.disabled = true;
  executeClaudeButton.disabled = true;
  executeCodexButton.disabled = true;
  claudeInteractiveButton.disabled = true;
  codexInteractiveButton.disabled = true;
  executionPanel.classList.remove("hidden");
  analyzeButton.disabled = true;
  executionOutput.replaceChildren();
  executionStatus.textContent = `Iniciando ${runtimeName}…`;
  cancelExecutionButton.disabled = false;
  vscode.postMessage({ type: "execute" });
});

executeClaudeButton.addEventListener("click", () => {
  executeClaudeButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Aplicando Claude Pro como override; revisá la ruta antes de ejecutar.";
  vscode.postMessage({ type: "selectClaude" });
});

claudeInteractiveButton.addEventListener("click", () => {
  claudeInteractiveButton.disabled = true;
  executeButton.disabled = true;
  executeClaudeButton.disabled = true;
  executeCodexButton.disabled = true;
  analyzeButton.disabled = true;
  executionPanel.classList.remove("hidden");
  executionStatus.textContent = "Abriendo Claude Code en una terminal interactiva…";
  vscode.postMessage({ type: "claudeInteractive" });
});

executeCodexButton.addEventListener("click", () => {
  executeCodexButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Aplicando Codex como override; revisá la ruta antes de ejecutar.";
  vscode.postMessage({ type: "selectCodex" });
});

codexInteractiveButton.addEventListener("click", () => {
  codexInteractiveButton.disabled = true;
  executeButton.disabled = true;
  executeClaudeButton.disabled = true;
  executeCodexButton.disabled = true;
  analyzeButton.disabled = true;
  executionPanel.classList.remove("hidden");
  executionStatus.textContent = "Abriendo Codex interactivo…";
  vscode.postMessage({ type: "codexInteractive" });
});

claudeLoginButton.addEventListener("click", () => {
  claudeLoginButton.disabled = true;
  vscode.postMessage({ type: "claudeLogin" });
});

codexLoginButton.addEventListener("click", () => {
  codexLoginButton.disabled = true;
  vscode.postMessage({ type: "codexLogin" });
});

refreshClaudeButton.addEventListener("click", () => {
  refreshClaudeButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Actualizando estado de Claude Pro…";
  claudeRuntimeStatus.textContent = "Consultando Claude Code…";
  vscode.postMessage({ type: "refreshClaude" });
});

refreshCodexButton.addEventListener("click", () => {
  refreshCodexButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Actualizando estado de Codex…";
  codexRuntimeStatus.textContent = "Consultando Codex CLI…";
  vscode.postMessage({ type: "refreshCodex" });
});

interactiveFallbackButton.addEventListener("click", () => {
  interactiveFallbackButton.disabled = true;
  executionPanel.classList.remove("hidden");
  analyzeButton.disabled = true;
  executionStatus.textContent = "Cancelando la ejecución actual y abriendo la terminal interactiva…";
  vscode.postMessage({ type: "interactiveFallback" });
});

cancelExecutionButton.addEventListener("click", () => {
  cancelExecutionButton.disabled = true;
  executionStatus.textContent = "Cancelando ejecución…";
  vscode.postMessage({ type: "cancelExecution" });
});

refreshUsageButton.addEventListener("click", () => {
  refreshUsageButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Actualizando cupo oficial de OpenCode Go…";
  usageStatus.textContent = "Consultando límites oficiales…";
  vscode.postMessage({ type: "refreshUsage" });
});

applyOverrideButton.addEventListener("click", () => {
  const candidate = JSON.parse(overrideCandidateSelect.value);
  applyOverrideButton.disabled = true;
  status.textContent = "Aplicando override y recalculando el candidato…";
  vscode.postMessage({ type: "overrideCandidate", ...candidate });
});

window.addEventListener("message", ({ data }) => {
  if (data.type === "inventoryError") {
    opencodeAvailable = false;
    inventoryStatus.textContent = data.message;
    status.textContent = data.message;
    setStateChip(opencodeAvailability, "No disponible", "unavailable");
    return;
  }

  if (data.type === "inventory") {
    const { runtime, providers, models } = data.inventory;
    opencodeAvailable = runtime.availability === "available";
    setStateChip(opencodeAvailability, runtime.availability === "available" ? "Disponible" : "No disponible", runtime.availability);
    const providerNames = providers.map((provider) => provider.name).join(", ");
    inventoryStatus.textContent = `${runtime.name} · proveedores: ${providerNames} · ${models.length} modelo(s)`;
    inventoryModels.replaceChildren(
      ...models.map((model) => {
        const item = document.createElement("li");
        item.textContent = `${model.id} · impacto ${model.usageImpact} · ${model.availability}`;
        if (model.expiresAt) {
          item.textContent += ` · vence ${model.expiresAt}`;
        }
        return item;
      }),
    );
    return;
  }

  if (data.type === "usage") {
    latestUsageSnapshot = data.snapshot;
    renderUsageSnapshot(latestUsageSnapshot);
    return;
  }

  if (data.type === "claudeRuntime") {
    const runtime = data.inventory.runtime;
    claudeAvailable = runtime.availability === "available";
    claudeInstalled = runtime.installed === true;
    setStateChip(claudeAvailability, availabilityLabel(runtime.availability), runtime.availability);
    refreshClaudeButton.disabled = false;
    claudeLoginButton.disabled = !claudeInstalled;
    claudeRuntimeStatus.textContent = runtime.message || (claudeAvailable
      ? "Claude Code está listo."
      : "Claude Code no está disponible.");
    const canExecute = claudeAvailable && !decisionPanel.classList.contains("hidden");
    executeClaudeButton.disabled = !canExecute;
    claudeInteractiveButton.disabled = !canExecute;
    return;
  }

  if (data.type === "claudeLoginOpened") {
    claudeLoginButton.disabled = false;
    claudeRuntimeStatus.textContent = "Login oficial abierto en la terminal. Al terminar, actualizá el estado.";
    return;
  }

  if (data.type === "claudeUsage") {
    claudeUsageStatus.textContent = data.snapshot.status === "available"
      ? "Uso oficial disponible; consultá las ventanas reportadas."
      : "Uso exacto: No disponible · Claude Code no informa porcentaje restante.";
    return;
  }

  if (data.type === "codexRuntime") {
    const runtime = data.inventory.runtime;
    codexAvailable = runtime.availability === "available";
    codexInstalled = runtime.installed === true;
    setStateChip(codexAvailability, availabilityLabel(runtime.availability), runtime.availability);
    refreshCodexButton.disabled = false;
    codexLoginButton.disabled = !codexInstalled;
    codexRuntimeStatus.textContent = runtime.message || (codexAvailable
      ? "Codex está listo."
      : "Codex no está disponible.");
    const canExecute = codexAvailable && !decisionPanel.classList.contains("hidden");
    executeCodexButton.disabled = !canExecute;
    codexInteractiveButton.disabled = !canExecute;
    return;
  }

  if (data.type === "codexUsage") {
    codexUsageStatus.textContent = data.snapshot.status === "available"
      ? "Uso oficial disponible; consultá las ventanas reportadas."
      : "Uso exacto: No disponible · Codex no informa porcentaje restante.";
    return;
  }

  if (data.type === "codexLoginOpened") {
    codexLoginButton.disabled = false;
    codexRuntimeStatus.textContent = "Login abierto. Elegí ‘Sign in with ChatGPT’ para usar la suscripción, no API key.";
    return;
  }

  if (data.type === "executionEvent") {
    renderExecutionEvent(data.event);
    return;
  }

  if (data.type === "routeNeedsReview") {
    executionPanel.classList.add("hidden");
    analyzeButton.disabled = false;
    executeButton.disabled = false;
    executeClaudeButton.disabled = !claudeAvailable;
    claudeInteractiveButton.disabled = !claudeAvailable;
    executeCodexButton.disabled = !codexAvailable;
    codexInteractiveButton.disabled = !codexAvailable;
    cancelExecutionButton.disabled = true;
    interactiveFallbackButton.disabled = !isRuntimeAvailable(latestDecision?.selected.runtimeId);
    analyzeButton.disabled = false;
    status.dataset.state = "warning";
    status.textContent = "El cupo o la ruta cambiaron. Revisá la nueva decisión antes de ejecutar.";
    return;
  }

  if (data.type === "executionResult") {
    const result = data.result;
    const runtimeName = data.runtimeId === "claude-code"
      ? "Claude Code"
      : data.runtimeId === "codex" ? "Codex" : "OpenCode";
    executeButton.disabled = false;
    analyzeButton.disabled = false;
    cancelExecutionButton.disabled = true;
    executeClaudeButton.disabled = !claudeAvailable;
    claudeInteractiveButton.disabled = !claudeAvailable;
    executeCodexButton.disabled = !codexAvailable;
    codexInteractiveButton.disabled = !codexAvailable;
    interactiveFallbackButton.disabled = !isRuntimeAvailable(data.runtimeId);
    if (result.status === "succeeded") {
      executionStatus.textContent = `${runtimeName} terminó correctamente.`;
    } else if (result.status === "cancelled") {
      executionStatus.textContent = "Ejecución cancelada.";
    } else {
      executionStatus.textContent = result.error || `${runtimeName} terminó con un error.`;
    }
    if (result.runtimeUnavailable) {
      if (data.runtimeId === "claude-code") {
        claudeAvailable = false;
        setStateChip(claudeAvailability, "No disponible", "unavailable");
        executeClaudeButton.disabled = true;
        claudeInteractiveButton.disabled = true;
        claudeRuntimeStatus.textContent = "Claude Code quedó temporalmente no disponible por autenticación o cuota.";
      }
      if (data.runtimeId === "codex") {
        codexAvailable = false;
        setStateChip(codexAvailability, "No disponible", "unavailable");
        executeCodexButton.disabled = true;
        codexInteractiveButton.disabled = true;
        codexRuntimeStatus.textContent = "Codex quedó temporalmente no disponible por autenticación o cuota.";
      }
    }
    return;
  }

  if (data.type === "executionError") {
    executeButton.disabled = false;
    analyzeButton.disabled = false;
    cancelExecutionButton.disabled = true;
    executeClaudeButton.disabled = !claudeAvailable;
    claudeInteractiveButton.disabled = !claudeAvailable;
    executeCodexButton.disabled = !codexAvailable;
    codexInteractiveButton.disabled = !codexAvailable;
    claudeLoginButton.disabled = !claudeInstalled;
    codexLoginButton.disabled = !codexInstalled;
    interactiveFallbackButton.disabled = !isRuntimeAvailable(latestDecision?.selected.runtimeId);
    executionStatus.textContent = data.message;
    return;
  }

  if (data.type === "interactiveFallbackOpened") {
    executeButton.disabled = false;
    executeClaudeButton.disabled = !claudeAvailable;
    executeCodexButton.disabled = !codexAvailable;
    claudeInteractiveButton.disabled = !claudeAvailable;
    codexInteractiveButton.disabled = !codexAvailable;
    analyzeButton.disabled = false;
    interactiveFallbackButton.disabled = !isRuntimeAvailable(latestDecision?.selected.runtimeId);
    cancelExecutionButton.disabled = true;
    executionStatus.textContent = "Terminal interactiva abierta. Las aprobaciones quedan bajo tu control.";
    return;
  }

  if (data.type === "claudeInteractiveOpened") {
    executeButton.disabled = false;
    executeCodexButton.disabled = !codexAvailable;
    analyzeButton.disabled = false;
    executeClaudeButton.disabled = !claudeAvailable;
    claudeInteractiveButton.disabled = !claudeAvailable;
    cancelExecutionButton.disabled = true;
    executionStatus.textContent = "Claude Code interactivo abierto. Las aprobaciones quedan bajo tu control.";
    return;
  }

  if (data.type === "codexInteractiveOpened") {
    executeButton.disabled = false;
    executeClaudeButton.disabled = !claudeAvailable;
    analyzeButton.disabled = false;
    executeCodexButton.disabled = !codexAvailable;
    codexInteractiveButton.disabled = !codexAvailable;
    cancelExecutionButton.disabled = true;
    executionStatus.textContent = "Codex interactivo abierto. Revisá las aprobaciones en la terminal.";
    return;
  }

  if (data.type === "error") {
    status.dataset.state = "error";
    status.textContent = data.message;
    analyzeButton.disabled = false;
    applyOverrideButton.disabled = !latestDecision;
    executeClaudeButton.disabled = !latestDecision || !claudeAvailable;
    executeCodexButton.disabled = !latestDecision || !codexAvailable;
    executeButton.disabled = !latestDecision;
    return;
  }

  if (data.type === "executed") {
    status.textContent = "OpenCode quedó abierto en un terminal nuevo.";
    executeButton.disabled = false;
    return;
  }

  if (data.type !== "decision") {
    return;
  }

  const decision = data.decision;
  latestDecision = decision;
  analyzeButton.disabled = false;
  document.getElementById("complexity").textContent = decision.complexity;
  document.getElementById("confidence").textContent = `${Math.round(decision.confidence * 100)}% de confianza`;
  document.getElementById("model").textContent = decision.selected.label;
  document.getElementById("route-runtime").textContent = `${decision.selected.runtimeId} · proveedor ${decision.selected.providerId}`;
  document.getElementById("model-id").textContent = decision.selected.id;
  document.getElementById("reason").textContent = decision.reason;
  document.getElementById("impact").textContent = decision.selected.usageImpact;
  const allowance = document.getElementById("allowance");
  const allowanceValue = decision.remainingPercent === undefined
    ? "No disponible"
    : `${decision.remainingPercent}% restante`;
  const allowanceSource = decision.allowanceSource
    ? ` · ${decision.allowanceSource}${decision.allowanceObservedAt === undefined ? "" : ` · consultado ${formatUsageTime(decision.allowanceObservedAt)}`}`
    : "";
  allowance.textContent = `${decision.allowancePoolId} · ${allowanceValue}${allowanceSource}`;
  document.getElementById("total-score").textContent = `${decision.selectedScore.total.toFixed(0)}/100`;
  const scoreLabels = {
    taskFit: "Ajuste a la tarea",
    usagePressure: "Impacto relativo",
    contextFit: "Contexto",
    capabilityFit: "Capacidades",
    availability: "Disponibilidad",
    expiration: "Vigencia",
    allowance: "Cupo oficial",
  };
  document.getElementById("score-components").replaceChildren(
    ...Object.entries(scoreLabels).map(([key, label]) => {
      const item = document.createElement("li");
      const value = decision.selectedScore[key];
      item.textContent = `${label}: ${value === null ? "No disponible" : `${Math.round(value)}/100`}`;
      return item;
    }),
  );

  const alternatives = document.getElementById("alternatives");
  alternatives.replaceChildren(
    ...decision.alternatives.map((model, index) => {
      const item = document.createElement("li");
      item.textContent = `${model.label} · ${model.runtimeId}/${model.providerId} · ${decision.alternativeScores[index].total.toFixed(0)}/100 · cupo ${model.allowancePoolId}`;
      return item;
    }),
  );

  const overrideCandidates = [decision.selected, ...decision.alternatives];
  const overrideOptions = overrideCandidates.map((model) => {
    const option = document.createElement("option");
    option.value = JSON.stringify({
      runtimeId: model.runtimeId,
      providerId: model.providerId,
      id: model.id,
      allowancePoolId: model.allowancePoolId,
    });
    option.textContent = `${model.label} · ${model.runtimeId}/${model.providerId} · pool ${model.allowancePoolId}`;
    option.selected = model.id === decision.selected.id
      && model.runtimeId === decision.selected.runtimeId
      && model.providerId === decision.selected.providerId
      && model.allowancePoolId === decision.selected.allowancePoolId;
    return option;
  });
  overrideCandidateSelect.replaceChildren(...overrideOptions);
  applyOverrideButton.disabled = false;

  status.dataset.state = "selected";
  status.textContent = decision.manualOverride
    ? "Override aplicado. Revisá el nuevo runtime, cupo y puntaje antes de ejecutar."
    : "Ruta automática lista. Revisala antes de ejecutar.";
  executeButton.disabled = false;
  interactiveFallbackButton.disabled = !isRuntimeAvailable(decision.selected.runtimeId);
  claudeActions.classList.remove("hidden");
  executeClaudeButton.disabled = !claudeAvailable;
  claudeInteractiveButton.disabled = !claudeAvailable;
  codexActions.classList.remove("hidden");
  executeCodexButton.disabled = !codexAvailable;
  codexInteractiveButton.disabled = !codexAvailable;
  decisionPanel.classList.remove("hidden");
});

function renderExecutionEvent(event) {
  if (event.type === "started") {
    executionStatus.textContent = currentExecutionRuntime === "claude-code"
      ? "Claude Code está trabajando…"
      : currentExecutionRuntime === "codex" ? "Codex está trabajando…" : "OpenCode está trabajando…";
    return;
  }
  if (event.type === "text") {
    const line = document.createElement("p");
    line.className = "execution-text";
    line.textContent = event.text || "";
    executionOutput.append(line);
    return;
  }

  if (event.type === "approval_required") {
    executionStatus.textContent = "Se requiere una aprobación interactiva. Abrí la terminal para continuar.";
  }
  if (event.message) {
    const line = document.createElement("p");
    line.className = `execution-${event.type}`;
    const labels = {
      step: "PASO",
      tool: "HERRAMIENTA",
      diagnostic: "INFO",
      approval_required: "APROBACIÓN",
      error: "ERROR",
      completed: "FINALIZÓ",
      cancelled: "CANCELÓ",
    };
    const label = labels[event.type];
    line.textContent = label ? `${label} · ${event.message}` : event.message;
    executionOutput.append(line);
  }
}

function renderUsageSnapshot(snapshot) {
  refreshUsageButton.disabled = false;
  const age = Date.now() - snapshot.observedAt;
  const stale = snapshot.freshness === "stale" || !Number.isFinite(age) || age < 0 || age >= 5 * 60 * 1000;
  const available = snapshot.status === "available" && snapshot.freshness === "fresh" && !stale;
  if (!available) {
    usageStatus.textContent = stale || snapshot.freshness === "stale"
      ? "No disponible · el dato venció; actualizá para consultar de nuevo."
      : snapshot.status === "unknown"
        ? "No disponible · no se validó una respuesta oficial; no se estima el saldo."
        : "No disponible · OpenCode no informó un porcentaje oficial para esta cuenta.";
    usageWindows.replaceChildren();
    return;
  }

  const observed = formatUsageTime(snapshot.observedAt);
  usageStatus.textContent = `Fuente: ${snapshot.source} · última consulta: ${observed}`;
  const labels = { rolling: "Ventana móvil (5 h)", weekly: "Semanal", monthly: "Mensual" };
  usageWindows.replaceChildren(
    ...snapshot.windows.map((window) => {
      const item = document.createElement("li");
      item.textContent = `${labels[window.window]}: ${window.remainingPercent}% restante · reinicia ${formatUsageTime(window.resetsAt)} · ${snapshot.source} · consultado ${observed}`;
      return item;
    }),
  );
}

function formatUsageTime(timestamp) {
  return new Date(timestamp).toLocaleString("es-AR");
}

function setStateChip(element, label, state) {
  element.textContent = label;
  element.dataset.state = state;
}

function availabilityLabel(availability) {
  if (availability === "available") return "Disponible";
  if (availability === "expired") return "Vencido";
  return "No disponible";
}

function isRuntimeAvailable(runtimeId) {
  if (runtimeId === "opencode") return opencodeAvailable;
  if (runtimeId === "claude-code") return claudeAvailable;
  if (runtimeId === "codex") return codexAvailable;
  return false;
}

setInterval(() => {
  if (latestUsageSnapshot) {
    renderUsageSnapshot(latestUsageSnapshot);
  }
}, 30 * 1000);
