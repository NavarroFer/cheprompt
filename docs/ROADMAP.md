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
- **Completed:** M4/M4.5/M5/M6 implementation and integrated Extension Development Host validation (user-confirmed 2026-10-28).
- **Now:** M7 implementation complete; integrated Extension Development Host validation pending.
- **Next:** Commit the tested M7 implementation atomically so the repo is clean, then press `F5` and validate the reviewed two-subtask flow, clean-repository gate, cancellation, retained worktrees, history privacy and cleanup controls.
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

**Status:** Validated by user in Extension Development Host (2026-10-28)

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

Limitations: scoring weights and task-signal heuristics remain hypotheses, not evaluated quality claims. Claude/Codex context and exact usage remain unknown when their official surfaces do not report them. Keep weights unchanged unless verified outcomes support recalibration.

### M4.5 — Terminal-inspired fluorescent UI

**Status:** Validated by user in Extension Development Host (2026-10-28)

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
- [x] Validate narrow sidebar widths, a wider panel and 200% zoom in Extension Development Host.
- [x] Add UI regression coverage for the main idle, routing, executing, approval, unavailable and error states.

Result: The panel now uses the graphite/flúor/hornero token system, a compact per-pool allowance strip, a prominent `Dale` composer with `Cmd/Ctrl + Enter`, a score-and-alternatives route card, and a chronological execution surface. Statuses have text labels in addition to color; focus, reduced-motion and AA token contrast are covered, and UI logic has VM-based regression tests.

Limitations: scoring remains an initial hypothesis; keep weights unchanged unless verified outcomes support recalibration.

## Later

### M5 — Evaluation and outcome history

**Status:** Validated by user in Extension Development Host; representative synthetic outcomes collected (2026-10-28)

- [x] Build a 20-task synthetic evaluation set stratified across simple, standard and complex tasks.
- [x] Record selected runtime/model, allowance pool, routing reason, score, latency, reported token usage, CLI-reported retries and execution status.
- [x] Capture a user-marked verification outcome without retaining raw production prompts.
- [x] Keep history local and bounded; retain no payment data and no raw prompts.
- [x] Keep routing weights unchanged until verified outcomes provide evidence for recalibration.

Result: A 20-case synthetic set (5 simple, 10 standard, 5 complex) can be loaded manually from the panel. Each completed execution creates a local history record with route metadata, latency, token counts only when the official CLI reports them, retries only when reported, execution result and a user-entered verification outcome. History is capped at 100 records and never stores the submitted prompt. No automatic provider calls or LLM judge are used by the benchmark.

Limitations: the synthetic set is not proof of optimal routing. Keep weights unchanged unless verified outcome evidence supports recalibration.

### M6 — Escalation and fallback

**Status:** Validated by user in Extension Development Host (2026-10-28)

- [x] Classify authentication, quota, tool, process, protocol and approval failures; only objective runtime failures or a user-marked verification failure propose a fallback. Low confidence (<65%) is surfaced for human review.
- [x] Cap each analyzed task at two ChePrompt executions total (initial run plus at most one fallback); do not retry cancelled, approval-pending or protocol-failure executions automatically.
- [x] Recompute the fallback route from currently eligible candidates and fresh official allowance constraints; show `Not available` when a quota is unknown rather than treating it as zero.
- [x] Explain the failure cause, proposed runtime/model, allowance pool and remaining attempt budget; require explicit review and execution approval before fallback.
- [x] Validate objective fallback, approval/cancel exclusions, attempt-budget exhaustion and low-confidence notice in Extension Development Host.

Result: Failure kinds are normalized in the shared execution result. A failed execution can propose one alternate route, but never starts it automatically; the user reviews the new decision and presses the main execute action. A successful run closes the task cycle. The hard budget is two ChePrompt executions per analysis, with exhausted/unknown provider allowance still governed by official pool data when available.

Limitations: the budget limits ChePrompt execution attempts, not provider billing units. It does not estimate cost or quota from local token counts; if the provider does not report remaining allowance, the UI says `Not available` and the user must review the fallback. Real verification outcomes have not yet been collected, so routing weights remain unchanged.

### M7 — Parallel agents and worktrees

**Status:** Implementation complete; Extension Development Host validation pending (2026-10-28)

- [x] Let the user define and review exactly two independent subtasks before execution; do not auto-decompose the parent prompt.
- [x] Route and execute the reviewed pair concurrently with an explicit confirmation; never enable blanket auto-approval.
- [x] Create one Git worktree per subtask from one pinned commit and a clean repository state; block safely when the workspace is dirty or is not a Git repository.
- [x] Keep worktrees available for inspection; offer explicit open/remove actions and never auto-merge or delete them.
- [x] Persist one parent run record linking child routes/results and aggregate officially reported usage without storing raw prompts.
- [x] Show per-child status and compare wall-clock duration with summed child durations as an observed parallelism indicator, not a guaranteed speedup.
- [x] Add tests for task validation, worktree lifecycle, interruption recovery, record privacy and aggregation.
- [ ] Validate the full flow in Extension Development Host, including clean/dirty repository behavior and worktree inspection/removal.

Scope decision: M7 starts with explicit user-authored subtasks. ChePrompt will not invent a decomposition or merge agent changes automatically.
Implementation note: the first slice is deliberately capped at two subtasks. Parallel history is local and retains route/result metadata but never the subtask prompts. Worktrees persist until the user explicitly removes them.

### M8 — Chat-like single-step execution

Scope expanded explicitly by the user on 2026-10-28, while M7 Extension Development Host validation is still pending.

- [x] Execute the automatically chosen route as soon as the prompt is sent (`cheprompt.executeOnSend`, default on); keep the decision card visible during the run and allow restoring review mode.
- [x] Keep fallback proposals and manual overrides behind explicit review.
- [x] List workspace files created, modified or deleted during a single execution (Git-ignored, `.git` and `node_modules` paths hidden) and open each one in VS Code's diff view.
- [x] Show the file, pattern or command targeted by each OpenCode tool event.
- [ ] Validate in Extension Development Host: send → immediate run, live change list and diff opening, review mode with the setting disabled.

Limitations: the change list reflects files touched in the workspace during the run, including edits made by the user at the same time. Claude Code and Codex tool lines still show only the tool name. Parallel M7 tasks keep their own worktree inspection controls.

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
