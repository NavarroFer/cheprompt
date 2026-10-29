# ChePrompt

**El modelo justo para cada laburo.**

ChePrompt es una extensión de VS Code que analiza una tarea, puntúa runtimes y modelos elegibles y explica la ruta antes de ejecutar nada.

## Estado

Este repositorio contiene el MVP inicial:

- panel lateral dentro de VS Code;
- perfiles Económico, Equilibrado y Máxima calidad;
- clasificación local y determinística de complejidad;
- decisión visible entre OpenCode Go, Claude Code y Codex, con puntaje, motivo, cupo y alternativas;
- inventario local de modelos OpenCode Go y estado de los CLIs oficiales de Claude Code y Codex;
- ventanas oficiales de uso de OpenCode Go, con porcentaje restante y reinicio cuando el API lo informa;
- ejecución con salida incremental en ChePrompt, cancelación y alternativa de terminal interactiva;
- opción explícita de Claude Pro mediante el CLI oficial de Claude Code;
- opción explícita de ChatGPT/Codex mediante el CLI oficial de Codex;
- confirmación explícita antes de ejecutar cualquiera de los runtimes;
- pruebas unitarias para routing, inventario, uso oficial y adaptadores con procesos falsos.
- conjunto sintético de 20 tareas e historial local de resultados, sin guardar prompts reales.

La selección actual es una hipótesis medible, no una promesa de calidad. El siguiente paso es registrar resultados reales —tests, latencia, correcciones y consumo— y ajustar el router con evidencia.

## Requisitos

- VS Code 1.100 o posterior.
- Node.js 20 o posterior.
- Al menos un runtime elegible: OpenCode Go, Claude Pro vía Claude Code o ChatGPT/Codex vía Codex CLI.
- OpenCode v2 y una cuenta OpenCode Go si querés usar sus modelos.
- Opcional, para Claude Pro: Claude Code CLI instalado y autenticado por su login oficial.
- Opcional, para ChatGPT/Codex: Codex CLI instalado y autenticado con ChatGPT; las API keys usan facturación aparte.

## Desarrollo

```bash
npm install
npm run check
npm test
```

Abrí esta carpeta en VS Code y presioná `F5`. Se abrirá una ventana **Extension Development Host**. En la barra lateral aparecerá el hornero de ChePrompt.

## Instalación local, sin publicar

Para usar ChePrompt en tu VS Code habitual sin subirla al Marketplace:

```bash
cd /Users/fernandonavarro/src/cheprompt
npm run install:local
```

El comando compila la extensión y crea un enlace local dentro de `~/.vscode/extensions`. Después:

1. Volvé a VS Code.
2. Abrí la paleta con `Cmd + Shift + P`.
3. Ejecutá **Developer: Reload Window**.
4. Buscá el hornero de ChePrompt en la barra lateral.

Cuando cambies el código, recompilá y recargá VS Code:

```bash
npm run compile
```

Para desarrollar con recarga y depuración, seguí usando `F5`. Para quitar la instalación local:

```bash
unlink ~/.vscode/extensions/fernandonavarro.cheprompt-0.0.1
```

El instalador nunca reemplaza una carpeta o enlace existente: si encuentra un conflicto, se detiene y lo informa.

## Flujo del MVP

```text
prompt → clasificación local → decisión explicada → ejecución inmediata → streaming + archivos modificados
```

1. Escribí la tarea.
2. Elegí el perfil económico, equilibrado o calidad.
3. Presioná **Dale** o usá `Cmd/Ctrl + Enter`: ChePrompt elige la suscripción/modelo y ejecuta enseguida, como un chat.
4. Mientras corre, la tarjeta de decisión muestra runtime/modelo, puntaje, cupo, motivo y alternativas, y **Archivos modificados** lista lo que el agente va escribiendo; cada archivo abre el diff de VS Code.
5. Cuando termina, el composer pasa a **Seguí la conversación**: lo que escribas continúa la misma sesión del runtime elegido (OpenCode `--session`, Claude Code `--resume`, Codex `exec resume`), con el hilo completo en el panel. **Nueva conversación** vuelve a enrutar desde cero.
6. Pegá capturas con `Cmd/Ctrl + V` o usá **Adjuntar imagen** (PNG, JPEG, GIF o WebP; hasta 4 de 5 MB). Con imágenes, el router solo considera modelos que informan entrada de imágenes: OpenCode según su metadata oficial (`/api/model`), Claude Code y Codex por su soporte documentado. Las imágenes se guardan temporalmente en el almacenamiento de la extensión y se borran al reemplazar el mensaje.
7. Para revisar antes de ejecutar, desactivá `cheprompt.executeOnSend` y usá **Ejecutar ruta elegida**. Los fallbacks y overrides siempre requieren revisión. Para aprobaciones, pasá la ejecución a la terminal interactiva del runtime (pide confirmación si hay una ejecución en curso).

El router puntúa de forma local y determinística los candidatos descubiertos de los tres runtimes. Los puntajes son hipótesis iniciales, no una garantía de calidad. Las ventanas oficiales de OpenCode Go limitan el enrutamiento cuando están frescas; cupos desconocidos no se estiman ni se tratan como cero. La ejecución transmite eventos JSON de OpenCode, Claude Code o Codex al panel. ChePrompt no copia credenciales ni activa aprobaciones automáticas; Claude Pro se usa solo mediante el CLI oficial de Claude Code, y cada CLI conserva su autenticación en su almacén oficial.

## Arquitectura

```text
src/
  extension.ts   Vista y protocolo del webview
  router.ts      Scoring local, puro y determinístico
  opencode.ts    Inventario y adaptador de ejecución de OpenCode
  claude-code.ts Descubrimiento y ejecución vía Claude Code oficial
  codex.ts       Descubrimiento y ejecución vía Codex CLI oficial
  types.ts       Contratos del pipeline
  test/           Pruebas de routing y adaptadores
media/
  main.js         Interacción del panel
  styles.css      Presentación nativa de VS Code
```

## Roadmap sugerido

El plan de trabajo y el estado de continuidad viven en:

- [`docs/ROADMAP.md`](docs/ROADMAP.md): hitos, prioridades y criterios de terminado.
- [`docs/STATE.md`](docs/STATE.md): estado actual, restricciones y próximo paso exacto.
- [`docs/OPENCODE.md`](docs/OPENCODE.md): instrucciones y prompts para continuar con OpenCode Go.
- [`docs/UI.md`](docs/UI.md): contrato visual TUI, paleta flúor, componentes y accesibilidad.

## Licencia

MIT
