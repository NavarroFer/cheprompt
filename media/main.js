const vscode = acquireVsCodeApi();

const promptInput = document.getElementById("prompt");
const composerTitle = document.getElementById("composer-title");
const promptAttachments = document.getElementById("prompt-attachments");
const attachImageButton = document.getElementById("attach-image");
const attachInput = document.getElementById("attach-input");
const newConversationButton = document.getElementById("new-conversation");
const profileInput = document.getElementById("profile");
const analyzeButton = document.getElementById("analyze");
const executeButton = document.getElementById("execute");
const interactiveFallbackButton = document.getElementById("interactive-fallback");
const executionPanel = document.getElementById("execution");
const executionStatus = document.getElementById("execution-status");
const executionOutput = document.getElementById("execution-output");
const cancelExecutionButton = document.getElementById("cancel-execution");
const executionChanges = document.getElementById("execution-changes");
const executionChangesTitle = document.getElementById("execution-changes-title");
const executionChangesList = document.getElementById("execution-changes-list");
const decisionPanel = document.getElementById("decision");
const routingNotice = document.getElementById("routing-notice");
const overrideCandidateSelect = document.getElementById("override-candidate");
const applyOverrideButton = document.getElementById("apply-override");
const evaluationCaseSelect = document.getElementById("evaluation-case");
const loadEvaluationCaseButton = document.getElementById("load-evaluation-case");
const parallelTaskInputs = [document.getElementById("parallel-task-1"), document.getElementById("parallel-task-2")];
const parallelIndependent = document.getElementById("parallel-independent");
const analyzeParallelButton = document.getElementById("analyze-parallel");
const executeParallelButton = document.getElementById("execute-parallel");
const cancelParallelButton = document.getElementById("cancel-parallel");
const parallelPlanPanel = document.getElementById("parallel-plan");
const parallelStatus = document.getElementById("parallel-status");
const parallelResults = document.getElementById("parallel-results");
const parallelHistorySummary = document.getElementById("parallel-history-summary");
const parallelHistoryList = document.getElementById("parallel-history-list");
const evaluationHistorySummary = document.getElementById("evaluation-history-summary");
const evaluationHistoryList = document.getElementById("evaluation-history-list");
const verificationControls = document.getElementById("verification-controls");
const verificationStatus = document.getElementById("verification-status");
const verificationPassedButton = document.getElementById("verification-passed");
const verificationFailedButton = document.getElementById("verification-failed");
const verificationNotRunButton = document.getElementById("verification-not-run");
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
let currentEvaluationRecordId;
const evaluationCasesById = new Map();
const workspaceChangeItems = new Map();
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
let pendingAttachments = [];
let conversation;
let turnStarting = false;
let lastSentTurn;
const parallelTaskElements = new Map();
let parallelHistoryRecords = [];

profileInput.value = document.body.dataset.defaultProfile || "balanced";

promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    analyzeButton.click();
  }
});

promptInput.addEventListener("paste", (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const images = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  // Keep pasted text when the clipboard carries both text and an image.
  if (!items.some((item) => item.kind === "string" && item.type === "text/plain")) event.preventDefault();
  void addImageFiles(images);
});

attachImageButton.addEventListener("click", () => {
  attachInput.click();
});

attachInput.addEventListener("change", () => {
  void addImageFiles([...(attachInput.files || [])]);
  attachInput.value = "";
});

newConversationButton.addEventListener("click", () => {
  setConversation(undefined);
  latestDecision = undefined;
  lastSentTurn = undefined;
  decisionPanel.classList.add("hidden");
  claudeActions.classList.add("hidden");
  codexActions.classList.add("hidden");
  executionPanel.classList.add("hidden");
  verificationControls.classList.add("hidden");
  currentEvaluationRecordId = undefined;
  executionOutput.replaceChildren();
  resetWorkspaceChanges();
  executeButton.disabled = true;
  status.dataset.state = "selected";
  status.textContent = "Nueva conversación. Escribí la tarea y ChePrompt elige el modelo.";
  promptInput.focus();
  vscode.postMessage({ type: "newConversation" });
});

analyzeButton.addEventListener("click", () => {
  if (conversation) {
    sendFollowUp(promptInput.value);
    return;
  }
  analyzeButton.disabled = true;
  status.dataset.state = "analyzing";
  status.textContent = "Enrutando… Analizando tarea y disponibilidad.";
  latestDecision = undefined;
  decisionPanel.classList.add("hidden");
  claudeActions.classList.add("hidden");
  codexActions.classList.add("hidden");
  executionPanel.classList.add("hidden");
  verificationControls.classList.add("hidden");
  currentEvaluationRecordId = undefined;
  executionOutput.replaceChildren();
  resetWorkspaceChanges();
  const prompt = promptInput.value;
  const attachments = takePendingAttachments();
  const element = appendUserTurn(prompt, attachments);
  turnStarting = true;
  lastSentTurn = { prompt, attachments, element };
  vscode.postMessage({
    type: "analyze",
    prompt,
    profile: profileInput.value,
    attachments: attachmentPayload(attachments),
  });
  promptInput.value = "";
});

function sendFollowUp(prompt) {
  if (!prompt.trim()) {
    status.dataset.state = "warning";
    status.textContent = "Escribí un mensaje para continuar la conversación.";
    return;
  }
  const attachments = takePendingAttachments();
  const element = appendUserTurn(prompt, attachments);
  turnStarting = true;
  lastSentTurn = { prompt, attachments, element };
  status.dataset.state = "selected";
  status.textContent = `Continuando la conversación con ${conversation.label}…`;
  prepareExecutionPanel(conversation.runtimeId);
  vscode.postMessage({ type: "followUp", prompt, attachments: attachmentPayload(attachments) });
  promptInput.value = "";
}

function setConversation(next) {
  conversation = next;
  composerTitle.textContent = next ? `Seguí la conversación · ${next.label}` : "¿Qué querés resolver?";
  analyzeButton.textContent = next ? "Enviar" : "Dale";
  profileInput.disabled = !!next;
  if (next) newConversationButton.classList.remove("hidden");
  else newConversationButton.classList.add("hidden");
}

function appendUserTurn(prompt, attachments) {
  const turn = document.createElement("div");
  turn.className = "execution-user";
  const text = document.createElement("p");
  text.textContent = prompt.trim();
  turn.append(text);
  if (attachments.length) {
    const images = document.createElement("div");
    images.className = "execution-user-images";
    images.append(...attachments.map((attachment) => {
      const image = document.createElement("img");
      image.src = attachment.url;
      image.alt = attachment.name;
      return image;
    }));
    turn.append(images);
  }
  executionOutput.append(turn);
  return turn;
}

function restoreLastTurn() {
  if (!lastSentTurn) return;
  executionOutput.replaceChildren(...[...executionOutput.children].filter((child) => child !== lastSentTurn.element));
  turnStarting = false;
  if (!promptInput.value) promptInput.value = lastSentTurn.prompt;
  if (!pendingAttachments.length) {
    pendingAttachments = lastSentTurn.attachments;
    renderPendingAttachments();
  }
  lastSentTurn = undefined;
}

async function addImageFiles(files) {
  for (const file of files) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      showComposerWarning(`Podés adjuntar hasta ${MAX_ATTACHMENTS} imágenes por mensaje.`);
      break;
    }
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      showComposerWarning("Solo se pueden adjuntar imágenes PNG, JPEG, GIF o WebP.");
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showComposerWarning("Cada imagen puede pesar hasta 5 MB.");
      continue;
    }
    try {
      const url = await readAsDataUrl(file);
      pendingAttachments.push({ name: file.name || `imagen-${pendingAttachments.length + 1}`, mimeType: file.type, url });
    } catch {
      showComposerWarning("No se pudo leer la imagen.");
    }
  }
  renderPendingAttachments();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function showComposerWarning(message) {
  status.dataset.state = "warning";
  status.textContent = message;
}

function renderPendingAttachments() {
  promptAttachments.replaceChildren(...pendingAttachments.map((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const image = document.createElement("img");
    image.src = attachment.url;
    image.alt = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.textContent = "×";
    remove.title = `Quitar ${attachment.name}`;
    remove.ariaLabel = `Quitar ${attachment.name}`;
    remove.addEventListener("click", () => {
      pendingAttachments.splice(index, 1);
      renderPendingAttachments();
    });
    chip.append(image, remove);
    return chip;
  }));
  if (pendingAttachments.length) promptAttachments.classList.remove("hidden");
  else promptAttachments.classList.add("hidden");
}

function takePendingAttachments() {
  const attachments = pendingAttachments;
  pendingAttachments = [];
  renderPendingAttachments();
  return attachments;
}

function attachmentPayload(attachments) {
  return attachments.map(({ name, mimeType, url }) => ({ name, mimeType, data: url.slice(url.indexOf(",") + 1) }));
}

function resetWorkspaceChanges() {
  workspaceChangeItems.clear();
  executionChangesList.replaceChildren();
  executionChanges.classList.add("hidden");
}

executeButton.addEventListener("click", () => {
  prepareExecutionPanel();
  vscode.postMessage({ type: "execute" });
});

function prepareExecutionPanel(runtimeId = latestDecision?.selected.runtimeId) {
  currentExecutionRuntime = runtimeId || "opencode";
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
  newConversationButton.disabled = true;
  if (!turnStarting && executionOutput.children.length > 0) {
    const retry = document.createElement("p");
    retry.className = "execution-step";
    retry.textContent = `REINTENTO · ${runtimeName}`;
    executionOutput.append(retry);
  }
  turnStarting = false;
  executionStatus.textContent = `Iniciando ${runtimeName}…`;
  cancelExecutionButton.disabled = false;
}

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
  executionStatus.textContent = "Abriendo la terminal interactiva…";
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

loadEvaluationCaseButton.addEventListener("click", () => {
  const evaluationCase = evaluationCasesById.get(evaluationCaseSelect.value);
  if (!evaluationCase) {
    status.dataset.state = "warning";
    status.textContent = "Elegí una tarea sintética de la lista.";
    return;
  }
  promptInput.value = evaluationCase.prompt;
  profileInput.value = evaluationCase.profile;
  promptInput.focus();
  status.dataset.state = "selected";
  status.textContent = `Tarea “${evaluationCase.title}” cargada. Revisala y presioná Dale cuando quieras ejecutarla.`;
});

analyzeParallelButton.addEventListener("click", () => {
  if (!parallelIndependent.checked) {
    parallelStatus.dataset.state = "warning";
    parallelStatus.textContent = "Confirmá que las subtareas son independientes.";
    return;
  }
  parallelPlanPanel.replaceChildren();
  parallelPlanPanel.classList.add("hidden");
  parallelResults.replaceChildren();
  parallelTaskElements.clear();
  executeParallelButton.disabled = true;
  analyzeParallelButton.disabled = true;
  parallelStatus.dataset.state = "analyzing";
  parallelStatus.textContent = "Enrutando cada subtarea por separado…";
  vscode.postMessage({
    type: "analyzeParallel",
    tasks: parallelTaskInputs.map((input) => input.value),
    profile: profileInput.value,
    independenceConfirmed: true,
  });
});

executeParallelButton.addEventListener("click", () => {
  if (!parallelIndependent.checked) {
    parallelStatus.dataset.state = "warning";
    parallelStatus.textContent = "Volvé a confirmar que las subtareas son independientes.";
    return;
  }
  executeParallelButton.disabled = true;
  analyzeParallelButton.disabled = true;
  cancelParallelButton.disabled = false;
  parallelStatus.dataset.state = "running";
  parallelStatus.textContent = "Preparando dos worktrees aislados. No se combinarán los cambios automáticamente.";
  vscode.postMessage({
    type: "executeParallel",
    tasks: parallelTaskInputs.map((input) => input.value),
    profile: profileInput.value,
    independenceConfirmed: true,
  });
});

cancelParallelButton.addEventListener("click", () => {
  cancelParallelButton.disabled = true;
  parallelStatus.textContent = "Cancelando ambas subtareas…";
  vscode.postMessage({ type: "cancelParallel" });
});

verificationPassedButton.addEventListener("click", () => sendVerificationOutcome("passed"));
verificationFailedButton.addEventListener("click", () => sendVerificationOutcome("failed"));
verificationNotRunButton.addEventListener("click", () => sendVerificationOutcome("not-run"));

window.addEventListener("message", ({ data }) => {
  if (data.type === "evaluationState") {
    evaluationCasesById.clear();
    const options = [document.createElement("option")];
    options[0].value = "";
    options[0].textContent = "Seleccioná una tarea…";
    for (const evaluationCase of data.cases || []) {
      evaluationCasesById.set(evaluationCase.id, evaluationCase);
      const option = document.createElement("option");
      option.value = evaluationCase.id;
      option.textContent = `${evaluationCase.title} · ${evaluationCase.complexity}`;
      options.push(option);
    }
    evaluationCaseSelect.replaceChildren(...options);
    renderEvaluationHistory(data.records || []);
    renderParallelHistory(data.parallelHistory || [], true);
    return;
  }

  if (data.type === "parallelHistory") {
    renderParallelHistory(data.records || [], true);
    return;
  }

  if (data.type === "parallelPlan") {
    renderParallelPlan(data);
    executeParallelButton.disabled = !parallelIndependent.checked;
    analyzeParallelButton.disabled = false;
    parallelStatus.dataset.state = data.needsReview ? "warning" : "selected";
    parallelStatus.textContent = data.needsReview
      ? "La ruta o el cupo cambiaron. Revisá ambas rutas actualizadas antes de ejecutar."
      : "Revisá el runtime, modelo y pool asignados a cada subtarea.";
    return;
  }

  if (data.type === "parallelStarted") {
    renderParallelExecution(data.record);
    parallelStatus.dataset.state = "running";
    parallelStatus.textContent = "Las dos subtareas están corriendo en worktrees separados. Las aprobaciones siguen bajo tu control.";
    cancelParallelButton.disabled = false;
    return;
  }

  if (data.type === "parallelEvent") {
    renderParallelEvent(data);
    return;
  }

  if (data.type === "parallelTaskCompleted") {
    renderParallelTaskCompletion(data);
    return;
  }

  if (data.type === "parallelCompleted") {
    renderParallelRunSummary(data.record);
    renderParallelHistory([data.record]);
    cancelParallelButton.disabled = true;
    analyzeParallelButton.disabled = false;
    executeParallelButton.disabled = true;
    parallelStatus.dataset.state = data.record.status === "succeeded" ? "available" : "warning";
    parallelStatus.textContent = data.record.status === "succeeded"
      ? "Ambas subtareas terminaron. Revisá manualmente los worktrees antes de integrar cambios."
      : "La ejecución terminó con resultados parciales o fallidos. Revisá cada worktree.";
    return;
  }

  if (data.type === "parallelError") {
    analyzeParallelButton.disabled = false;
    executeParallelButton.disabled = true;
    cancelParallelButton.disabled = true;
    parallelStatus.dataset.state = "error";
    parallelStatus.textContent = data.message;
    return;
  }

  if (data.type === "evaluationHistory") {
    renderEvaluationHistory(data.records || []);
    if (data.updatedRecordId === currentEvaluationRecordId) {
      verificationStatus.textContent = `Verificación registrada: ${verificationLabel(data.verificationOutcome)}.`;
    }
    return;
  }

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
    lastSentTurn = undefined;
    newConversationButton.disabled = false;
    if (data.conversation) setConversation(data.conversation);
    currentEvaluationRecordId = data.evaluationRecordId;
    if (currentEvaluationRecordId) {
      verificationControls.classList.remove("hidden");
      verificationStatus.textContent = "Marcá el resultado después de comprobarlo. El prompt no se guarda.";
    }
    const runtimeName = data.runtimeId === "claude-code"
      ? "Claude Code"
      : data.runtimeId === "codex" ? "Codex" : "OpenCode";
    executeButton.disabled = data.canExecuteAgain === false || result.status === "succeeded";
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
      executionStatus.textContent = data.handedOff
        ? "Ejecución pasada a la terminal interactiva; sigue en la misma sesión."
        : "Ejecución cancelada.";
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
    executeButton.disabled = isDecisionLocked();
    analyzeButton.disabled = false;
    newConversationButton.disabled = false;
    restoreLastTurn();
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

  if (data.type === "workspaceChanges") {
    for (const change of data.changes || []) renderWorkspaceChange(change);
    return;
  }

  if (data.type === "interactiveFallbackDeclined") {
    interactiveFallbackButton.disabled = !isRuntimeAvailable(latestDecision?.selected.runtimeId);
    if (!cancelExecutionButton.disabled) executionStatus.textContent = "La ejecución sigue en curso.";
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
    restoreLastTurn();
    applyOverrideButton.disabled = !latestDecision || isDecisionLocked();
    executeClaudeButton.disabled = !latestDecision || isDecisionLocked() || !claudeAvailable;
    executeCodexButton.disabled = !latestDecision || isDecisionLocked() || !codexAvailable;
    executeButton.disabled = !latestDecision || isDecisionLocked();
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
  if (decision.routingNotice) {
    routingNotice.textContent = decision.routingNotice.message;
    routingNotice.dataset.kind = decision.routingNotice.kind;
    routingNotice.classList.remove("hidden");
  } else {
    routingNotice.classList.add("hidden");
  }
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
  const noticeKind = decision.routingNotice?.kind;
  status.dataset.state = ["fallback-unavailable", "budget-exhausted"].includes(noticeKind)
    ? "error"
    : noticeKind && noticeKind !== "task-completed" ? "warning" : "selected";
  status.textContent = decision.routingNotice?.message
    ?? (decision.manualOverride
      ? "Override aplicado. Revisá el nuevo runtime, cupo y puntaje antes de ejecutar."
      : "Ruta automática lista. Revisala antes de ejecutar.");
  const decisionLocked = isDecisionLocked(decision);
  executeButton.disabled = decisionLocked;
  interactiveFallbackButton.disabled = decisionLocked || !isRuntimeAvailable(decision.selected.runtimeId);
  claudeActions.classList.remove("hidden");
  executeClaudeButton.disabled = decisionLocked || !claudeAvailable;
  claudeInteractiveButton.disabled = decisionLocked || !claudeAvailable;
  codexActions.classList.remove("hidden");
  executeCodexButton.disabled = decisionLocked || !codexAvailable;
  codexInteractiveButton.disabled = decisionLocked || !codexAvailable;
  applyOverrideButton.disabled = decisionLocked;
  decisionPanel.classList.remove("hidden");
  if (data.autoExecute && !decisionLocked) {
    status.textContent = decision.routingNotice?.message
      ?? `${decision.selected.label} elegido automáticamente. Ejecutando…`;
    applyOverrideButton.disabled = true;
    prepareExecutionPanel();
  }
});

const changeKindLabels = { created: "NUEVO", changed: "MODIFICADO", deleted: "ELIMINADO" };

function renderWorkspaceChange(change) {
  if (!change || typeof change.path !== "string" || !changeKindLabels[change.kind]) return;
  let item = workspaceChangeItems.get(change.path);
  if (!item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "change-item";
    const kind = document.createElement("span");
    kind.className = "change-kind";
    const path = document.createElement("span");
    path.className = "change-path";
    path.textContent = change.path;
    button.append(kind, path);
    button.addEventListener("click", () => {
      vscode.postMessage({ type: "openChange", path: change.path });
    });
    const listItem = document.createElement("li");
    listItem.append(button);
    executionChangesList.append(listItem);
    item = { button, kind };
    workspaceChangeItems.set(change.path, item);
  }
  item.kind.textContent = changeKindLabels[change.kind];
  item.kind.dataset.kind = change.kind;
  item.button.title = `Abrir cambios de ${change.path}`;
  executionChangesTitle.textContent = `Archivos modificados · ${workspaceChangeItems.size}`;
  executionChanges.classList.remove("hidden");
}

function renderExecutionEvent(event) {
  if (event.type === "started") {
    lastSentTurn = undefined;
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

function renderParallelPlan(data) {
  const cards = (data.tasks || []).map((task) => {
    const card = document.createElement("article");
    card.className = "parallel-task-card";
    const title = document.createElement("h3");
    title.textContent = `Subtarea ${task.taskNumber}`;
    const decision = task.decision;
    const route = document.createElement("p");
    route.textContent = `${decision.selected.label} · ${decision.selected.runtimeId}/${decision.selected.providerId} · ${decision.selected.id}`;
    const pool = document.createElement("p");
    pool.textContent = `Pool: ${decision.allowancePoolId} · puntaje ${decision.selectedScore.total.toFixed(0)}/100 · confianza ${Math.round(decision.confidence * 100)}%`;
    const reason = document.createElement("p");
    reason.textContent = decision.reason;
    card.append(title, route, pool, reason);
    return card;
  });
  parallelPlanPanel.replaceChildren(...cards);
  parallelPlanPanel.classList.remove("hidden");
}

function renderParallelExecution(record) {
  parallelTaskElements.clear();
  const cards = (record.tasks || []).map((task) => {
    const card = document.createElement("article");
    card.className = "parallel-task-card";
    const title = document.createElement("h3");
    title.textContent = `Subtarea ${task.taskNumber} · ${task.runtimeId}/${task.modelId}`;
    const taskStatus = document.createElement("p");
    taskStatus.className = "parallel-task-status";
    taskStatus.textContent = parallelStatusLabel(task.status);
    const output = document.createElement("div");
    output.className = "parallel-task-output";
    card.append(title, taskStatus, output);
    renderWorktreeControls(card, record.id, task);
    parallelTaskElements.set(task.id, { card, taskStatus, output });
    return card;
  });
  parallelResults.replaceChildren(...cards);
}

function renderParallelEvent(data) {
  const elements = parallelTaskElements.get(data.taskId);
  if (!elements) return;
  const event = data.event || {};
  if (event.type === "started") {
    elements.taskStatus.textContent = `Ejecutando en ${data.runtimeId}…`;
    return;
  }
  if (event.type === "text") {
    const line = document.createElement("p");
    line.className = "execution-text";
    line.textContent = event.text || "";
    elements.output.append(line);
    return;
  }
  if (event.message) {
    const line = document.createElement("p");
    line.className = `execution-${event.type}`;
    line.textContent = `${String(event.type || "info").replaceAll("_", " ").toUpperCase()} · ${event.message}`;
    elements.output.append(line);
  }
}

function renderParallelTaskCompletion(data) {
  const elements = parallelTaskElements.get(data.taskId);
  const task = data.record;
  if (!elements || !task) return;
  elements.taskStatus.textContent = `${parallelStatusLabel(task.status)}${task.latencyMs === undefined ? "" : ` · ${formatDuration(task.latencyMs)}`}`;
  if (data.error) {
    const error = document.createElement("p");
    error.className = "execution-error";
    error.textContent = data.error;
    elements.output.append(error);
  }
}

function renderParallelRunSummary(record) {
  const summary = document.createElement("p");
  const wall = record.wallClockMs === undefined ? "duración desconocida" : `tiempo total ${formatDuration(record.wallClockMs)}`;
  const serial = record.summedTaskDurationMs === undefined ? "" : ` · suma de tareas ${formatDuration(record.summedTaskDurationMs)}`;
  const saved = record.observedTimeSavedMs === undefined ? "" : ` · diferencia observada ${formatDuration(record.observedTimeSavedMs)}`;
  const usage = record.reportedUsageTaskCount
    ? ` · tokens informados: ${record.aggregateInputTokens ?? "—"} entrada / ${record.aggregateOutputTokens ?? "—"} salida (${record.reportedUsageTaskCount}/2 tareas reportaron uso)`
    : " · tokens: no informados por los CLIs";
  summary.textContent = `Resultado ${record.status} · ${wall}${serial}${saved}${usage}`;
  parallelResults.prepend(summary);
}

function renderParallelHistory(records, replace = false) {
  const byId = new Map(replace ? [] : parallelHistoryRecords.map((record) => [record.id, record]));
  for (const record of records) byId.set(record.id, record);
  parallelHistoryRecords = [...byId.values()].slice(-50).reverse();
  parallelHistorySummary.textContent = parallelHistoryRecords.length
    ? `${parallelHistoryRecords.length} ejecución(es) · se conservan metadatos, no prompts.`
    : "Todavía no hay ejecuciones paralelas.";
  parallelHistoryList.replaceChildren(...parallelHistoryRecords.map((record) => {
    const item = document.createElement("li");
    const wall = record.wallClockMs === undefined ? "en curso" : formatDuration(record.wallClockMs);
    const label = document.createElement("span");
    label.textContent = `${new Date(record.recordedAt).toLocaleString()} · ${record.status} · ${wall}`;
    item.append(label);
    for (const task of record.tasks || []) renderWorktreeControls(item, record.id, task);
    return item;
  }));
}

function renderWorktreeControls(container, runId, task) {
  if (!task.worktreePath || task.worktreeRemoved) return;
  const path = document.createElement("p");
  path.className = "worktree-path mono";
  path.textContent = `Worktree: ${task.worktreePath}`;
  const open = document.createElement("button");
  open.className = "compact secondary";
  open.type = "button";
  open.textContent = "Abrir carpeta";
  open.addEventListener("click", () => vscode.postMessage({
    type: "openParallelWorktree", runId, taskId: task.id,
  }));
  const remove = document.createElement("button");
  remove.className = "compact secondary";
  remove.type = "button";
  remove.textContent = "Quitar worktree";
  remove.addEventListener("click", () => vscode.postMessage({
    type: "removeParallelWorktree", runId, taskId: task.id,
  }));
  container.append(path, open, remove);
}

function parallelStatusLabel(value) {
  return ({
    queued: "En cola",
    running: "En ejecución",
    succeeded: "Finalizada correctamente",
    failed: "Falló",
    cancelled: "Cancelada",
  })[value] || "Estado desconocido";
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
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

function isDecisionLocked(decision = latestDecision) {
  return decision?.routingNotice?.kind === "budget-exhausted"
    || decision?.routingNotice?.kind === "task-completed";
}

setInterval(() => {
  if (latestUsageSnapshot) {
    renderUsageSnapshot(latestUsageSnapshot);
  }
  }, 30 * 1000);

vscode.postMessage({ type: "webviewReady" });

function sendVerificationOutcome(outcome) {
  if (!currentEvaluationRecordId) return;
  vscode.postMessage({
    type: "verificationOutcome",
    recordId: currentEvaluationRecordId,
    outcome,
  });
}

function renderEvaluationHistory(records) {
  const recent = [...records].slice(-8).reverse();
  evaluationHistorySummary.textContent = records.length
    ? `${records.length} ejecuciones guardadas localmente; sin prompts.`
    : "Todavía no hay ejecuciones registradas. No se guarda el texto de tus prompts.";
  evaluationHistoryList.replaceChildren(
    ...recent.map((record) => {
      const item = document.createElement("li");
      const task = record.evaluationCaseTitle || `${record.complexity} · ${record.profile}`;
      const tokens = record.inputTokens !== undefined || record.outputTokens !== undefined
        ? `${record.inputTokens ?? "?"} entrada / ${record.outputTokens ?? "?"} salida`
        : "uso de tokens no reportado";
      const retryLabel = record.runtimeRetries === null
        ? `reintentos ChePrompt ${record.chepromptRetries} · reintentos CLI no reportados`
        : `reintentos ChePrompt ${record.chepromptRetries} · CLI ${record.runtimeRetries}`;
      const failureLabel = record.failureKind ? ` · falla ${record.failureKind}` : "";
      const fallbackLabel = record.fallbackFromRuntime ? ` · fallback desde ${record.fallbackFromRuntime}` : "";
      item.textContent = `${task} · ${record.modelLabel} · ${record.runtimeId}/${record.providerId} · ${record.executionStatus}${failureLabel}${fallbackLabel} · ${record.latencyMs} ms · ${tokens} · ${retryLabel} · verificación ${verificationLabel(record.verificationOutcome)}`;
      const detail = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Motivo de la ruta";
      const reason = document.createElement("p");
      reason.textContent = record.routingReason;
      detail.append(summary, reason);
      item.append(detail);
      return item;
    }),
  );
}

function verificationLabel(outcome) {
  if (outcome === "passed") return "verificado";
  if (outcome === "failed") return "falló";
  if (outcome === "not-run") return "sin probar";
  return "pendiente";
}
