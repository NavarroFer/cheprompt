import assert from "node:assert/strict";
import test from "node:test";
import { routePrompt, routingCatalog } from "../router";

test("routes a small edit to the low-impact model", () => {
  const decision = routePrompt("Renombrá esta variable y corregí el typo.", "balanced");

  assert.equal(decision.complexity, "simple");
  assert.equal(decision.selected.id, "opencode-go/gpt-6-luna");
});

test("routes architecture work to the strongest baseline", () => {
  const decision = routePrompt(
    "Rediseñá la arquitectura distribuida y revisá seguridad, concurrencia y migración a producción.",
    "balanced",
  );

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
  assert.ok(decision.matchedSignals.length >= 3);
});

test("quality profile escalates standard work", () => {
  const decision = routePrompt("Implementá el endpoint de usuarios con sus tests.", "quality");

  assert.equal(decision.selected.id, "opencode-go/kimi-k3.1-pro");
});

test("rejects an empty prompt", () => {
  assert.throws(() => routePrompt("   ", "economy"), /Escribí una tarea/);
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
