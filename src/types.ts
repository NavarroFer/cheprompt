export type RoutingProfile = "economy" | "balanced" | "quality";

export type Complexity = "simple" | "standard" | "complex";

export type UsageImpact = "low" | "medium" | "high";

export type RuntimeAvailability = "available" | "unavailable" | "expired";

export type RuntimeCapability = "text" | "tools" | "vision" | "reasoning";

export type UsageWindow = "rolling" | "weekly" | "monthly";

export const USAGE_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

export type UsageFreshness = "fresh" | "stale" | "unknown";

export type UsageStatus = "available" | "not-available" | "unknown";

export interface RuntimeDescriptor {
  id: string;
  name: string;
  availability: RuntimeAvailability;
  installed?: boolean;
  message?: string;
  expiresAt?: string;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  runtimeId: string;
  availability: RuntimeAvailability;
  expiresAt?: string;
}

export interface ModelCandidate {
  id: string;
  label: string;
  usageImpact: UsageImpact;
  strengths: readonly string[];
}

export interface RuntimeModel extends ModelCandidate {
  runtimeId: string;
  providerId: string;
  allowancePoolId: string;
  availability: RuntimeAvailability;
  capabilities: readonly RuntimeCapability[];
  capabilitiesKnown?: boolean;
  contextWindowTokens?: number;
  expiresAt?: string;
}

export interface RuntimeInventory {
  runtime: RuntimeDescriptor;
  providers: ProviderDescriptor[];
  models: RuntimeModel[];
  discoveredAt: string;
}

export interface UsageWindowSnapshot {
  window: UsageWindow;
  remainingPercent: number;
  resetsAt: number;
  limited: boolean;
}

export interface UsageSnapshot {
  runtimeId: string;
  provider: string;
  allowancePoolId: string;
  status: UsageStatus;
  windows: UsageWindowSnapshot[];
  source: string;
  observedAt: number;
  freshness: UsageFreshness;
}

export type RuntimeExecutionEventType =
  | "started"
  | "text"
  | "step"
  | "tool"
  | "diagnostic"
  | "approval_required"
  | "error"
  | "completed"
  | "cancelled";

export interface RuntimeExecutionEvent {
  executionId: string;
  type: RuntimeExecutionEventType;
  timestamp: number;
  sessionId?: string;
  text?: string;
  message?: string;
}

export type RuntimeExecutionStatus = "succeeded" | "failed" | "cancelled";

export interface RuntimeExecutionResult {
  executionId: string;
  status: RuntimeExecutionStatus;
  exitCode: number;
  sessionId?: string;
  error?: string;
  runtimeUnavailable?: boolean;
}

export interface RoutingScoreBreakdown {
  taskFit: number;
  usagePressure: number;
  contextFit: number | null;
  capabilityFit: number | null;
  availability: number;
  expiration: number;
  allowance: number | null;
  total: number;
}

export interface RuntimeAdapter {
  getInventory(): Promise<RuntimeInventory>;
  getUsageLimits?(): Promise<UsageSnapshot>;
}

export interface RoutingDecision {
  profile: RoutingProfile;
  complexity: Complexity;
  selected: RuntimeModel;
  alternatives: RuntimeModel[];
  selectedScore: RoutingScoreBreakdown;
  alternativeScores: RoutingScoreBreakdown[];
  allowancePoolId: string;
  allowanceSource?: string;
  allowanceObservedAt?: number;
  remainingPercent?: number;
  matchedSignals: string[];
  reason: string;
  confidence: number;
  pricing: string;
  manualOverride?: boolean;
}
