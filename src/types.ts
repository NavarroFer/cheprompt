export type RoutingProfile = "economy" | "balanced" | "quality";

export type Complexity = "simple" | "standard" | "complex";

export type UsageImpact = "low" | "medium" | "high";

export interface ModelCandidate {
  id: string;
  label: string;
  usageImpact: UsageImpact;
  strengths: readonly string[];
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
