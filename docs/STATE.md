# ChePrompt continuity state

Updated: 2026-10-27

This file is the compact handoff for the next human or coding-agent session.

## Current milestone

M1 — Runtime inventory and stable contracts.

Status: Not started.

Exact next action: implement only M1 using the acceptance criteria in `docs/ROADMAP.md`.

## Repository state

- Project: `/Users/fernandonavarro/src/cheprompt`
- Branch: `main`
- Latest verified commit before these docs: `41db46d fix: register router as a webview`
- Build: passing.
- Tests: 5 passing.
- npm audit: no known vulnerabilities after removing the optional publishing dependency.
- Distribution: local only; Marketplace publishing is out of scope.

## What works

- The ChePrompt activity icon opens a VS Code webview.
- The panel accepts a prompt and one of three routing profiles.
- A deterministic heuristic selects one of three OpenCode Go models.
- The selection includes a reason, confidence and relative usage impact.
- Execution requires an explicit click and launches `opencode run`.
- The project can be installed locally with `npm run install:local`.

## What is not yet validated or implemented

- The current heuristic does not prove that it chooses the best model.
- Model availability and provider authentication are not discovered dynamically.
- Output is not streamed back into ChePrompt.
- Claude Code is not installed and has no adapter.
- ChatGPT is not connected to OpenCode.
- Usage, latency and task outcomes are not recorded.
- Automatic fallback and multi-agent execution do not exist.

## Provider reality

| Runtime/provider | Current state | Eligibility rule |
| --- | --- | --- |
| OpenCode Go | Connected | Eligible while authenticated and within its usage limits. |
| ChatGPT | Not connected | User reports subscription ends 2026-11-21; exclude after that date unless renewed. |
| Claude Pro | Subscription exists; Claude CLI not installed | Use only through official Claude Code, never through OpenCode subscription plugins. |
| Anthropic API | Not configured | Eligible only if the user separately adds a paid API key. |

OpenCode authentication was last checked with `opencode auth list`; only `OpenCode Console / Personal` was stored.

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

## Session completion checklist

Before ending a session:

- [ ] Tests and type checking pass.
- [ ] Roadmap milestone status is updated.
- [ ] This file reflects the real provider and implementation state.
- [ ] Limitations and blockers are recorded.
- [ ] The exact next action is written above.
- [ ] Completed work has an atomic commit.
