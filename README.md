# ChePrompt

**El modelo justo para cada laburo.**

ChePrompt es una extensión de VS Code que analiza una tarea, propone el modelo de OpenCode Go más adecuado y explica la decisión antes de ejecutar nada.

## Estado

Este repositorio contiene el MVP inicial:

- panel lateral dentro de VS Code;
- perfiles Económico, Equilibrado y Máxima calidad;
- clasificación local y determinística de complejidad;
- decisión visible con modelo, motivo, confianza e impacto relativo de uso;
- inventario local de runtimes, proveedores y modelos descubierto desde OpenCode;
- ventanas oficiales de uso de OpenCode Go, con porcentaje restante y reinicio cuando el API lo informa;
- ejecución con salida incremental en ChePrompt, cancelación y alternativa de terminal interactiva;
- opción explícita de Claude Pro mediante el CLI oficial de Claude Code;
- confirmación explícita antes de ejecutar cualquiera de los runtimes;
- pruebas unitarias para routing, inventario, uso oficial y adaptadores con procesos falsos.

La selección actual es una hipótesis medible, no una promesa de calidad. El siguiente paso es registrar resultados reales —tests, latencia, correcciones y consumo— y ajustar el router con evidencia.

## Requisitos

- VS Code 1.100 o posterior.
- Node.js 20 o posterior.
- OpenCode v2 instalado y autenticado.
- Una cuenta OpenCode Go con modelos disponibles.
- Opcional, para Claude Pro: Claude Code CLI instalado y autenticado por su login oficial.

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
prompt → clasificación local → decisión explicada → confirmación → streaming / terminal interactiva
```

1. Escribí la tarea.
2. Elegí el perfil de costo/calidad.
3. Presioná **Analizar ruta**.
4. Revisá el modelo y el motivo.
5. Presioná **Ejecutar en ChePrompt** o **Ejecutar con Claude Pro** si Claude Code está autenticado; para aprobaciones, elegí la terminal interactiva del runtime.

La ejecución normal transmite eventos JSON de OpenCode o Claude Code al panel. Si se necesita una aprobación interactiva, usá la terminal correspondiente para continuar la sesión en su TUI. ChePrompt no guarda claves ni activa aprobaciones automáticas; las aprobaciones siguen bajo control del usuario. Claude Pro se usa solo con el CLI oficial de Claude Code, nunca mediante plugins de suscripción de OpenCode. La cuenta se autentica y permanece en el almacén oficial de Claude Code.

## Arquitectura

```text
src/
  extension.ts   Vista y protocolo del webview
  router.ts      Clasificador y selección pura
  opencode.ts    Inventario y adaptador de ejecución de OpenCode
  claude-code.ts Descubrimiento y ejecución vía Claude Code oficial
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
