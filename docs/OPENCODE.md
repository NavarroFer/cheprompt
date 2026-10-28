# Continue ChePrompt with OpenCode Go

Use OpenCode Go for day-to-day implementation to preserve other coding-agent credits. Use stronger or separate assistants for architecture review, security review and difficult blockers.

## Start a session

1. Open `/Users/fernandonavarro/src/cheprompt` in VS Code.
2. Press `Cmd + Esc` to open OpenCode, or run `opencode` in the integrated terminal.
3. Run `/models`.
4. For ordinary implementation, start with `opencode-go/gpt-6-luna` because its Go allowance is substantially larger than the most expensive frontier choices.
5. Use a stronger Go model only when the task is demonstrably complex or the first implementation fails objective verification.

Current Go limits and model availability can change. Check the official guide before hardcoding new assumptions:

- <https://opencode.ai/v2/docs/console/go/>

## Rules for every OpenCode session

- Read `AGENTS.md`, `docs/STATE.md` and `docs/ROADMAP.md` first.
- Work on one milestone only.
- Do not enable blanket `--auto` approval.
- Do not store credentials or raw subscription tokens.
- Do not claim routing quality without evaluation evidence.
- Keep routing logic independent from VS Code APIs.
- Run all validation before updating milestone status.
- Update the continuity documents before committing.

## Prompt for M1 (completed)

Copy this entire prompt into OpenCode:

```text
Implement ChePrompt milestone M1: Runtime inventory and stable contracts.

Before changing anything:
1. Read AGENTS.md, README.md, docs/ROADMAP.md and docs/STATE.md completely.
2. Inspect the existing TypeScript architecture and tests.
3. Restate the M1 acceptance criteria and propose a concise implementation plan.
4. Do not work on M2 or later milestones.

Implementation requirements:
- Introduce a RuntimeAdapter contract that does not depend on VS Code APIs.
- Add typed representations for runtime, provider, model, availability, capabilities, expiration and relative usage impact.
- Implement an OpenCodeAdapter that can check whether the CLI exists and list available models.
- Inject process execution behind a small interface so unit tests use fakes and never call the network or real provider credentials.
- Update routing so unavailable or expired candidates are excluded before scoring.
- Show the discovered runtime/provider/model inventory in the ChePrompt panel without exposing credentials.
- Preserve the explicit review and execute step.
- Keep the existing behavior working when discovery succeeds.
- Handle missing CLI, malformed output and empty model lists with clear user-facing errors.

Validation requirements:
- Run npm run check.
- Run npm test.
- Add focused tests for available models, missing CLI, malformed output and expiration filtering.
- If UI behavior changes, describe the exact manual F5 validation steps.

Before finishing:
- Update docs/ROADMAP.md and docs/STATE.md with the real result, remaining limitations and exact next action.
- Show git diff --stat and git status --short.
- Create one atomic commit named: feat: add runtime inventory
- Report files changed, tests run and any blockers.
```

## Prompt for M1.5

Copy this entire prompt into OpenCode:

```text
Implement ChePrompt milestone M1.5: Provider-reported usage visibility.

Before changing anything:
1. Read AGENTS.md, README.md, docs/ROADMAP.md, docs/STATE.md and the existing adapter/tests completely.
2. Run git status --short, npm run check and npm test.
3. Restate the M1.5 acceptance criteria and propose a concise plan.
4. Do not work on M2 or later milestones.

Implementation requirements:
- Extend RuntimeAdapter with an optional usage-limit capability without coupling it to VS Code APIs.
- Add typed usage snapshots containing runtime ID, provider, window label, remaining percentage, reset time, source, observedAt and freshness.
- Implement OpenCode Go usage discovery using the official `/api/experimental/usage/limits` endpoint.
- Verify from the official response/docs whether each raw `percent` means used or remaining before converting it to `remainingPercent`; never guess the direction.
- Preserve rolling, weekly and monthly windows separately when present.
- Keep authentication in the official OpenCode store. Never log, persist or render raw tokens.
- Fetch through an injected interface so tests never call the network or real accounts.
- Show percentage, reset time, source and last refresh in the ChePrompt panel.
- Show `Not available` for runtimes without an official percentage. Do not estimate it, scrape dashboards or call private endpoints.
- Treat unsupported, stale and malformed data as unknown, not as zero allowance.
- Do not change routing scores yet; quota-aware routing belongs to M4.
- Preserve explicit review and execution confirmation.

Validation requirements:
- Run npm run check.
- Run npm test.
- Add focused tests for exact multi-window usage, raw percentage normalization, unsupported usage, stale snapshots and malformed responses.
- Manually validate the panel with F5 and document the observed states.

Before finishing:
- Update docs/ROADMAP.md and docs/STATE.md with the real result, limitations and exact next action.
- Show git diff --stat and git status --short.
- Create one atomic commit named: feat: show provider usage limits
- Report files changed, tests run, manual validation and blockers.
```

## If the session runs out of context or quota

Start a fresh OpenCode session and send:

```text
Resume ChePrompt from the repository state, not from assumptions. Read AGENTS.md, docs/STATE.md and docs/ROADMAP.md. Run git status --short and npm test. Continue only the current milestone and update the continuity documents before finishing.
```

## When to return to this chat

Use a stronger review here when:

- OpenCode reports conflicting architecture choices.
- A provider restriction or authentication question appears.
- Tests pass but the end-to-end behavior is wrong.
- The milestone requires changing the roadmap.
- You want a security or privacy review before storing run history.

## Expected handoff after the current milestone

Bring back:

- the latest commit hash;
- the final OpenCode summary;
- any failing test or screenshot;
- the updated `docs/STATE.md`.

That is enough to review the milestone without replaying the entire agent conversation.
