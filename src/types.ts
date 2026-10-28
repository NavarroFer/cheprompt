export type RoutingProfile = "economy" | "balanced" | "quality";

export type Complexity = "simple" | "standard" | "complex";

export type UsageImpact = "low" | "medium" | "high";

export type RuntimeAvailability = "available" | "unavailable" | "expired";

export type RuntimeCapability = "text" | "tools" | "vision" | "reasoning";

export type UsageWindow = "rolling" | "weekly" | "monthly";

export type UsageFreshness = "fresh" | "stale" | "unknown";

export type UsageStatus = "available" | "not-available" | "unknown";

export interface RuntimeDescriptor {
  id: string;
  name: string;
  availability: RuntimeAvailability;
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
  availability: RuntimeAvailability;
  capabilities: readonly RuntimeCapability[];
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
}

export interface UsageSnapshot {
  runtimeId: string;
  provider: string;
  status: UsageStatus;
  windows: UsageWindowSnapshot[];
  source: string;
  observedAt: number;
  freshness: UsageFreshness;
}

export interface RuntimeAdapter {
  getInventory(): Promise<RuntimeInventory>;
  getUsageLimits?(): Promise<UsageSnapshot>;
}

export interface RoutingDecision {
  profile: RoutingProfile;
  complexity: Complexity;
  selected: ModelCandidate;
  alternatives: ModelCandidate[];
  matchedSignals: string[];
  reason: string;
  confidence: number;
  pricing: string;
}
