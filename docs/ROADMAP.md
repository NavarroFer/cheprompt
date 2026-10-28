# ChePrompt roadmap

Updated: 2026-10-28

## Product outcome

ChePrompt is the only prompt surface the user needs. It discovers eligible AI runtimes, selects the least expensive model likely to complete the task well, explains the decision, executes it and learns from verified outcomes.

The router optimizes expected successful completion, not the cheapest first call. A cheap attempt followed by repeated corrections can cost more than choosing a stronger model once.

### Single-prompt contract

- The user always writes the task in ChePrompt; selecting a provider is not required in the default flow.
- The router compares eligible candidates across runtimes, not only models within OpenCode.
- OpenCode Go contributes its discovered catalog, including DeepSeek and GPT models covered by the Go allowance.
- Claude Pro participates through the official Claude Code runtime.
- ChatGPT/Codex participates through its official authenticated runtime once M3.5 is complete.
- A candidate is identified by runtime, provider, model and allowance pool so similarly named GPT models do not incorrectly share quota state.
- The chosen runtime/model, reason, allowance source and alternatives remain visible, with manual override available.

## Status overview

- **Completed:** M0 foundation.
- **Completed:** M1 runtime inventory and stable contracts.
- **Now:** M4.5 terminal-inspired UI implementation complete; integral Extension Development Host validation pending for M4 and M4.5.
- **Next:** Validate routing, allowance refresh, override, execution and responsive/accessibility states with `F5`; then begin M5 evaluation.
- **Later:** Evaluation-driven learning, automatic fallback and parallel agents.

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

**Status:** Validated by user in Extension Development Host (2026-10-28)

Outcome: ChePrompt shows the exact remaining allowance and reset windows when an official provider surface exposes them, without presenting guesses as account data.

Definition of done:

- [x] Add an optional `getUsageLimits()` capability to `RuntimeAdapter`.
- [x] Represent usage window, remaining percentage, reset time, source, observation time and freshness in typed contracts.
- [x] Implement OpenCode Go usage discovery through its official experimental usage-limits endpoint.
- [x] Confirm the endpoint's percentage semantics before normalizing to `remainingPercent`; do not infer whether a raw percentage means used or remaining.
- [x] Show every reported window separately, including rolling, weekly and monthly meters when present.
- [x] Display the data source and last refresh time next to each percentage.
- [x] Display `Not available` when a runtime does not officially expose a percentage; do not estimate it or scrape dashboards.
- [x] Treat missing, stale or malformed usage data as unknown, never as zero allowance.
- [x] Add offline unit tests for exact windows, unsupported usage, stale data and malformed responses.
- [x] Preserve the existing routing and explicit execution confirmation; quota-aware scoring belongs to M4.

Result: OpenCode's official schema defines each meter's raw `percent` as the portion already used, so ChePrompt displays `100 - percent` as remaining. The UI refreshes through the official `opencode api` client and hides data once older than five minutes. No live account was queried during tests.

Limitations: the endpoint is experimental and its errors/changed schemas display as unknown. No usage data is stored; fresh official usage now participates in M4 routing, while stale/unknown usage remains unknown.

Dependencies:

- OpenCode's `/api/experimental/usage/limits` contract is experimental and must fail gracefully if it changes.
- Provider credentials remain in official stores and must never be logged or rendered.

## Next

### M2 — Unified execution inside ChePrompt

**Status:** Validated by user in Extension Development Host (2026-10-28)

Outcome: prompts, streaming output, cancellation and errors remain in the ChePrompt panel instead of opening an unmanaged terminal.

Definition of done:

- [x] Add a runtime execution result/event contract.
- [x] Stream OpenCode output into the webview.
- [x] Support cancellation and a visible terminal fallback for interactive approvals.
- [x] Never enable blanket auto-approval by default.
- [x] Add integration tests around process lifecycle and malformed output.

Result: OpenCode runs with `--format json` and no `--auto`; text/tool/step/error events stream into the panel. The user can cancel or open the same session in an interactive TUI when approval is needed. Process creation, cancellation, session capture, permission fallback and malformed JSONL are covered with fake processes.

Limitations: `opencode run` is non-interactive and rejects permission requests; ChePrompt surfaces the request and lets the user cancel and attach the session in the interactive TUI. The user later confirmed the integrated M1.5/M2/M3/M3.5 flows in Extension Development Host.

### M3 — Claude Pro through Claude Code

**Status:** Validated by user in Extension Development Host (2026-10-28)

Outcome: ChePrompt can select Claude Pro by invoking the official Claude Code CLI directly.

Definition of done:

- [x] Install the official Claude Code CLI (native version 2.1.312) and authenticate with the user's Claude Pro account.
- [x] Implement `ClaudeCodeAdapter` without copying Claude credentials into ChePrompt.
- [x] Detect quota/auth failures and mark the runtime temporarily unavailable.
- [x] Stream execution through the same M2 event contract.
- [x] Show `Not available` because the official CLI/docs reviewed do not expose an exact remaining subscription percentage.
- [x] Document that Claude Pro credentials must not be reused through OpenCode plugins.

Result: Claude Code is exposed as an explicit runtime choice after route review. The adapter checks the official CLI auth status, accepts only Claude subscription OAuth methods, filters API-key and third-party provider environment overrides, and streams `stream-json` events without automatic permission bypass. Auth/quota failures cool the runtime down for one minute. The user confirmed successful Claude Pro sign-in and a live execution smoke test on 2026-10-28.

Limitations: exact Claude subscription usage remains unavailable. The user confirmed Claude execution during the combined M1.5/M2/M3/M3.5 validation; the new M4 automatic route still needs its own F5 check.

### M3.5 — ChatGPT/Codex runtime

**Status:** Validated by user in Extension Development Host (2026-10-28)

Outcome: ChePrompt can select the user's officially authenticated OpenAI coding runtime without copying account credentials.

Definition of done:

- [x] Identify and document the supported official CLI/API integration for the user's ChatGPT/Codex subscription.
- [x] Implement an adapter behind the shared discovery and M2 execution contracts.
- [x] Detect authentication and quota failures without reading or exposing raw credentials.
- [x] Include exact remaining usage only if the official integration exposes it; otherwise show `Not available`.
- [x] Exclude the runtime after 2026-11-21 unless the subscription is renewed or a separate eligible OpenAI account is configured.
- [x] Sign in through the official Codex CLI with ChatGPT; user confirmed successful sign-in.
- [x] Validate Codex execution and M1.5/M2/M3/M3.5 together in Extension Development Host; user confirmed the integrated flow.

Result: ChePrompt uses the official [Codex CLI authentication status](https://developers.openai.com/codex/auth) and `codex exec --json` with `--sandbox workspace-write --ask-for-approval on-request`, following OpenAI's [non-interactive mode](https://developers.openai.com/codex/non-interactive-mode). Credentials remain in Codex's official store; API-key environment overrides are removed consistently during discovery and execution. ChatGPT subscription and API-key usage are represented as separate allowance pools. Authentication and quota failures temporarily disable the runtime, and no raw process diagnostics or credentials are shown.

Limitations: Codex's documented [`/usage` command](https://developers.openai.com/codex/developer-commands#view-account-usage-with-usage) reports token activity, not an exact remaining subscription percentage, so ChePrompt shows `Not available`. The ChatGPT subscription expiry defaults to 2026-11-22 UTC (the user's reported final subscription day is 2026-11-21); update `cheprompt.codex.chatgptSubscriptionExpiresAt` if renewed. Codex CLI 0.165.0 writes its successful `codex login status` line to stderr; the adapter inspects both stdout and stderr. The user confirmed Codex execution in the integrated M1.5/M2/M3/M3.5 Extension Development Host test.

### M4 — Adaptive transparent router

**Status:** Implementation complete; M4-specific Extension Development Host validation pending (2026-10-28)

Outcome: one ChePrompt submission is routed across OpenCode Go, Claude Code and ChatGPT/Codex according to task fit, expected usage, context needs, capabilities, availability and expiration.

Definition of done:

- [x] Replace the three-model hardcoded decision with scoring over discovered candidates.
- [x] Score across runtime boundaries: OpenCode Go, Claude Code and ChatGPT/Codex compete in one candidate set.
- [x] Include discovered OpenCode Go models such as `opencode-go/deepseek-v4.1-flash`, `opencode-go/deepseek-v4-pro` and eligible GPT models instead of limiting the catalog to Luna, Argon and Kimi.
- [x] Treat each runtime/provider allowance pool independently even when two candidates belong to the same model family.
- [x] Keep provider selection automatic in the default flow: the user submits one prompt and receives one routed execution in ChePrompt.
- [x] Keep routing local and deterministic by default so selection itself spends no tokens.
- [x] Show score components, selected runtime/model and up to two eligible alternatives.
- [x] Support `economy`, `balanced` and `quality` policies.
- [x] Model the ChatGPT subscription as unavailable after 2026-11-21 unless renewed.
- [x] Allow a manual override without changing the default automatic flow; the decision is recomputed and reviewed before execution.
- [x] Use fresh provider-reported remaining allowance as a routing constraint when available.
- [x] Never compare an unknown or locally inferred percentage as if it were an official quota value.

Result: `routePrompt` now scores only discovered, eligible candidates across OpenCode Go, Claude Code and Codex. It returns a deterministic score breakdown, selected allowance pool, fresh official allowance details when available, confidence and ranked alternatives. Extension discovery completes before analysis; refreshing inventory or usage re-evaluates the pending route without executing it. Manual override updates the displayed decision and still requires explicit execution approval. The Codex subscription and API-key pools remain distinct.

Limitations: scoring weights and task-signal heuristics are initial hypotheses, not evaluated quality claims; M5 will measure outcomes before recalibration. Claude/Codex context and exact usage remain unknown when their official surfaces do not report them. The user should validate the new automatic cross-runtime selection, score display, manual override/review, runtime execution and refreshed-allowance rerouting with F5 before M4 is marked fully validated.

### M4.5 — Terminal-inspired fluorescent UI

**Status:** Implementation complete; Extension Development Host validation pending (2026-10-28)

Outcome: ChePrompt presents routing, allowances and execution in a compact dark interface inspired by OpenCode's terminal UI, with a distinct hornero identity and restrained fluorescent accents.

Design contract: [`docs/UI.md`](UI.md).

Definition of done:

- [x] Implement the documented graphite, fluorescent-cyan, lime, magenta and hornero-terracotta token system without copying OpenCode assets or exact layouts.
- [x] Keep the prompt composer as the primary element and support `Cmd/Ctrl + Enter`.
- [x] Present allowance pools for OpenCode Go, Claude Pro and ChatGPT/Codex separately.
- [x] Show selected runtime/model, routing reason, allowance source, confidence and two alternatives before execution.
- [x] Keep streaming output, cancellation and interactive approval fallback in the same visual language.
- [x] Add subtle Argentine microcopy and the hornero mark without compromising technical clarity.
- [x] Meet WCAG AA contrast, visible keyboard focus, reduced-motion behavior and non-color status cues.
- [ ] Validate narrow sidebar widths, a wider panel and 200% zoom in Extension Development Host.
- [x] Add UI regression coverage for the main idle, routing, executing, approval, unavailable and error states.

Result: The panel now uses the graphite/flúor/hornero token system, a compact per-pool allowance strip, a prominent `Dale` composer with `Cmd/Ctrl + Enter`, a score-and-alternatives route card, and a chronological execution surface. Statuses have text labels in addition to color; focus, reduced-motion and AA token contrast are covered, and UI logic has VM-based regression tests.

Limitations: manual F5 validation is still needed for the combined automatic route and execution flow, sidebar widths, wider panel and 200% zoom. Scoring remains an initial hypothesis pending M5 evaluation.

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
