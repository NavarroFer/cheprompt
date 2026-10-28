# ChePrompt

**El modelo justo para cada laburo.**

ChePrompt es una extensión de VS Code que analiza una tarea, propone el modelo de OpenCode Go más adecuado y explica la decisión antes de ejecutar nada.

## Estado

Este repositorio contiene el MVP inicial:

- panel lateral dentro de VS Code;
- perfiles Económico, Equilibrado y Máxima calidad;
- clasificación local y determinística de complejidad;
- decisión visible con modelo, motivo, confianza e impacto relativo de uso;
- confirmación explícita antes de abrir `opencode run`;
- pruebas unitarias para la primera heurística.

La selección actual es una hipótesis medible, no una promesa de calidad. El siguiente paso es registrar resultados reales —tests, latencia, correcciones y consumo— y ajustar el router con evidencia.

## Requisitos

- VS Code 1.100 o posterior.
- Node.js 20 o posterior.
- OpenCode v2 instalado y autenticado.
- Una cuenta OpenCode Go con modelos disponibles.

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
prompt → clasificación local → decisión explicada → confirmación → opencode run
```

1. Escribí la tarea.
2. Elegí el perfil de costo/calidad.
3. Presioná **Analizar ruta**.
4. Revisá el modelo y el motivo.
5. Presioná **Ejecutar con este modelo**.

OpenCode se abre en un terminal nuevo con el modelo seleccionado. ChePrompt no guarda claves ni activa `--auto`; las aprobaciones de herramientas siguen bajo control del usuario.

## Arquitectura

```text
src/
  extension.ts   Vista y protocolo del webview
  router.ts      Clasificador y selección pura
  opencode.ts    Adaptador de ejecución de OpenCode
  types.ts       Contratos del pipeline
  test/           Pruebas del router
media/
  main.js         Interacción del panel
  styles.css      Presentación nativa de VS Code
```

## Roadmap sugerido

1. Validar manualmente 20 tareas representativas.
2. Registrar modelo, latencia, consumo y resultado de tests.
3. Recalibrar reglas y modelos con esos datos.
4. Agregar escalamiento automático sólo cuando falla una verificación.
5. Incorporar subagentes y worktrees para tareas paralelas.
6. Evaluar un plugin nativo de OpenCode cuando el comportamiento esté validado.

## Licencia

MIT
