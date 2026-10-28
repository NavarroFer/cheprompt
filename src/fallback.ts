import { RuntimeExecutionResult } from "./types";

export const MAX_TASK_EXECUTION_ATTEMPTS = 2;

const OBJECTIVE_FAILURES = new Set(["authentication", "quota", "tool", "process", "verification"]);

/** Fallbacks are proposals only: callers must still show and review the new route. */
export function shouldProposeFallback(
  result: RuntimeExecutionResult,
  executionsStarted: number,
  fallbackAlreadyProposed: boolean,
): boolean {
  return result.status === "failed"
    && !!result.failureKind
    && OBJECTIVE_FAILURES.has(result.failureKind)
    && executionsStarted < MAX_TASK_EXECUTION_ATTEMPTS
    && !fallbackAlreadyProposed;
}

export function canStartExecution(executionsStarted: number, taskSucceeded: boolean): boolean {
  return !taskSucceeded && executionsStarted < MAX_TASK_EXECUTION_ATTEMPTS;
}
