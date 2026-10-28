# ChePrompt UI direction

Updated: 2026-10-28

## Outcome

ChePrompt should feel as immediate and information-dense as a modern terminal UI while remaining a native-feeling VS Code panel. OpenCode's terminal interface is visual inspiration, not a template to copy. ChePrompt keeps its own identity: a subtle Argentine voice, an hornero mark and fluorescent accents over a restrained graphite surface.

## Principles

1. **One prompt is the center.** Provider selection stays automatic unless the user opens the override.
2. **Show the decision, not internal noise.** Runtime, model, allowance pool, reason and alternatives are visible before execution.
3. **Dense but calm.** Use compact spacing and monospace type without filling the screen with borders or glow.
4. **Fluorescent means state.** Neon colors identify selection, availability and action; they are not body-text colors.
5. **Argentine, not folkloric.** Use the hornero, concise Rioplatense microcopy and a warm terracotta accent. Avoid flags, escarapelas and decorative clichés.
6. **Accessible without color.** Every status also has a text label, icon or pattern.

## Design tokens

| Token | Value | Use |
| --- | --- | --- |
| `--cp-bg` | `#070A0F` | Main terminal surface |
| `--cp-surface` | `#0D131B` | Panels and composer |
| `--cp-surface-raised` | `#141D27` | Selected/expanded panels |
| `--cp-border` | `#263241` | Quiet separators |
| `--cp-text` | `#EAF2F8` | Primary readable text |
| `--cp-muted` | `#8D9BAA` | Metadata and secondary labels |
| `--cp-cyan` | `#39F2FF` | Selected runtime/model and keyboard focus |
| `--cp-lime` | `#B8FF3D` | Available/healthy runtime and fresh allowance |
| `--cp-magenta` | `#FF4FD8` | Reasoning and route-analysis accents |
| `--cp-hornero` | `#FF7849` | Primary action and ChePrompt identity |
| `--cp-warning` | `#FFD166` | Stale quota, approvals and caution |
| `--cp-danger` | `#FF5D7A` | Errors and exhausted/unavailable states |

Fluorescent colors should occupy a small portion of the screen. Glow is allowed only on the active focus ring, selected route and primary action, using a low-opacity shadow. Never use glow on paragraphs, execution output or every border.

## Typography and shape

- Use `var(--vscode-editor-font-family)` for prompts, routing data, quota values and execution output.
- Keep body text at least 13 px with a 1.45 line height.
- Use 4 px and 8 px spacing increments.
- Prefer 6 px corner radii: technical but not visually harsh.
- Use one-pixel borders; hierarchy comes primarily from contrast and spacing.

## Core components

### Prompt composer

- Largest interactive element in the initial state.
- `Cmd/Ctrl + Enter` analyzes; a visible hint documents the shortcut.
- Primary action label: `Dale`.
- Supports multiline prompts without becoming a full document editor.

### Allowance strip

- One compact group per allowance pool, not merely per model family.
- Example pools: `OpenCode Go`, `Claude Pro`, `ChatGPT/Codex`.
- Shows exact percentage and reset only when officially reported.
- Uses `No disponible` for unknown data and never invents a progress bar.

### Route decision

- Shows selected runtime, provider, model, policy and confidence.
- Explains why it fits the task in one or two lines.
- Shows expected usage pressure and the allowance pool it will consume.
- Provides two collapsed alternatives and a manual override.

### Execution stream

- Keeps text, steps, tools, approvals and errors in one chronological stream.
- Uses labels and small symbols in addition to color.
- Keeps `Cancelar` and the interactive-terminal fallback visible while running.

### Runtime states

| State | Accent | Required label |
| --- | --- | --- |
| Selected | Cyan | `Elegido` |
| Available | Lime | `Disponible` |
| Analyzing | Magenta | `Enrutando…` |
| Approval | Warning | `Necesita aprobación` |
| Unavailable | Danger | `No disponible` |
| Primary action | Hornero | `Dale` / `Ejecutar` |

## Layout sketch

```text
 CHEPROMPT · router                         hornero
 ─────────────────────────────────────────────────
 OpenCode Go  74%   Claude Pro  disponible   GPT 38%

 > Describí el laburo…
   _______________________________________________
                                    analizar  ⌘↵

 ┌ ELEGIDO ──────────────────────────────────────┐
 │ DeepSeek V4.1 Flash · OpenCode Go             │
 │ Conviene por: refactor amplio + bajo consumo  │
 │ Cupo: Go semanal · 74% restante               │
 │ Alternativas: Claude Sonnet · GPT Sol         │
 └───────────────────────────────────────────────┘

 [ Dale ]                              [ Cambiar ]

 ejecución
 ├─ leyendo el proyecto
 ├─ editando 3 archivos
 └─ ejecutando pruebas
```

## Interaction and motion

- Use 120–180 ms transitions for focus, expansion and state changes.
- Streaming output should not animate each character or cause layout jumps.
- Respect `prefers-reduced-motion` and disable glow pulses entirely.
- Preserve keyboard operation for composer, policy, alternatives, execution and cancellation.

## Accessibility acceptance criteria

- Primary text and controls meet WCAG AA contrast on their actual surfaces.
- Fluorescent colors are tested as foregrounds and borders, not assumed accessible because they are bright.
- Focus is always visible and not conveyed by color alone.
- Every progress value has a text equivalent for screen readers.
- Status updates use an appropriate live region without announcing every streamed token.
- Validate at narrow VS Code sidebar widths and at 200% zoom.

## Non-goals

- Copying OpenCode's trademarks, exact layout, assets or brand palette.
- Turning every control into ASCII art.
- Using Argentine slang where it makes an error or permission request ambiguous.
- Hiding provider/model details for the sake of visual simplicity.
