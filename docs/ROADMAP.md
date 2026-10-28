# ChePrompt roadmap

Updated: 2026-10-27

## Product outcome

ChePrompt is the only prompt surface the user needs. It discovers eligible AI runtimes, selects the least expensive model likely to complete the task well, explains the decision, executes it and learns from verified outcomes.

The router optimizes expected successful completion, not the cheapest first call. A cheap attempt followed by repeated corrections can cost more than choosing a stronger model once.

## Status overview

- **Completed:** M0 foundation.
- **Completed:** M1 runtime inventory and stable contracts.
- **Now:** M1.5 provider-reported usage visibility.
- **Next:** unified execution, Claude Code, ChatGPT/Codex and adaptive routing.
- **Later:** evaluation-driven learning, automatic fallback and parallel agents.

## Now

### M0 — Extension foundation

**Status:** Done

Outcome:

- VS Code webview opens from the ChePrompt activity icon.
- A deterministic baseline routes between three OpenCode Go models.
- The user reviews the decision before execution.
- Type checking and five automated tests pass.
- Local installation and Git history are available.

### M1 — Runtime inventory and stable contracts

**Status:** Done (2026-10-27)

Outcome: ChePrompt can describe which runtimes and models are actually available without spending model tokens.

Definition of done:

- [x] Introduce a `RuntimeAdapter` contract independent of VS Code UI code.
- [x] Implement an `OpenCodeAdapter` that checks CLI availability and lists models.
- [x] Represent runtime, provider, model, availability, capabilities and expiration in typed contracts.
- [x] Exclude unavailable or expired candidates before scoring.
- [x] Show the discovered provider/model inventory in the ChePrompt panel.
- [x] Add unit tests using fake process execution; tests must not require network access.
- [x] Preserve the current explicit confirmation before execution.
- [x] Update `docs/STATE.md` and mark this milestone Done.

Limitations: discovery verifies that the CLI runs and reports model IDs; it does not validate provider authentication, quota or model reachability. Models outside the existing baseline use a neutral `medium` relative usage impact until evaluation evidence supports better estimates.

Dependencies:

- OpenCode v2 installed and authenticated.
- No Claude Code dependency yet; its adapter is M3.

### M1.5 — Provider-reported usage visibility

**Status:** Not started

Outcome: ChePrompt shows the exact remaining allowance and reset windows when an official provider surface exposes them, without presenting guesses as account data.

Definition of done:

- [ ] Add an optional `getUsageLimits()` capability to `RuntimeAdapter`.
- [ ] Represent usage window, remaining percentage, reset time, source, observation time and freshness in typed contracts.
- [ ] Implement OpenCode Go usage discovery through its official experimental usage-limits endpoint.
- [ ] Confirm the endpoint's percentage semantics before normalizing to `remainingPercent`; do not infer whether a raw percentage means used or remaining.
- [ ] Show every reported window separately, including rolling, weekly and monthly meters when present.
- [ ] Display the data source and last refresh time next to each percentage.
- [ ] Display `Not available` when a runtime does not officially expose a percentage; do not estimate it or scrape dashboards.
- [ ] Treat missing, stale or malformed usage data as unknown, never as zero allowance.
- [ ] Add offline unit tests for exact windows, unsupported usage, stale data and malformed responses.
- [ ] Preserve the existing routing and explicit execution confirmation; quota-aware scoring belongs to M4.

Dependencies:

- OpenCode's `/api/experimental/usage/limits` contract is experimental and must fail gracefully if it changes.
- Provider credentials remain in official stores and must never be logged or rendered.

## Next

### M2 — Unified execution inside ChePrompt

**Status:** Not started

Outcome: prompts, streaming output, cancellation and errors remain in the ChePrompt panel instead of opening an unmanaged terminal.

Definition of done:

- [ ] Add a runtime execution result/event contract.
- [ ] Stream OpenCode output into the webview.
- [ ] Support cancellation and a visible terminal fallback for interactive approvals.
- [ ] Never enable blanket auto-approval by default.
- [ ] Add integration tests around process lifecycle and malformed output.

### M3 — Claude Pro through Claude Code

**Status:** Not started

Outcome: ChePrompt can select Claude Pro by invoking the official Claude Code CLI directly.

Definition of done:

- [ ] Install and authenticate Claude Code using the user's Claude Pro account.
- [ ] Implement `ClaudeCodeAdapter` without copying Claude credentials into ChePrompt.
- [ ] Detect quota/auth failures and mark the runtime temporarily unavailable.
- [ ] Stream execution through the same M2 event contract.
- [ ] Include an exact remaining allowance only if an official Claude CLI/API surface exposes it; otherwise show `Not available`.
- [ ] Document that Claude Pro credentials must not be reused through OpenCode plugins.

### M3.5 — ChatGPT/Codex runtime

**Status:** Not started

Outcome: ChePrompt can select the user's officially authenticated OpenAI coding runtime without copying account credentials.

Definition of done:

- [ ] Identify and document the supported official CLI/API integration for the user's ChatGPT/Codex subscription.
- [ ] Implement an adapter behind the shared discovery and M2 execution contracts.
- [ ] Detect authentication and quota failures without reading or exposing raw credentials.
- [ ] Include exact remaining usage only if the official integration exposes it; otherwise show `Not available`.
- [ ] Exclude the runtime after 2026-11-21 unless the subscription is renewed or a separate eligible OpenAI account is configured.

### M4 — Adaptive transparent router

**Status:** Not started

Outcome: routing considers task fit, expected usage, context needs, capabilities, availability and expiration.

Definition of done:

- [ ] Replace the three-model hardcoded decision with scoring over discovered candidates.
- [ ] Keep routing local and deterministic by default so selection itself spends no tokens.
- [ ] Show score components, selected runtime/model and two alternatives.
- [ ] Support `economy`, `balanced` and `quality` policies.
- [ ] Model the ChatGPT subscription as unavailable after 2026-11-21 unless renewed.
- [ ] Allow a manual override without changing the default automatic flow.
- [ ] Use fresh provider-reported remaining allowance as a routing constraint when available.
- [ ] Never compare an unknown or locally inferred percentage as if it were an official quota value.

## Later

### M5 — Evaluation and outcome history

**Status:** Not started

- Build a 20-task representative evaluation set.
- Record model, routing reason, latency, usage, retries and verification outcome.
- Do not store raw prompts by default.
- Recalibrate weights only from measured results.

### M6 — Escalation and fallback

**Status:** Not started

- Escalate only on objective failure: tests, build, tool error or explicit low confidence.
- Prevent retry loops with a hard attempt and usage budget.
- Explain every fallback in the UI.

### M7 — Parallel agents and worktrees

**Status:** Not started

- Add parallel execution only for independent tasks with measurable benefit.
- Isolate editing agents in Git worktrees.
- Keep one parent decision record for cost and result attribution.

## Explicit non-goals for the current phase

- Publishing to the VS Code Marketplace.
- Storing provider secrets in the repository.
- Circumventing provider subscription or authentication restrictions.
- Claiming that routing is optimal before M5 evaluation evidence exists.
- Automatic permission approval for arbitrary shell or file operations.

## Milestone protocol

At the end of every milestone:

1. Run `npm run check` and `npm test`.
2. Manually validate the affected UI flow when applicable.
3. Update this roadmap and `docs/STATE.md`.
4. Record limitations and the exact next action.
5. Create one atomic Git commit.
