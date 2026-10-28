# ChePrompt continuity state

Updated: 2026-10-28

This file is the compact handoff for the next human or coding-agent session.

## Current milestone

M7 — Parallel agents and worktrees.

Status: User confirms integrated M4/M4.5/M5/M6 Extension Development Host validation, responsive checks and representative synthetic outcomes are complete (2026-10-28). M7 scope is explicit user-authored independent subtasks, isolated worktrees, reviewed execution, and one parent record; implementation is in progress.

Exact next action: implement reviewed multi-subtask routing/execution with isolated worktrees and parent/child outcome attribution; retain worktrees for user review, never auto-merge, and run `npm run check` plus `npm test`.

## Repository state

- Project: `/Users/fernandonavarro/src/cheprompt`
- Branch: `main`
- M1 atomic commit: `feat: add runtime inventory`.
- M1.5 atomic commit: `feat: show provider usage limits`.
- M2 implementation commit: `feat: stream OpenCode execution in panel`.
- M3 implementation commit: `feat: add Claude Code runtime`.
- M3.5 adapter: integrated; user confirmed Codex ChatGPT sign-in and successful Codex execution smoke test. Claude Pro sign-in/execution smoke test also confirmed. User reports the combined M1.5/M2/M3/M3.5 Extension Development Host flow passed.
- M4 implementation commit: `1640cea feat: add adaptive cross-runtime routing`.
- M4.5 visual implementation commit: `b3dee8a feat: apply terminal-inspired UI system`.
- M5 synthetic evaluation set and local, prompt-free outcome history are implemented; user confirms representative cases were run and verified.
- M6 failure classification, reviewed fallback and two-attempt budget are implemented and user-confirmed in Extension Development Host.
- M7 explicit-subtask scope selected; implementation is in progress.
- Build/typecheck: passing (`npm run check`).
- Tests: 66 passing, including cross-runtime scoring, fallback limits, webview regression and evaluation-history privacy/retention tests.
- npm audit: no known vulnerabilities after removing the optional publishing dependency.
- Distribution: local only; Marketplace publishing is out of scope.

## What works

- The ChePrompt activity icon opens a VS Code webview.
- The panel accepts a prompt and one of three routing profiles.
- A deterministic local scorer selects among discovered, eligible OpenCode Go, Claude Code and Codex candidates.
- The selection includes its runtime/model, reason, score breakdown, confidence, allowance pool and ranked alternatives.
- Runtime discovery populates typed provider/model inventories; OpenCode Go supplies official usage snapshots when available.
- Routing excludes unavailable and expired discovered models before selection.
- M4 router scores discovered OpenCode Go, Claude Code and Codex candidates locally and deterministically; the automatic selection shows runtime/provider, score components, allowance pool and ranked alternatives.
- Fresh official OpenCode Go allowance can constrain routing; stale, unknown or unsupported quota remains unknown, not zero. Inventory/usage refresh recalculates an unexecuted decision for review.
- Manual candidate/runtime override updates the displayed route and still requires the main execute action for approval.
- Official OpenCode Go rolling, weekly and monthly usage windows are shown with remaining percentage, reset time, source and observation time.
- Usage can be refreshed manually; snapshots older than five minutes are shown as `Not available`.
- OpenCode text, tool, step and error events stream into the panel after explicit execution.
- Running executions can be cancelled; the interactive terminal fallback can attach to the same OpenCode session.
- Claude Code 2.1.312 is installed from Anthropic's official native installer; user confirmed Claude Pro login and a successful live execution smoke test. Credentials remain in Claude Code.
- Claude Code execution uses the shared streaming event contract; auth/quota failures temporarily disable it. No remaining-usage percentage is estimated.
- Codex CLI discovery uses `codex login status`; execution streams official JSONL events with workspace-write sandboxing and on-request approvals. API-key environment overrides are removed and ChatGPT/API usage pools are kept distinct.
- Codex CLI 0.165.0 installed from OpenAI's official standalone installer; `codex --version` verified. User confirmed ChatGPT sign-in and successful live Codex execution.
- Codex auth/quota failures temporarily disable the runtime. Codex usage is `Not available` because the official `/usage` command reports token activity, not an exact remaining percentage.
- The panel offers 20 synthetic evaluation cases and stores local outcome records capped at 100 entries. Records include route, runtime/model, latency, officially reported token usage, reported retries and manual verification, but never the raw prompt or payment data.
- The CLI is never launched with `--auto`.
- The project can be installed locally with `npm run install:local`.

## What is not yet validated or implemented

- The current heuristic does not prove that it chooses the best model.
- Runtime auth is checked through official CLIs, but model reachability is not independently validated; exact remaining usage is available only where an official provider surface reports it.
- M7 parallel execution, worktree lifecycle, parent/child attribution and UI flow remain to be implemented and validated.
- The scoring matrix is still an initial hypothesis and does not prove optimal model choice; keep weights unchanged unless verified outcome evidence supports recalibration.
- Historical usage, latency and task outcomes are not recorded.
- Automatic fallback and multi-agent execution do not exist.

## Provider reality

| Runtime/provider | Current state | Eligibility rule |
| --- | --- | --- |
| OpenCode Go | Connected; current catalog includes DeepSeek V4.1 Flash, DeepSeek V4 Pro and GPT models | Eligible while authenticated and within its Go usage limits. DeepSeek should use the `opencode-go/*` route, not a separately billed API route. |
| ChatGPT/Codex | User confirms sign-in, panel recognition and successful execution smoke test | User reports subscription ends 2026-11-21; exclude after that date unless renewed. API-key authentication is a separate billing pool. |
| Claude Pro | Authenticated; user confirmed a live execution smoke test | Execute only through official Claude Code, never through OpenCode subscription plugins. |
| Anthropic API | Not configured | Eligible only if the user separately adds a paid API key. |

OpenCode authentication was last checked with `opencode auth list`; only `OpenCode Console / Personal` was stored.

## Usage-limit visibility policy

- Display a percentage only when an official provider API or authenticated official CLI reports it.
- Keep each usage window separate and include its reset time.
- Record the source and observation time so stale data is visible.
- Show `Not available` when Claude, ChatGPT or another runtime does not expose an official percentage.
- Do not reverse-engineer private endpoints, scrape web dashboards or infer subscription quota from local prompt counts.
- OpenCode Go is the first exact integration candidate through its official experimental usage-limits endpoint.
- Absence of quota data means unknown, not exhausted.
- The official schema defines raw `percent` as allowance already used; ChePrompt converts it to remaining with `100 - percent`.
- The official CLI's `api` command resolves the managed server and stored credentials; ChePrompt does not read credentials.

## Architectural decisions

- ChePrompt is a meta-router across runtimes, not merely an OpenCode model picker.
- ChePrompt remains the only prompt surface: provider/model selection is automatic by default and execution/output return to the same panel.
- The M4 candidate set spans DeepSeek and GPT models from OpenCode Go, Claude Pro through Claude Code, and GPT through ChatGPT/Codex.
- Model identity includes its runtime and allowance pool; `opencode-go/gpt-*` usage must not be conflated with ChatGPT/Codex subscription usage.
- The default execute button runs the currently reviewed cross-runtime route; choosing Claude or Codex as an override first updates the decision card and then still requires explicit execution.
- Use the official Codex CLI (`codex login status`, `codex exec --json`) only; keep credentials in its own store and remove API-key environment overrides for consistent discovery/execution.
- Codex `/usage` token activity is not an exact remaining quota, so display `Not available` rather than estimating.
- DeepSeek V4.1 Flash is eligible through `opencode-go/deepseek-v4.1-flash`, so it does not require a separate DeepSeek API account for this user.
- The approved visual direction is a compact dark TUI inspired by OpenCode, using restrained fluorescent cyan, lime and magenta plus hornero terracotta; the concrete contract is in `docs/UI.md` and implementation belongs to M4.5.
- Use adapters so OpenCode and Claude Code share one execution contract.
- Perform initial routing locally to avoid spending tokens on model selection.
- Optimize expected successful completion under a usage budget, not raw first-call price.
- Keep provider credentials in their official CLIs.
- Preserve human approval for tool execution.
- Add complexity only after evaluation evidence demonstrates a benefit.

## Validation commands

```bash
npm run check
npm test
git status --short
```

For UI work, press `F5` and validate the flow in Extension Development Host. For the locally linked copy, compile and run **Developer: Reload Window**.

M1 validation on 2026-10-27: `npm run check` passed; `npm test` passed (10 tests). UI was not manually exercised in Extension Development Host.

M1.5 validation on 2026-10-27: `npm run check`, `npm test` (15 tests), `node --check media/main.js` and `git diff --check` passed. Tests use a fake process executor; no live account/API call was made.

M2 validation on 2026-10-28: `npm run check`, `npm test` (19 tests), `node --check media/main.js` and `git diff --check` passed. Process tests use a fake spawner and never launch OpenCode.

M3 validation on 2026-10-28: `npm run check`, `npm test` (29 tests), `node --check media/main.js` and `git diff --check` passed. Claude Code `2.1.312` installation verified with `claude --version`; the user later confirmed official sign-in and live execution.

M3.5 validation on 2026-10-28: `npm run check`, `npm test` (41 tests), `node --check media/main.js` and `git diff --check` passed. The user confirmed Codex ChatGPT sign-in and live execution; the auth parser handles CLI 0.165.0 status output on stderr. The user also confirmed the integrated M1.5/M2/M3/M3.5 Extension Development Host checks.

M4 implementation validation on 2026-10-28: `npm run check`, `npm test` (54 tests), `node --check media/main.js` and `git diff --check` passed. Router tests cover deterministic cross-runtime scoring, score explanations, profiles, expiry, isolated allowance pools, limited flags and unknown/stale/malformed official usage. User confirmed integrated F5 validation on 2026-10-28; routing weights remain uncalibrated.

M4.5 implementation validation on 2026-10-28: `npm run check`, `npm test` (58 tests), `node --check media/main.js` and `git diff --check` passed. Webview regression tests cover Cmd/Ctrl+Enter, route/pool/score/alternative rendering, stream/cancel/approval/error states, AA token contrast, focus, reduced motion and narrow-layout rules. User confirmed manual Extension Development Host validation at narrow/wide widths and 200% zoom.

M5 implementation validation on 2026-10-28: `npm run check`, `npm test` (63 tests), `node --check media/main.js` and `git diff --check` passed. The 20-case synthetic set is stratified 5/10/5; local history is capped at 100 and tested to reject prompt-bearing records. User confirms representative cases and verification outcomes were collected. Codex/Claude token counts are captured only when their official execution stream reports them; other usage and unreported retries remain unknown. No router weights were recalibrated.

M6 implementation validation on 2026-10-28: `npm run check` passed; `npm test` passed (66 tests). User confirmed integrated F5 validation of objective fallback, approval/cancel exclusions, attempt-budget exhaustion and low-confidence notice. Fallback remains explicitly reviewed and never auto-starts.

## Session completion checklist

Before ending a session:

- [x] Tests and type checking pass.
- [x] Roadmap milestone status is updated.
- [x] This file reflects the real provider and implementation state.
- [x] Limitations and blockers are recorded.
- [x] The exact next action is written above.
- [x] Completed work has an atomic commit.
