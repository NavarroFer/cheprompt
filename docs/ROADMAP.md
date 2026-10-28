# ChePrompt roadmap

Updated: 2026-10-27

## Product outcome

ChePrompt is the only prompt surface the user needs. It discovers eligible AI runtimes, selects the least expensive model likely to complete the task well, explains the decision, executes it and learns from verified outcomes.

The router optimizes expected successful completion, not the cheapest first call. A cheap attempt followed by repeated corrections can cost more than choosing a stronger model once.

## Status overview

- **Completed:** M0 foundation.
- **Now:** M1 runtime inventory and contracts.
- **Next:** unified execution, Claude Code and adaptive routing.
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

**Status:** Not started

Outcome: ChePrompt can describe which runtimes and models are actually available without spending model tokens.

Definition of done:

- [ ] Introduce a `RuntimeAdapter` contract independent of VS Code UI code.
- [ ] Implement an `OpenCodeAdapter` that checks CLI availability and lists models.
- [ ] Represent runtime, provider, model, availability, capabilities and expiration in typed contracts.
- [ ] Exclude unavailable or expired candidates before scoring.
- [ ] Show the discovered provider/model inventory in the ChePrompt panel.
- [ ] Add unit tests using fake process execution; tests must not require network access.
- [ ] Preserve the current explicit confirmation before execution.
- [ ] Update `docs/STATE.md` and mark this milestone Done.

Dependencies:

- OpenCode v2 installed and authenticated.
- No Claude Code dependency yet; its adapter is M3.

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
- [ ] Document that Claude Pro credentials must not be reused through OpenCode plugins.

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
