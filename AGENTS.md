# ChePrompt development guide

## Product goal

ChePrompt routes one coding task to the most suitable eligible runtime and model while making the decision, trade-offs and estimated usage impact visible before execution.

## Architectural rules

- Keep routing logic pure and deterministic in `src/router.ts`.
- Keep VS Code APIs out of the router so it remains easy to test.
- Keep OpenCode process integration behind `src/opencode.ts`.
- Never store credentials or payment data.
- Do not execute a routed task before the user reviews the decision.
- Do not enable OpenCode `--auto` by default.
- Treat the initial model matrix as a hypothesis and change it only with evaluation evidence.

## Validation

Run these before considering a change complete:

```bash
npm run check
npm test
```

For UI changes, press `F5` and exercise analyze → review → execute in the Extension Development Host.

## Next milestone

Integrate the in-progress M3.5 adapter documented in `docs/ROADMAP.md`; do not start M4 until M1.5/M2/M3/M3.5 have been validated together in the Extension Development Host.

## Continuity protocol

Every coding agent must follow this protocol:

1. Read `docs/STATE.md` and `docs/ROADMAP.md` before proposing changes.
2. Work on only one milestone at a time unless the user explicitly expands scope.
3. Keep provider credentials outside the repository.
4. Run `npm run check` and `npm test` before finishing.
5. Update the milestone status and `docs/STATE.md` with completed work, validation, blockers and the exact next action.
6. Commit completed milestone work atomically.

If a session is interrupted, the repository documentation is the source of truth, not chat history.
