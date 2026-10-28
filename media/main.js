const vscode = acquireVsCodeApi();

const promptInput = document.getElementById("prompt");
const profileInput = document.getElementById("profile");
const analyzeButton = document.getElementById("analyze");
const executeButton = document.getElementById("execute");
const decisionPanel = document.getElementById("decision");
const status = document.getElementById("status");
const inventoryStatus = document.getElementById("inventory-status");
const inventoryModels = document.getElementById("inventory-models");

profileInput.value = document.body.dataset.defaultProfile || "balanced";

analyzeButton.addEventListener("click", () => {
  status.textContent = "Analizando complejidad, costo relativo y capacidad…";
  decisionPanel.classList.add("hidden");
  vscode.postMessage({
    type: "analyze",
    prompt: promptInput.value,
    profile: profileInput.value,
  });
});

executeButton.addEventListener("click", () => {
  executeButton.disabled = true;
  status.textContent = "Abriendo OpenCode…";
  vscode.postMessage({ type: "execute" });
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
  decisionPanel.classList.remove("hidden");
});
