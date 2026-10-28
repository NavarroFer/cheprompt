# ChePrompt development guide

## Product goal

ChePrompt routes one coding task to an appropriate OpenCode model while making the decision, trade-offs and estimated usage impact visible before execution.

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

Add local run records containing model, routing reason, latency and verification outcome without storing raw prompts by default.
