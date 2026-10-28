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
const status = document.getElementById("status");
const inventoryStatus = document.getElementById("inventory-status");
const inventoryModels = document.getElementById("inventory-models");
const usageStatus = document.getElementById("usage-status");
const usageWindows = document.getElementById("usage-windows");
const refreshUsageButton = document.getElementById("refresh-usage");
let latestUsageSnapshot;

profileInput.value = document.body.dataset.defaultProfile || "balanced";

analyzeButton.addEventListener("click", () => {
  status.textContent = "Analizando complejidad, costo relativo y capacidad…";
  decisionPanel.classList.add("hidden");
  executionPanel.classList.add("hidden");
  executionOutput.replaceChildren();
  vscode.postMessage({
    type: "analyze",
    prompt: promptInput.value,
    profile: profileInput.value,
  });
});

executeButton.addEventListener("click", () => {
  executeButton.disabled = true;
  executionPanel.classList.remove("hidden");
  analyzeButton.disabled = true;
  executionOutput.replaceChildren();
  executionStatus.textContent = "Iniciando OpenCode…";
  cancelExecutionButton.disabled = false;
  vscode.postMessage({ type: "execute" });
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
  usageStatus.textContent = "Actualizando límites oficiales…";
  vscode.postMessage({ type: "refreshUsage" });
});

window.addEventListener("message", ({ data }) => {
  if (data.type === "inventoryError") {
    inventoryStatus.textContent = data.message;
    status.textContent = data.message;
    return;
  }

  if (data.type === "inventory") {
    const { runtime, providers, models } = data.inventory;
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

  if (data.type === "executionEvent") {
    renderExecutionEvent(data.event);
    return;
  }

  if (data.type === "executionResult") {
    const result = data.result;
    executeButton.disabled = false;
    analyzeButton.disabled = false;
    cancelExecutionButton.disabled = true;
    if (result.status === "succeeded") {
      executionStatus.textContent = "OpenCode terminó correctamente.";
    } else if (result.status === "cancelled") {
      executionStatus.textContent = "Ejecución cancelada.";
    } else {
      executionStatus.textContent = result.error || "OpenCode terminó con un error. Podés continuar en la terminal interactiva.";
    }
    interactiveFallbackButton.disabled = false;
    return;
  }

  if (data.type === "executionError") {
    executeButton.disabled = false;
    analyzeButton.disabled = false;
    cancelExecutionButton.disabled = true;
    interactiveFallbackButton.disabled = false;
    executionStatus.textContent = data.message;
    return;
  }

  if (data.type === "interactiveFallbackOpened") {
    analyzeButton.disabled = false;
    interactiveFallbackButton.disabled = false;
    cancelExecutionButton.disabled = true;
    executionStatus.textContent = "Terminal interactiva abierta. Las aprobaciones quedan bajo tu control.";
    return;
  }

  if (data.type === "error") {
    status.textContent = data.message;
    executeButton.disabled = false;
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
  document.getElementById("complexity").textContent = decision.complexity;
  document.getElementById("confidence").textContent = `${Math.round(decision.confidence * 100)}% de confianza`;
  document.getElementById("model").textContent = decision.selected.label;
  document.getElementById("model-id").textContent = decision.selected.id;
  document.getElementById("reason").textContent = decision.reason;
  document.getElementById("impact").textContent = decision.selected.usageImpact;
  document.getElementById("pricing").textContent = decision.pricing;

  const alternatives = document.getElementById("alternatives");
  alternatives.replaceChildren(
    ...decision.alternatives.map((model) => {
      const item = document.createElement("li");
      item.textContent = `${model.label} · impacto ${model.usageImpact}`;
      return item;
    }),
  );

  status.textContent = "Ruta lista. Revisala antes de ejecutar.";
  executeButton.disabled = false;
  interactiveFallbackButton.disabled = false;
  decisionPanel.classList.remove("hidden");
});

function renderExecutionEvent(event) {
  if (event.type === "started") {
    executionStatus.textContent = "OpenCode está trabajando…";
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
    line.textContent = event.message;
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
      ? "Not available · el dato quedó desactualizado; actualizá para consultar de nuevo."
      : snapshot.status === "unknown"
        ? "Not available · no se pudo validar una respuesta oficial; no se estima el saldo."
        : "Not available · OpenCode no informó un porcentaje oficial para esta cuenta.";
    usageWindows.replaceChildren();
    return;
  }

  const observed = formatUsageTime(snapshot.observedAt);
  usageStatus.textContent = `Fuente: ${snapshot.source} · última consulta: ${observed}`;
  const labels = { rolling: "Rolling (5 horas)", weekly: "Semanal", monthly: "Mensual" };
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

setInterval(() => {
  if (latestUsageSnapshot) {
    renderUsageSnapshot(latestUsageSnapshot);
  }
}, 30 * 1000);
