import { routePrompt } from "./router";
import {
  Complexity,
  RoutingDecision,
  RoutingProfile,
  RuntimeExecutionResult,
  RuntimeModel,
  UsageSnapshot,
} from "./types";

export const EVALUATION_HISTORY_KEY = "cheprompt.evaluationHistory.v1";
export const MAX_EVALUATION_RECORDS = 100;

export type VerificationOutcome = "unverified" | "passed" | "failed" | "not-run";

export interface EvaluationCase {
  id: string;
  title: string;
  category: string;
  complexity: Complexity;
  profile: RoutingProfile;
  /** Synthetic fixture text only; production prompts are never copied to history. */
  prompt: string;
}

/** Synthetic, repo-owned tasks. They do not contain user prompts or account data. */
export const evaluationCases: readonly EvaluationCase[] = Object.freeze([
  { id: "case-01", title: "Renombrar variable", category: "small-edit", complexity: "simple", profile: "economy", prompt: "Renombrá la variable total a subtotal en esta función y no cambies otra cosa." },
  { id: "case-02", title: "Corregir typo", category: "small-edit", complexity: "simple", profile: "economy", prompt: "Corregí este typo en el README y conservá el tono actual." },
  { id: "case-03", title: "Explicar función", category: "explanation", complexity: "simple", profile: "balanced", prompt: "Explicá en dos frases qué hace la función de normalización." },
  { id: "case-04", title: "Formatear configuración", category: "formatting", complexity: "simple", profile: "economy", prompt: "Formateá el JSON de configuración sin cambiar sus valores." },
  { id: "case-05", title: "Resumir cambios", category: "summary", complexity: "simple", profile: "balanced", prompt: "Resumí los cambios de este diff en tres viñetas." },
  { id: "case-06", title: "Validar entrada", category: "implementation", complexity: "standard", profile: "balanced", prompt: "Implementá validación de entrada para el formulario y agregá tests de casos válidos e inválidos." },
  { id: "case-07", title: "Agregar paginación", category: "implementation", complexity: "standard", profile: "balanced", prompt: "Agregá paginación al endpoint de artículos y cubrí los límites con pruebas." },
  { id: "case-08", title: "Diagnosticar login", category: "debugging", complexity: "standard", profile: "balanced", prompt: "Investigá por qué falla el login cuando vence la sesión y proponé un arreglo con tests." },
  { id: "case-09", title: "Parsear fechas", category: "implementation", complexity: "standard", profile: "balanced", prompt: "Implementá un parser ISO 8601 que rechace fechas inválidas y documentá sus errores." },
  { id: "case-10", title: "Cubrir rama de error", category: "testing", complexity: "standard", profile: "economy", prompt: "Agregá pruebas para la rama de error de la función de carga y corregí el fallo que revelen." },
  { id: "case-11", title: "Eliminar duplicación", category: "refactoring", complexity: "standard", profile: "balanced", prompt: "Refactorizá los dos validadores duplicados en un helper común sin cambiar la API." },
  { id: "case-12", title: "Documentar CLI", category: "documentation", complexity: "standard", profile: "economy", prompt: "Actualizá la documentación del CLI con los argumentos actuales y un ejemplo de uso." },
  { id: "case-13", title: "Manejar campo opcional", category: "implementation", complexity: "standard", profile: "balanced", prompt: "Corregí el manejo del campo opcional en el adaptador y agregá una prueba de regresión." },
  { id: "case-14", title: "Añadir índice", category: "database", complexity: "standard", profile: "balanced", prompt: "Añadí un índice para acelerar la búsqueda por fecha y verificá que la migración sea reversible." },
  { id: "case-15", title: "Revisar búsqueda", category: "performance", complexity: "standard", profile: "quality", prompt: "Medí la búsqueda lineal actual y proponé una mejora acotada con una prueba de rendimiento." },
  { id: "case-16", title: "Auditar middleware", category: "security", complexity: "complex", profile: "quality", prompt: "Auditá la seguridad del middleware de autenticación, encontrá la causa raíz de los riesgos y agregá pruebas." },
  { id: "case-17", title: "Migrar módulos", category: "architecture", complexity: "complex", profile: "quality", prompt: "Rediseñá la arquitectura para migrar tres módulos sin romper compatibilidad y proponé un plan por etapas." },
  { id: "case-18", title: "Resolver carrera", category: "concurrency", complexity: "complex", profile: "quality", prompt: "Investigá una condición de carrera en el servicio distribuido, identificá su causa raíz y verificá el arreglo." },
  { id: "case-19", title: "Compatibilidad de base", category: "database", complexity: "complex", profile: "balanced", prompt: "Diseñá una migración de base compatible hacia atrás con rollback, pruebas de concurrencia y observabilidad." },
  { id: "case-20", title: "Rendimiento multi-servicio", category: "performance", complexity: "complex", profile: "quality", prompt: "Analizá el cuello de botella de producción entre servicios, compará alternativas y proponé una refactorización segura." },
]);

export interface RoutingEvaluationResult {
  caseId: string;
  title: string;
  expectedComplexity: Complexity;
  detectedComplexity: Complexity;
  profile: RoutingProfile;
  runtimeId: string;
  providerId: string;
  modelId: string;
  allowancePoolId: string;
  score: number;
  alternatives: string[];
}

export interface EvaluationRecord {
  id: string;
  recordedAt: string;
  evaluationCaseId?: string;
  evaluationCaseTitle?: string;
  complexity: Complexity;
  profile: RoutingProfile;
  runtimeId: string;
  providerId: string;
  modelId: string;
  modelLabel: string;
  allowancePoolId: string;
  routingReason: string;
  routingScore: number;
  executionStatus: RuntimeExecutionResult["status"];
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  usageSource?: string;
  /** CLI-reported retry events, or null when the runtime does not report them. */
  retries: number | null;
  verificationOutcome: VerificationOutcome;
  verifiedAt?: string;
}

export function evaluateRoutingSet(
  candidates: readonly RuntimeModel[],
  asOf: number,
  usageSnapshots: readonly UsageSnapshot[] = [],
): RoutingEvaluationResult[] {
  return evaluationCases.map((evaluationCase) => {
    const decision = routePrompt(
      evaluationCase.prompt,
      evaluationCase.profile,
      candidates,
      asOf,
      usageSnapshots,
    );
    return {
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      expectedComplexity: evaluationCase.complexity,
      detectedComplexity: decision.complexity,
      profile: evaluationCase.profile,
      runtimeId: decision.selected.runtimeId,
      providerId: decision.selected.providerId,
      modelId: decision.selected.id,
      allowancePoolId: decision.allowancePoolId,
      score: decision.selectedScore.total,
      alternatives: decision.alternatives.map((model) => `${model.runtimeId}/${model.providerId}/${model.id}`),
    };
  });
}

export function evaluationCaseForPrompt(prompt: string): EvaluationCase | undefined {
  const normalized = normalizePrompt(prompt);
  return evaluationCases.find((evaluationCase) => normalizePrompt(evaluationCase.prompt) === normalized);
}

export function createEvaluationRecord(
  prompt: string,
  decision: RoutingDecision,
  result: RuntimeExecutionResult,
  startedAt: number,
  recordedAt = Date.now(),
): EvaluationRecord {
  const evaluationCase = evaluationCaseForPrompt(prompt);
  const inputTokens = safeTokenCount(result.usage?.inputTokens);
  const outputTokens = safeTokenCount(result.usage?.outputTokens);
  return {
    id: result.executionId,
    recordedAt: new Date(recordedAt).toISOString(),
    ...(evaluationCase ? { evaluationCaseId: evaluationCase.id, evaluationCaseTitle: evaluationCase.title } : {}),
    complexity: decision.complexity,
    profile: decision.profile,
    runtimeId: decision.selected.runtimeId,
    providerId: decision.selected.providerId,
    modelId: decision.selected.id,
    modelLabel: decision.selected.label,
    allowancePoolId: decision.allowancePoolId,
    routingReason: decision.reason,
    routingScore: decision.selectedScore.total,
    executionStatus: result.status,
    latencyMs: Math.max(0, Math.round(recordedAt - startedAt)),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(inputTokens === undefined && outputTokens === undefined ? {} : { usageSource: result.usage?.source }),
    retries: result.retries === undefined ? null : Math.max(0, Math.floor(result.retries)),
    verificationOutcome: "unverified",
  };
}

export function appendEvaluationRecord(
  records: readonly EvaluationRecord[],
  record: EvaluationRecord,
): EvaluationRecord[] {
  return [...records, record].slice(-MAX_EVALUATION_RECORDS);
}

export function updateVerificationOutcome(
  records: readonly EvaluationRecord[],
  recordId: string,
  outcome: VerificationOutcome,
  verifiedAt = new Date().toISOString(),
): EvaluationRecord[] {
  return records.map((record) => record.id !== recordId
    ? record
    : {
      ...record,
      verificationOutcome: outcome,
      ...(outcome === "unverified" ? { verifiedAt: undefined } : { verifiedAt }),
    });
}

export function loadEvaluationHistory(value: unknown): EvaluationRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isEvaluationRecord)
    .slice(-MAX_EVALUATION_RECORDS);
}

function isEvaluationRecord(value: unknown): value is EvaluationRecord {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    "id", "recordedAt", "evaluationCaseId", "evaluationCaseTitle", "complexity", "profile",
    "runtimeId", "providerId", "modelId", "modelLabel", "allowancePoolId", "routingReason",
    "routingScore", "executionStatus", "latencyMs", "inputTokens", "outputTokens", "usageSource",
    "retries", "verificationOutcome", "verifiedAt",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  return typeof value.id === "string"
    && typeof value.recordedAt === "string"
    && (value.evaluationCaseId === undefined || typeof value.evaluationCaseId === "string")
    && (value.evaluationCaseTitle === undefined || typeof value.evaluationCaseTitle === "string")
    && ["simple", "standard", "complex"].includes(String(value.complexity))
    && ["economy", "balanced", "quality"].includes(String(value.profile))
    && typeof value.runtimeId === "string"
    && typeof value.providerId === "string"
    && typeof value.modelId === "string"
    && typeof value.modelLabel === "string"
    && typeof value.allowancePoolId === "string"
    && typeof value.routingReason === "string"
    && typeof value.routingScore === "number"
    && Number.isFinite(value.routingScore)
    && ["succeeded", "failed", "cancelled"].includes(String(value.executionStatus))
    && typeof value.latencyMs === "number"
    && Number.isFinite(value.latencyMs)
    && (value.inputTokens === undefined || safeTokenCount(value.inputTokens) !== undefined)
    && (value.outputTokens === undefined || safeTokenCount(value.outputTokens) !== undefined)
    && (value.usageSource === undefined || typeof value.usageSource === "string")
    && (value.retries === null || (typeof value.retries === "number" && Number.isFinite(value.retries)))
    && (value.verifiedAt === undefined || typeof value.verifiedAt === "string")
    && ["unverified", "passed", "failed", "not-run"].includes(String(value.verificationOutcome));
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
