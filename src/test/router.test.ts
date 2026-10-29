import assert from "node:assert/strict";
import test from "node:test";
import { routePrompt, routingCatalog } from "../router";
import { RuntimeModel, UsageSnapshot } from "../types";

const AS_OF = Date.parse("2026-10-28T00:00:00.000Z");

function runtimeModel(
  id: string,
  runtimeId: string,
  providerId: string,
  allowancePoolId: string,
  usageImpact: RuntimeModel["usageImpact"],
  overrides: Partial<RuntimeModel> = {},
): RuntimeModel {
  return {
    id,
    label: id,
    usageImpact,
    strengths: [],
    runtimeId,
    providerId,
    allowancePoolId,
    availability: "available",
    capabilities: ["text", "tools", "reasoning"],
    capabilitiesKnown: true,
    ...overrides,
  };
}

function poolUsage(allowancePoolId: string, remainingPercent: number, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    runtimeId: "opencode",
    provider: allowancePoolId,
    allowancePoolId,
    status: "available",
    windows: [{ window: "rolling", remainingPercent, resetsAt: AS_OF + 60_000, limited: remainingPercent === 0 }],
    source: "official fake source",
    observedAt: AS_OF,
    freshness: "fresh",
    ...overrides,
  };
}

test("routes a small edit to the low-impact model", () => {
  const decision = routePrompt("Renombrá esta variable y corregí el typo.", "balanced", routingCatalog);

  assert.equal(decision.complexity, "simple");
  assert.equal(decision.selected.id, "opencode-go/gpt-6-luna");
});

test("routes architecture work to the strongest baseline", () => {
  const decision = routePrompt(
    "Rediseñá la arquitectura distribuida y revisá seguridad, concurrencia y migración a producción.",
    "balanced",
    routingCatalog,
  );

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
  assert.ok(decision.matchedSignals.length >= 3);
});

test("quality profile escalates standard work", () => {
  const decision = routePrompt("Implementá el endpoint de usuarios con sus tests.", "quality", routingCatalog);

  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
});

test("rejects an empty prompt", () => {
  assert.throws(() => routePrompt("   ", "economy", routingCatalog), /Escribí una tarea/);
});

test("does not fall back to a hardcoded model catalog when discovery is empty", () => {
  assert.throws(() => routePrompt("Implementá una mejora.", "balanced"), /No hay modelos disponibles/);
});

test("fails closed for expiring candidates when the caller omits the evaluation timestamp", () => {
  const expiring = { ...routingCatalog[0], expiresAt: "2026-11-22T00:00:00.000Z" };
  assert.throws(
    () => routePrompt("Renombrá una variable.", "balanced", [expiring]),
    /No hay modelos disponibles/,
  );
});

test("filters unavailable and expired models before selecting and listing alternatives", () => {
  const candidates = routingCatalog.map((model) => ({ ...model }));
  const luna = candidates.find((model) => model.id === "opencode-go/gpt-6-luna")!;
  luna.expiresAt = "2000-01-01T00:00:00.000Z";
  const argon = candidates.find((model) => model.id === "opencode-go/gemini-4-argon")!;
  argon.availability = "unavailable";

  const decision = routePrompt(
    "Renombrá esta variable y corregí el typo.",
    "balanced",
    candidates,
    Date.parse("2026-10-27T00:00:00.000Z"),
  );

  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
  assert.deepEqual(decision.alternatives, []);
});

test("scores candidates across runtimes and returns two ranked alternatives", () => {
  const candidates = [
    ...routingCatalog,
    runtimeModel("claude-code/default", "claude-code", "claude-pro", "claude-pro", "medium"),
    runtimeModel("codex-default", "codex", "chatgpt-codex", "chatgpt-codex", "medium"),
  ];
  const decision = routePrompt(
    "Rediseñá la arquitectura del servicio y mejorá sus pruebas.",
    "balanced",
    candidates,
    AS_OF,
  );

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.selected.runtimeId, "opencode");
  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
  assert.equal(decision.alternatives.length, 2);
  assert.ok(decision.selectedScore.total >= decision.alternativeScores[0].total);
  assert.ok(decision.selectedScore.total >= decision.alternativeScores[1].total);
  assert.equal(decision.allowancePoolId, "opencode-go");
});

test("returns the same route and score breakdown for identical inputs", () => {
  const candidates = [
    ...routingCatalog,
    runtimeModel("claude-code/default", "claude-code", "claude-pro", "claude-pro", "medium"),
    runtimeModel("codex-default", "codex", "chatgpt-codex", "chatgpt-codex", "medium"),
  ];
  const usage = [poolUsage("opencode-go", 73)];
  const first = routePrompt("Refactorizá el servicio y agregá tests.", "balanced", candidates, AS_OF, usage);
  const second = routePrompt("Refactorizá el servicio y agregá tests.", "balanced", candidates, AS_OF, usage);

  assert.deepEqual(second, first);
});

test("flags close candidate scores as low-confidence without executing an escalation", () => {
  const candidates = [
    runtimeModel("candidate-a", "opencode", "provider-a", "pool-a", "medium"),
    runtimeModel("candidate-b", "codex", "provider-b", "pool-b", "medium"),
  ];
  const decision = routePrompt("Revisá el estado del componente.", "balanced", candidates, AS_OF);

  assert.equal(decision.confidence, 0.58);
  assert.equal(decision.routingNotice?.kind, "low-confidence");
});

test("supports a cross-runtime route when task fit and policy favor Claude", () => {
  const candidates = [
    routingCatalog[0],
    runtimeModel("claude-code/default", "claude-code", "claude-pro", "claude-pro", "medium"),
  ];
  const decision = routePrompt(
    "Renombrá esta variable y corregí el typo.",
    "quality",
    candidates,
    AS_OF,
  );

  assert.equal(decision.selected.runtimeId, "claude-code");
  assert.equal(decision.allowancePoolId, "claude-pro");
});

test("applies economy and quality policy weights without changing the available candidate set", () => {
  const candidates = [
    runtimeModel("low-cost", "opencode", "opencode-go", "opencode-go", "low"),
    runtimeModel("high-capability", "claude-code", "claude-pro", "claude-pro", "high"),
  ];
  const prompt = "Implementá la validación de entrada y agregá tests.";
  const economy = routePrompt(prompt, "economy", candidates, AS_OF);
  const quality = routePrompt(prompt, "quality", candidates, AS_OF);

  assert.equal(economy.selected.id, "low-cost");
  assert.equal(quality.selected.id, "high-capability");
  assert.equal(economy.alternatives.length, 1);
  assert.equal(quality.alternatives.length, 1);
});

test("an exhausted official allowance filters only its own pool", () => {
  const candidates = [
    routingCatalog[0],
    runtimeModel("claude-code/default", "claude-code", "claude-pro", "claude-pro", "medium"),
  ];
  const exhaustedGo = poolUsage("opencode-go", 0);
  const decision = routePrompt(
    "Renombrá esta variable y corregí el typo.",
    "balanced",
    candidates,
    AS_OF,
    [exhaustedGo],
  );

  assert.equal(decision.selected.runtimeId, "claude-code");
  assert.equal(decision.remainingPercent, undefined);
  assert.equal(decision.selectedScore.allowance, null);
});

test("an official limited flag excludes its pool even when remaining percent is nonzero", () => {
  const candidates = [
    routingCatalog[0],
    runtimeModel("claude-code/default", "claude-code", "claude-pro", "claude-pro", "medium"),
  ];
  const goLimit = poolUsage("opencode-go", 25, {
    windows: [{ window: "rolling", remainingPercent: 25, resetsAt: AS_OF + 60_000, limited: true }],
  });
  const decision = routePrompt("Renombrá esta variable.", "balanced", candidates, AS_OF, [goLimit]);

  assert.equal(decision.selected.runtimeId, "claude-code");
});

test("scores fresh official allowance by pool and reports its source", () => {
  const candidates = [
    runtimeModel("high-remaining", "opencode", "provider-a", "pool-a", "medium"),
    runtimeModel("low-remaining", "codex", "provider-b", "pool-b", "medium"),
  ];
  const snapshots = [
    poolUsage("pool-a", 90),
    poolUsage("pool-b", 25, { source: "second official source" }),
  ];
  const decision = routePrompt("Implementá una validación.", "balanced", candidates, AS_OF, snapshots);

  assert.equal(decision.selected.id, "high-remaining");
  assert.equal(decision.allowancePoolId, "pool-a");
  assert.equal(decision.allowanceSource, "official fake source");
  assert.equal(decision.remainingPercent, 90);
  assert.equal(decision.selectedScore.allowance, 90);
});

test("keeps similarly named GPT candidates in separate allowance pools", () => {
  const goCandidate = runtimeModel(
    "opencode-go/gpt-6.1-sol",
    "opencode",
    "opencode-go",
    "opencode-go",
    "low",
  );
  const codexCandidate = runtimeModel(
    "gpt-6.1-sol",
    "codex",
    "chatgpt-codex",
    "chatgpt-codex",
    "medium",
  );
  const decision = routePrompt(
    "Renombrá esta variable.",
    "balanced",
    [goCandidate, codexCandidate],
    AS_OF,
    [poolUsage("opencode-go", 0)],
  );

  assert.equal(decision.selected.id, "gpt-6.1-sol");
  assert.equal(decision.selected.runtimeId, "codex");
  assert.equal(decision.allowancePoolId, "chatgpt-codex");
  assert.deepEqual(decision.alternatives, []);
});

test("unknown, stale and malformed quotas neither exclude nor score as zero", () => {
  const candidate = routingCatalog[0];
  const unknown = poolUsage("opencode-go", 0, { status: "unknown", freshness: "unknown", windows: [] });
  const stale = poolUsage("opencode-go", 0, { freshness: "stale", observedAt: AS_OF - 600_000 });
  const malformed = poolUsage("opencode-go", 101);

  for (const usage of [unknown, stale, malformed]) {
    const decision = routePrompt("Renombrá esta variable.", "balanced", [candidate], AS_OF, [usage]);
    assert.equal(decision.selected.id, candidate.id);
    assert.equal(decision.selectedScore.allowance, null);
    assert.equal(decision.remainingPercent, undefined);
  }
});

test("uses context and capability metadata when available, without inventing missing values", () => {
  const smallContext = runtimeModel(
    "small-context",
    "test-runtime",
    "test-provider",
    "pool-small",
    "high",
    { contextWindowTokens: 1_000 },
  );
  const largeContext = runtimeModel(
    "large-context",
    "test-runtime",
    "test-provider",
    "pool-large",
    "high",
    { contextWindowTokens: 100_000 },
  );
  const prompt = "Revisá este documento y sus pruebas. ".repeat(250);
  const decision = routePrompt(prompt, "balanced", [smallContext, largeContext], AS_OF);

  assert.equal(decision.selected.id, "large-context");
  assert.equal(decision.selectedScore.contextFit, 100);
  assert.equal(decision.alternativeScores[0].contextFit, 0);

  const unknown = runtimeModel("unknown", "test", "test", "unknown", "medium", { capabilitiesKnown: false });
  const unknownDecision = routePrompt("Analizá un prompt.", "balanced", [unknown], AS_OF);
  assert.equal(unknownDecision.selectedScore.capabilityFit, null);
  assert.equal(unknownDecision.selectedScore.contextFit, null);
});

test("routes prompts with images only to candidates that accept image input", () => {
  const textOnly = runtimeModel("opencode-go/text-only", "opencode", "opencode-go", "opencode-go", "low");
  const vision = runtimeModel("opencode-go/vision", "opencode", "opencode-go", "opencode-go", "high", {
    capabilities: ["text", "tools", "reasoning", "vision"],
  });

  const decision = routePrompt("Arreglá el botón de la captura", "economy", [textOnly, vision], AS_OF, [], { requiresVision: true });
  assert.equal(decision.selected.id, "opencode-go/vision");
  assert.deepEqual(decision.alternatives, []);
  assert.equal(routePrompt("Renombrá la variable", "economy", [textOnly, vision], AS_OF).selected.id, "opencode-go/text-only");
  assert.throws(
    () => routePrompt("Mirá la imagen", "balanced", [textOnly], AS_OF, [], { requiresVision: true }),
    /acepta imágenes/,
  );
});
