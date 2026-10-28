# ChePrompt continuity state

Updated: 2026-10-28

This file is the compact handoff for the next human or coding-agent session.

## Current milestone

M3 — Claude Pro through Claude Code.

Status: Implementation complete; Claude Pro sign-in and manual F5 validation pending (2026-10-28). M1.5/M2 visual checks also remain pending by the user's request to test everything later.

Exact next action: integrate the M3.5 Codex adapter being developed in an isolated worktree. Before declaring these milestones done, the user must sign in to Claude Pro through the official Claude Code terminal flow and validate M1.5, M2, M3 and M3.5 together with `F5`. Do not start M4 until integration and validation.

## Repository state

- Project: `/Users/fernandonavarro/src/cheprompt`
- Branch: `main`
- M1 atomic commit: `feat: add runtime inventory`.
- M1.5 atomic commit: `feat: show provider usage limits`.
- M2 implementation commit: `feat: stream OpenCode execution in panel`.
- M3 implementation commit: `feat: add Claude Code runtime`.
- M3.5 adapter: in progress in an isolated worktree; not yet integrated.
- Build: passing.
- Tests: 28 passing, including fake OpenCode/Claude process lifecycle, streaming, auth/quota, cancellation and malformed output.
- npm audit: no known vulnerabilities after removing the optional publishing dependency.
- Distribution: local only; Marketplace publishing is out of scope.

## What works

- The ChePrompt activity icon opens a VS Code webview.
- The panel accepts a prompt and one of three routing profiles.
- A deterministic heuristic selects one of three OpenCode Go models.
- The selection includes a reason, confidence and relative usage impact.
- OpenCode CLI/model discovery populates a typed runtime/provider/model inventory in the panel.
- Routing excludes unavailable and expired discovered models before selection.
- Official OpenCode Go rolling, weekly and monthly usage windows are shown with remaining percentage, reset time, source and observation time.
- Usage can be refreshed manually; snapshots older than five minutes are shown as `Not available`.
- OpenCode text, tool, step and error events stream into the panel after explicit execution.
- Running executions can be cancelled; the interactive terminal fallback can attach to the same OpenCode session.
- Claude Code 2.1.312 is installed from Anthropic's official native installer. Its adapter checks auth status without storing account details and the panel offers a user-initiated official login.
- Claude Code execution uses the shared streaming event contract; auth/quota failures temporarily disable it. No remaining-usage percentage is estimated.
- The CLI is never launched with `--auto`.
- The project can be installed locally with `npm run install:local`.

## What is not yet validated or implemented

- The current heuristic does not prove that it chooses the best model.
- Provider authentication and model reachability are not independently validated; usage is shown only when the official OpenCode usage API reports it.
- M1.5 and M2 UI flows have not been exercised in Extension Development Host.
- Claude Code is not authenticated with Claude Pro and has not been run against a live account.
- ChatGPT is not connected to OpenCode.
- Historical usage, latency and task outcomes are not recorded.
- Automatic fallback and multi-agent execution do not exist.

## Provider reality

| Runtime/provider | Current state | Eligibility rule |
| --- | --- | --- |
| OpenCode Go | Connected; current catalog includes DeepSeek V4.1 Flash, DeepSeek V4 Pro and GPT models | Eligible while authenticated and within its Go usage limits. DeepSeek should use the `opencode-go/*` route, not a separately billed API route. |
| ChatGPT/Codex | Adapter in progress | User reports subscription ends 2026-11-21; exclude after that date unless renewed. |
| Claude Pro | Subscription exists; Claude Code 2.1.312 installed but not authenticated | Authenticate and execute only through official Claude Code, never through OpenCode subscription plugins. |
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
- DeepSeek V4.1 Flash is eligible through `opencode-go/deepseek-v4.1-flash`, so it does not require a separate DeepSeek API account for this user.
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

M1.5 validation on 2026-10-27: `npm run check`, `npm test` (15 tests), `node --check media/main.js` and `git diff --check` passed. Tests use a fake process executor; no live account/API call was made. Extension Development Host could not be opened from this session, so F5 validation is the blocker and remains the exact next action.

M2 validation on 2026-10-28: `npm run check`, `npm test` (19 tests), `node --check media/main.js` and `git diff --check` passed. Process tests use a fake spawner and never launch OpenCode. F5 validation remains pending.

M3 validation on 2026-10-28: `npm run check`, `npm test` (28 tests), `node --check media/main.js` and `git diff --check` passed. Claude Code `2.1.312` installation verified with `claude --version`; no `claude auth status`, login, live request, or credential inspection was performed. Claude Pro sign-in and F5 validation remain pending.

## Session completion checklist

Before ending a session:

- [x] Tests and type checking pass.
- [x] Roadmap milestone status is updated.
- [x] This file reflects the real provider and implementation state.
- [x] Limitations and blockers are recorded.
- [x] The exact next action is written above.
- [x] Completed work has an atomic commit.
