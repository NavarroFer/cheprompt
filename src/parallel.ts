import { randomUUID } from "node:crypto";
import { routePrompt } from "./router";
import {
  RoutingDecision,
  RoutingProfile,
  RuntimeExecutionResult,
  RuntimeFailureKind,
  RuntimeModel,
  UsageSnapshot,
} from "./types";

export const PARALLEL_TASK_COUNT = 2;
export const MAX_PARALLEL_HISTORY = 50;
export const PARALLEL_HISTORY_KEY = "cheprompt.parallelHistory.v1";

export interface ParallelTaskPlan {
  id: string;
  prompt: string;
  decision: RoutingDecision;
}

export interface ParallelPlan {
  id: string;
  profile: RoutingProfile;
  tasks: ParallelTaskPlan[];
}

export type ParallelTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ParallelRunStatus = "running" | "succeeded" | "partial" | "failed" | "cancelled";

export interface ParallelTaskRecord {
  id: string;
  taskNumber: number;
  complexity: ParallelTaskPlan["decision"]["complexity"];
  profile: RoutingProfile;
  runtimeId: string;
  providerId: string;
  modelId: string;
  allowancePoolId: string;
  routingScore: number;
  routingReason: string;
  status: ParallelTaskStatus;
  latencyMs?: number;
  failureKind?: RuntimeFailureKind;
  inputTokens?: number;
  outputTokens?: number;
  usageSource?: string;
  worktreePath?: string;
  worktreeRemoved?: boolean;
}

export interface ParallelRunRecord {
  id: string;
  recordedAt: string;
  profile: RoutingProfile;
  status: ParallelRunStatus;
  tasks: ParallelTaskRecord[];
  repositoryRoot?: string;
  baseCommit?: string;
  wallClockMs?: number;
  summedTaskDurationMs?: number;
  observedTimeSavedMs?: number;
  reportedUsageTaskCount: number;
  aggregateInputTokens?: number;
  aggregateOutputTokens?: number;
}

export function createParallelPlan(
  rawTasks: readonly string[],
  profile: RoutingProfile,
  candidates: readonly RuntimeModel[],
  asOf: number,
  usageSnapshots: readonly UsageSnapshot[] = [],
  idFactory: () => string = randomUUID,
): ParallelPlan {
  if (rawTasks.length !== PARALLEL_TASK_COUNT) {
    throw new Error("Definí exactamente dos subtareas independientes.");
  }

  const prompts = rawTasks.map((task) => task.trim());
  if (prompts.some((task) => task.length < 10 || task.length > 10_000)) {
    throw new Error("Cada subtarea debe tener entre 10 y 10.000 caracteres.");
  }
  if (normalizeTask(prompts[0]) === normalizeTask(prompts[1])) {
    throw new Error("Las dos subtareas deben ser distintas.");
  }

  return {
    id: idFactory(),
    profile,
    tasks: prompts.map((prompt) => ({
      id: idFactory(),
      prompt,
      decision: routePrompt(prompt, profile, candidates, asOf, usageSnapshots),
    })),
  };
}

export function createParallelRunRecord(
  plan: ParallelPlan,
  recordedAt = new Date().toISOString(),
  repositoryRoot?: string,
  baseCommit?: string,
): ParallelRunRecord {
  return {
    id: plan.id,
    recordedAt,
    profile: plan.profile,
    status: "running",
    ...(repositoryRoot ? { repositoryRoot } : {}),
    ...(baseCommit ? { baseCommit } : {}),
    tasks: plan.tasks.map((task, index) => ({
      id: task.id,
      taskNumber: index + 1,
      complexity: task.decision.complexity,
      profile: task.decision.profile,
      runtimeId: task.decision.selected.runtimeId,
      providerId: task.decision.selected.providerId,
      modelId: task.decision.selected.id,
      allowancePoolId: task.decision.allowancePoolId,
      routingScore: task.decision.selectedScore.total,
      routingReason: task.decision.reason,
      status: "queued",
    })),
    reportedUsageTaskCount: 0,
  };
}

export function markParallelWorktreeRemoved(record: ParallelRunRecord, taskId: string): ParallelRunRecord {
  return {
    ...record,
    tasks: record.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const { worktreePath: _worktreePath, ...rest } = task;
      return { ...rest, worktreeRemoved: true };
    }),
  };
}

export function updateParallelTask(
  record: ParallelRunRecord,
  taskId: string,
  result: RuntimeExecutionResult,
  latencyMs: number,
  worktreePath?: string,
): ParallelRunRecord {
  const tasks = record.tasks.map((task) => task.id !== taskId
    ? task
    : {
      ...task,
      status: result.status,
      latencyMs: Math.max(0, Math.round(latencyMs)),
      ...(result.failureKind ? { failureKind: result.failureKind } : {}),
      ...(safeTokenCount(result.usage?.inputTokens) === undefined
        ? {} : { inputTokens: result.usage!.inputTokens }),
      ...(safeTokenCount(result.usage?.outputTokens) === undefined
        ? {} : { outputTokens: result.usage!.outputTokens }),
      ...(result.usage ? { usageSource: result.usage.source } : {}),
      ...(worktreePath ? { worktreePath } : {}),
    });
  return { ...record, tasks };
}

export function setParallelTaskStatus(
  record: ParallelRunRecord,
  taskId: string,
  status: ParallelTaskStatus,
  worktreePath?: string,
): ParallelRunRecord {
  return {
    ...record,
    tasks: record.tasks.map((task) => task.id !== taskId
      ? task
      : { ...task, status, ...(worktreePath ? { worktreePath } : {}) }),
  };
}

export function cancelPendingParallelTasks(record: ParallelRunRecord): ParallelRunRecord {
  return {
    ...record,
    tasks: record.tasks.map((task) => task.status === "queued" || task.status === "running"
      ? { ...task, status: "cancelled" }
      : task),
  };
}

export function finishParallelRun(
  record: ParallelRunRecord,
  wallClockMs: number,
): ParallelRunRecord {
  const completed = record.tasks.filter((task) => task.status !== "queued" && task.status !== "running");
  const succeeded = completed.filter((task) => task.status === "succeeded").length;
  const failed = completed.filter((task) => task.status === "failed").length;
  const cancelled = completed.filter((task) => task.status === "cancelled").length;
  const status: ParallelRunStatus = cancelled === completed.length && completed.length > 0
    ? "cancelled"
    : succeeded === record.tasks.length
      ? "succeeded"
      : succeeded > 0
        ? "partial"
        : failed > 0
          ? "failed"
          : "cancelled";
  const durations = completed.flatMap((task) => task.latencyMs === undefined ? [] : [task.latencyMs]);
  const summedTaskDurationMs = durations.reduce((total, duration) => total + duration, 0);
  const tasksWithUsage = record.tasks.filter((task) => task.inputTokens !== undefined || task.outputTokens !== undefined);
  const inputTokens = sumReported(record.tasks, "inputTokens");
  const outputTokens = sumReported(record.tasks, "outputTokens");

  return {
    ...record,
    status,
    wallClockMs: Math.max(0, Math.round(wallClockMs)),
    summedTaskDurationMs,
    observedTimeSavedMs: Math.max(0, summedTaskDurationMs - Math.max(0, Math.round(wallClockMs))),
    reportedUsageTaskCount: tasksWithUsage.length,
    ...(inputTokens === undefined ? {} : { aggregateInputTokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { aggregateOutputTokens: outputTokens }),
  };
}

export function appendParallelHistory(
  records: readonly ParallelRunRecord[],
  record: ParallelRunRecord,
): ParallelRunRecord[] {
  return [...records.filter((item) => item.id !== record.id), record].slice(-MAX_PARALLEL_HISTORY);
}

export function loadParallelHistory(value: unknown): ParallelRunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isParallelRunRecord).slice(-MAX_PARALLEL_HISTORY);
}

export function recoverInterruptedParallelHistory(records: readonly ParallelRunRecord[]): ParallelRunRecord[] {
  return records.map((record) => record.status !== "running"
    ? record
    : {
      ...record,
      status: "cancelled",
      tasks: record.tasks.map((task) => task.status === "queued" || task.status === "running"
        ? { ...task, status: "cancelled" }
        : task),
    });
}

export function isParallelRunRecord(value: unknown): value is ParallelRunRecord {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return false;
  const allowedKeys = new Set([
    "id", "recordedAt", "profile", "status", "tasks", "repositoryRoot", "baseCommit", "wallClockMs", "summedTaskDurationMs",
    "observedTimeSavedMs", "reportedUsageTaskCount", "aggregateInputTokens", "aggregateOutputTokens",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  return typeof value.id === "string"
    && typeof value.recordedAt === "string"
    && ["economy", "balanced", "quality"].includes(String(value.profile))
    && ["running", "succeeded", "partial", "failed", "cancelled"].includes(String(value.status))
    && (value.repositoryRoot === undefined || typeof value.repositoryRoot === "string")
    && (value.baseCommit === undefined || (typeof value.baseCommit === "string" && /^[a-f0-9]{40,64}$/i.test(value.baseCommit)))
    && value.tasks.length === PARALLEL_TASK_COUNT
    && value.tasks.every(isParallelTaskRecord)
    && isSafeCount(value.reportedUsageTaskCount)
    && optionalSafeCount(value.wallClockMs)
    && optionalSafeCount(value.summedTaskDurationMs)
    && optionalSafeCount(value.observedTimeSavedMs)
    && optionalSafeCount(value.aggregateInputTokens)
    && optionalSafeCount(value.aggregateOutputTokens);
}

function isParallelTaskRecord(value: unknown): value is ParallelTaskRecord {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    "id", "taskNumber", "complexity", "profile", "runtimeId", "providerId", "modelId", "allowancePoolId", "routingScore", "routingReason",
    "status", "latencyMs", "failureKind", "inputTokens", "outputTokens", "usageSource", "worktreePath", "worktreeRemoved",
  ]);
  return Object.keys(value).every((key) => allowedKeys.has(key))
    && typeof value.id === "string"
    && (value.taskNumber === 1 || value.taskNumber === 2)
    && ["simple", "standard", "complex"].includes(String(value.complexity))
    && ["economy", "balanced", "quality"].includes(String(value.profile))
    && typeof value.runtimeId === "string"
    && typeof value.providerId === "string"
    && typeof value.modelId === "string"
    && typeof value.allowancePoolId === "string"
    && typeof value.routingScore === "number"
    && Number.isFinite(value.routingScore)
    && typeof value.routingReason === "string"
    && ["queued", "running", "succeeded", "failed", "cancelled"].includes(String(value.status))
    && optionalSafeCount(value.latencyMs)
    && (value.failureKind === undefined || isFailureKind(value.failureKind))
    && optionalSafeCount(value.inputTokens)
    && optionalSafeCount(value.outputTokens)
    && (value.usageSource === undefined || typeof value.usageSource === "string")
    && (value.worktreePath === undefined || typeof value.worktreePath === "string")
    && (value.worktreeRemoved === undefined || typeof value.worktreeRemoved === "boolean");
}

function sumReported(tasks: readonly ParallelTaskRecord[], key: "inputTokens" | "outputTokens"): number | undefined {
  const reported = tasks.flatMap((task) => task[key] === undefined ? [] : [task[key]!]);
  return reported.length ? reported.reduce((total, value) => total + value, 0) : undefined;
}

function safeTokenCount(value: unknown): number | undefined {
  return isSafeCount(value) ? value : undefined;
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalSafeCount(value: unknown): boolean {
  return value === undefined || isSafeCount(value);
}

function isFailureKind(value: unknown): value is RuntimeFailureKind {
  return ["authentication", "quota", "tool", "process", "approval", "protocol", "verification", "unknown"].includes(String(value));
}

function normalizeTask(prompt: string): string {
  return prompt.replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
