# ChePrompt continuity state

Updated: 2026-10-27

This file is the compact handoff for the next human or coding-agent session.

## Current milestone

M1.5 — Provider-reported usage visibility.

Status: Implementation complete; manual F5 validation pending (2026-10-27).

Exact next action: open the Extension Development Host with `F5`, verify fresh usage, refresh, unsupported/unknown display and the analyze → review → explicit execute flow; record observed states and only then close M1.5. Do not start M2 before that validation.

## Repository state

- Project: `/Users/fernandonavarro/src/cheprompt`
- Branch: `main`
- M1 atomic commit: `feat: add runtime inventory`.
- M1.5 atomic commit: `feat: show provider usage limits`.
- Build: passing.
- Tests: 15 passing, including fake-process inventory, usage-window normalization and unknown/stale handling.
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
- Execution requires an explicit click and launches `opencode run`.
- The project can be installed locally with `npm run install:local`.

## What is not yet validated or implemented

- The current heuristic does not prove that it chooses the best model.
- Provider authentication and model reachability are not independently validated; usage is shown only when the official OpenCode usage API reports it.
- Output is not streamed back into ChePrompt.
- Claude Code is not installed and has no adapter.
- ChatGPT is not connected to OpenCode.
- Historical usage, latency and task outcomes are not recorded.
- Automatic fallback and multi-agent execution do not exist.

## Provider reality

| Runtime/provider | Current state | Eligibility rule |
| --- | --- | --- |
| OpenCode Go | Connected | Eligible while authenticated and within its usage limits. |
| ChatGPT | Not connected | User reports subscription ends 2026-11-21; exclude after that date unless renewed. |
| Claude Pro | Subscription exists; Claude CLI not installed | Use only through official Claude Code, never through OpenCode subscription plugins. |
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

## Session completion checklist

Before ending a session:

- [x] Tests and type checking pass.
- [x] Roadmap milestone status is updated.
- [x] This file reflects the real provider and implementation state.
- [x] Limitations and blockers are recorded.
- [x] The exact next action is written above.
- [x] Completed work has an atomic commit.
