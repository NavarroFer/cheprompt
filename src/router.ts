import {
  Complexity,
  ModelCandidate,
  RoutingDecision,
  RoutingProfile,
} from "./types";

const MODELS: Record<string, ModelCandidate> = {
  luna: {
    id: "opencode-go/gpt-6-luna",
    label: "GPT 6 Luna",
    usageImpact: "low",
    strengths: ["tareas breves", "iteraciones rápidas", "cambios acotados"],
  },
  argon: {
    id: "opencode-go/gemini-4-argon",
    label: "Gemini 4 Argon",
    usageImpact: "medium",
    strengths: ["contexto amplio", "análisis de código", "trabajo de varias etapas"],
  },
  kimi: {
    id: "opencode-go/kimi-k3.1-pro",
    label: "Kimi K3.1 Pro",
    usageImpact: "high",
    strengths: ["problemas complejos", "arquitectura", "implementación agentic"],
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
  const selected = chooseModel(profile, complexity);
  const alternatives = Object.values(MODELS).filter((model) => model.id !== selected.id);
  const matchedSignals = [...complexMatches, ...simpleMatches].slice(0, 5);
  const confidence = Math.min(0.92, 0.62 + Math.abs(score - 1) * 0.08);

  return {
    profile,
    complexity,
    selected,
    alternatives,
    matchedSignals,
    confidence,
    pricing: "Incluido en OpenCode Go; el impacto indica presión relativa sobre sus límites.",
    reason: buildReason(profile, complexity, selected, matchedSignals),
  };
}

function chooseModel(profile: RoutingProfile, complexity: Complexity): ModelCandidate {
  if (profile === "economy") {
    return complexity === "complex" ? MODELS.argon : MODELS.luna;
  }

  if (profile === "quality") {
    return complexity === "simple" ? MODELS.argon : MODELS.kimi;
  }

  if (complexity === "simple") {
    return MODELS.luna;
  }

  if (complexity === "complex") {
    return MODELS.kimi;
  }

  return MODELS.argon;
}

function buildReason(
  profile: RoutingProfile,
  complexity: Complexity,
  model: ModelCandidate,
  matchedSignals: string[],
): string {
  const signalText = matchedSignals.length
    ? ` Detectamos: ${matchedSignals.join(", ")}.`
    : " No detectamos señales de riesgo o complejidad extraordinaria.";

  return `El perfil ${profile} y una complejidad ${complexity} favorecen ${model.label}, cuya base inicial prioriza ${model.strengths.join(", ")}.${signalText}`;
}

export const routingCatalog = Object.freeze(Object.values(MODELS));
