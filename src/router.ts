import {
  Complexity,
  RoutingScoreBreakdown,
  RoutingDecision,
  RoutingOptions,
  RoutingProfile,
  RuntimeModel,
  UsageSnapshot,
  USAGE_SNAPSHOT_MAX_AGE_MS,
} from "./types";

export const LOW_CONFIDENCE_THRESHOLD = 0.65;

const MODELS: Record<string, RuntimeModel> = {
  luna: {
    id: "opencode-go/gpt-6-luna",
    label: "GPT 6 Luna",
    usageImpact: "low",
    strengths: ["tareas breves", "iteraciones rápidas", "cambios acotados"],
    runtimeId: "opencode",
    providerId: "opencode-go",
    allowancePoolId: "opencode-go",
    availability: "available",
    capabilities: ["text", "tools"],
    capabilitiesKnown: true,
  },
  argon: {
    id: "opencode-go/gemini-4-argon",
    label: "Gemini 4 Argon",
    usageImpact: "medium",
    strengths: ["contexto amplio", "análisis de código", "trabajo de varias etapas"],
    runtimeId: "opencode",
    providerId: "opencode-go",
    allowancePoolId: "opencode-go",
    availability: "available",
    capabilities: ["text", "tools"],
    capabilitiesKnown: true,
  },
  kimi: {
    id: "opencode-go/kimi-k3.1-pro",
    label: "Kimi K3.1 Pro",
    usageImpact: "high",
    strengths: ["problemas complejos", "arquitectura", "implementación agentic"],
    runtimeId: "opencode",
    providerId: "opencode-go",
    allowancePoolId: "opencode-go",
    availability: "available",
    capabilities: ["text", "tools", "reasoning"],
    capabilitiesKnown: true,
  },
};

const SIMPLE_SIGNALS = [
  "rename",
  "renombr",
  "typo",
  "ortograf",
  "format",
  "formate",
  "comentario",
  "comment",
  "readme",
  "explica",
  "explain",
  "resume",
  "summar",
];

const COMPLEX_SIGNALS = [
  "arquitectura",
  "architecture",
  "migraci",
  "migration",
  "seguridad",
  "security",
  "concurr",
  "rendimiento",
  "performance",
  "producci",
  "production",
  "distribuido",
  "distributed",
  "redise",
  "redesign",
  "refactor completo",
  "root cause",
  "causa raíz",
];

export function routePrompt(
  rawPrompt: string,
  profile: RoutingProfile,
  candidates: readonly RuntimeModel[] = [],
  asOf?: number,
  usageSnapshots: readonly UsageSnapshot[] = [],
  options: RoutingOptions = {},
): RoutingDecision {
  const prompt = rawPrompt.trim();
  if (!prompt) {
    throw new Error("Escribí una tarea antes de analizarla.");
  }

  const normalized = prompt.toLocaleLowerCase("es");
  const simpleMatches = SIMPLE_SIGNALS.filter((signal) => normalized.includes(signal));
  const complexMatches = COMPLEX_SIGNALS.filter((signal) => normalized.includes(signal));
  const lineCount = prompt.split(/\r?\n/).filter(Boolean).length;

  let score = 1;
  score += complexMatches.length * 2;
  score += prompt.length > 700 ? 2 : 0;
  score += lineCount >= 8 ? 1 : 0;
  score -= prompt.length < 220 && simpleMatches.length > 0 ? 1 : 0;

  const complexity: Complexity = score >= 4 ? "complex" : score <= 0 ? "simple" : "standard";
  const evaluationTime = asOf ?? 0;
  const available = candidates.filter((candidate) => isEligible(candidate, asOf, usageSnapshots));
  if (!available.length) {
    throw new Error("No hay modelos disponibles y vigentes para analizar esta tarea.");
  }
  const eligible = options.requiresVision
    ? available.filter((candidate) => candidate.capabilities.includes("vision"))
    : available;
  if (!eligible.length) {
    throw new Error("Ningún modelo disponible informa que acepta imágenes. Quitá la imagen o habilitá un runtime que las soporte.");
  }

  const analysis = analyzeTask(prompt, normalized, complexity, [...complexMatches, ...simpleMatches]);
  if (options.requiresVision) analysis.needsVision = true;
  const scored = eligible
    .map((model) => ({
      model,
      score: scoreCandidate(model, profile, analysis, evaluationTime, usageSnapshots),
    }))
    .sort((left, right) => right.score.total - left.score.total);
  const selected = scored[0].model;
  const alternatives = scored.slice(1, 3).map((candidate) => candidate.model);
  const alternativeScores = scored.slice(1, 3).map((candidate) => candidate.score);
  const matchedSignals = [...complexMatches, ...simpleMatches].slice(0, 5);
  const confidence = confidenceFromScores(scored.map((candidate) => candidate.score.total));
  const usage = freshUsageForPool(selected.allowancePoolId, usageSnapshots, evaluationTime);
  const routingNotice = confidence < LOW_CONFIDENCE_THRESHOLD
    ? {
      kind: "low-confidence" as const,
      message: "La diferencia entre candidatos es baja; revisá las alternativas antes de ejecutar.",
    }
    : undefined;

  return {
    profile,
    complexity,
    selected,
    alternatives,
    selectedScore: scored[0].score,
    alternativeScores,
    allowancePoolId: selected.allowancePoolId,
    ...(usage ? {
      allowanceSource: usage.snapshot.source,
      allowanceObservedAt: usage.snapshot.observedAt,
      remainingPercent: usage.remainingPercent,
    } : {}),
    ...(routingNotice ? { routingNotice } : {}),
    matchedSignals,
    confidence,
    pricing: buildPricing(selected),
    reason: buildReason(profile, complexity, selected, matchedSignals, scored[0].score),
  };
}

interface TaskAnalysis {
  complexity: Complexity;
  normalizedPrompt: string;
  estimatedTokens: number;
  matchedSignals: readonly string[];
  needsTools: boolean;
  needsVision: boolean;
}

interface FreshPoolUsage {
  snapshot: UsageSnapshot;
  remainingPercent: number;
}

type RoutingWeights = {
  [Key in keyof Omit<RoutingScoreBreakdown, "total">]: number;
};

const PROFILE_WEIGHTS: Record<RoutingProfile, RoutingWeights> = {
  economy: {
    taskFit: 0.25,
    usagePressure: 0.4,
    contextFit: 0.1,
    capabilityFit: 0.05,
    availability: 0.05,
    expiration: 0.05,
    allowance: 0.1,
  },
  balanced: {
    taskFit: 0.35,
    usagePressure: 0.15,
    contextFit: 0.15,
    capabilityFit: 0.15,
    availability: 0.05,
    expiration: 0.05,
    allowance: 0.1,
  },
  quality: {
    taskFit: 0.55,
    usagePressure: 0.05,
    contextFit: 0.1,
    capabilityFit: 0.15,
    availability: 0.05,
    expiration: 0.05,
    allowance: 0.05,
  },
};

const IMPACT_SCORE: Record<RuntimeModel["usageImpact"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function analyzeTask(prompt: string, normalizedPrompt: string, complexity: Complexity, matchedSignals: string[]): TaskAnalysis {
  return {
    complexity,
    normalizedPrompt,
    estimatedTokens: Math.ceil(prompt.length / 4),
    matchedSignals,
    needsTools: /\b(implement|implementa|fix|arregl|edit|modific|refactor|test|prueba|build|compil|run|ejecut)\b/i.test(normalizedPrompt),
    needsVision: /\b(imagen|captura|screenshot|image|foto|diagram|diagrama)\b/i.test(normalizedPrompt),
  };
}

function isEligible(model: RuntimeModel, asOf: number | undefined, usageSnapshots: readonly UsageSnapshot[]): boolean {
  if (model.availability !== "available") {
    return false;
  }
  if (model.expiresAt) {
    if (asOf === undefined) return false;
    const expiration = Date.parse(model.expiresAt);
    if (!Number.isFinite(expiration) || expiration <= asOf) return false;
  }
  const usage = asOf === undefined ? undefined : freshUsageForPool(model.allowancePoolId, usageSnapshots, asOf);
  return !usage || !usage.snapshot.windows.some((window) => window.limited || window.remainingPercent <= 0);
}

function scoreCandidate(
  model: RuntimeModel,
  profile: RoutingProfile,
  task: TaskAnalysis,
  asOf: number,
  usageSnapshots: readonly UsageSnapshot[],
): RoutingScoreBreakdown {
  const targetImpact = targetImpactFor(profile, task.complexity);
  const modelImpact = IMPACT_SCORE[model.usageImpact];
  const strengthMatches = model.strengths.filter((strength) => task.normalizedPrompt.includes(strength.toLocaleLowerCase("es"))).length;
  const taskFit = clamp(100 - Math.abs(modelImpact - targetImpact) * 28 + Math.min(10, strengthMatches * 5));
  const usagePressure = { low: 100, medium: 65, high: 30 }[model.usageImpact];
  const contextFit = contextScore(model, task.estimatedTokens);
  const capabilityFit = capabilityScore(model, task);
  const expiration = expirationScore(model, asOf);
  const usage = freshUsageForPool(model.allowancePoolId, usageSnapshots, asOf);
  const allowance = usage?.remainingPercent ?? null;
  const components: Omit<RoutingScoreBreakdown, "total"> = {
    taskFit,
    usagePressure,
    contextFit,
    capabilityFit,
    availability: 100,
    expiration,
    allowance,
  };
  const weights = PROFILE_WEIGHTS[profile];
  let weighted = 0;
  let appliedWeight = 0;
  for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
    const value = components[key];
    const weight = weights[key];
    if (value === null) continue;
    weighted += value * weight;
    appliedWeight += weight;
  }
  return { ...components, total: appliedWeight ? weighted / appliedWeight : 0 };
}

function targetImpactFor(profile: RoutingProfile, complexity: Complexity): number {
  if (profile === "economy") return complexity === "complex" ? 1 : 0;
  if (profile === "quality") return complexity === "simple" ? 1 : 2;
  if (complexity === "simple") return 0;
  if (complexity === "complex") return 2;
  return 1;
}

function contextScore(model: RuntimeModel, estimatedTokens: number): number | null {
  if (!model.contextWindowTokens || model.contextWindowTokens <= 0) return null;
  const ratio = estimatedTokens / model.contextWindowTokens;
  if (ratio <= 0.65) return 100;
  if (ratio <= 0.85) return 80;
  if (ratio <= 1) return 45;
  return 0;
}

function capabilityScore(model: RuntimeModel, task: TaskAnalysis): number | null {
  if (model.capabilitiesKnown === false) return null;
  if (task.needsVision && !model.capabilities.includes("vision")) return 0;
  if (task.needsTools && !model.capabilities.includes("tools")) return 0;
  if (task.complexity === "complex" && !model.capabilities.includes("reasoning")) return 65;
  return 100;
}

function expirationScore(model: RuntimeModel, asOf: number): number {
  if (!model.expiresAt) return 100;
  const daysLeft = (Date.parse(model.expiresAt) - asOf) / (24 * 60 * 60 * 1000);
  return clamp((daysLeft / 30) * 100);
}

function freshUsageForPool(
  allowancePoolId: string,
  usageSnapshots: readonly UsageSnapshot[],
  asOf: number,
): FreshPoolUsage | undefined {
  const snapshot = usageSnapshots
    .filter((item) => item.allowancePoolId === allowancePoolId)
    .sort((left, right) => right.observedAt - left.observedAt)
    .find((item) => item.status === "available"
      && item.freshness === "fresh"
      && Number.isFinite(item.observedAt)
      && item.observedAt <= asOf
      && asOf - item.observedAt < USAGE_SNAPSHOT_MAX_AGE_MS
      && item.windows.length > 0);
  if (!snapshot) return undefined;
  if (snapshot.windows.some((window) =>
    !Number.isFinite(window.remainingPercent)
    || window.remainingPercent < 0
    || window.remainingPercent > 100
    || !Number.isFinite(window.resetsAt)
    || typeof window.limited !== "boolean",
  )) return undefined;
  return {
    snapshot,
    remainingPercent: Math.min(...snapshot.windows.map((window) => window.remainingPercent)),
  };
}

function confidenceFromScores(scores: readonly number[]): number {
  if (scores.length < 2) return 0.7;
  return Math.min(0.92, 0.58 + Math.max(0, scores[0] - scores[1]) / 100 * 0.34);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function buildPricing(model: RuntimeModel): string {
  if (model.allowancePoolId === "opencode-go") return "Incluido en OpenCode Go; el cupo oficial se muestra por separado.";
  if (model.allowancePoolId === "claude-pro") return "Incluido en la suscripción Claude Pro; saldo restante: Not available.";
  if (model.allowancePoolId === "chatgpt-codex") return "Incluido en ChatGPT/Codex; saldo restante: Not available.";
  if (model.allowancePoolId === "openai-api") return "API de OpenAI; facturación separada del plan ChatGPT.";
  return `Pool ${model.allowancePoolId}; precio/cupo: Not available.`;
}

function buildReason(
  profile: RoutingProfile,
  complexity: Complexity,
  model: RuntimeModel,
  matchedSignals: string[],
  score: RoutingScoreBreakdown,
): string {
  const signalText = matchedSignals.length
    ? ` Detectamos: ${matchedSignals.join(", ")}.`
    : " No detectamos señales de riesgo o complejidad extraordinaria.";

  return `El perfil ${profile} y la complejidad ${complexity} asignan ${score.total.toFixed(0)}/100 a ${model.label} (${model.runtimeId}/${model.providerId}). Su base inicial prioriza ${model.strengths.join(", ")}.${signalText}`;
}

export const routingCatalog: readonly RuntimeModel[] = Object.freeze(Object.values(MODELS));
