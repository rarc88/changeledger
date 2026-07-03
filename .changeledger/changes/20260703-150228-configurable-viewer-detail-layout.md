---
id: "20260703-150228"
title: Configurar el layout del detalle en el viewer
type: feature
status: in-progress
created: 2026-07-03T15:02:28Z
depends_on: []
release_impact: minor
owner: Roberto Ruiz
---

## Request

El panel que muestra changes y specs usa actualmente una fracción pequeña de
pantallas anchas. La limitación se vuelve especialmente visible en documentos
largos, tablas y diagramas Mermaid. Se necesita elegir entre un panel lateral y
un modal flotante, además de controlar el ancho sin perder la experiencia
responsive.

## Investigation

`src/viewer/public/styles.css` fija `.detail` a `min(720px, 92vw)` y el overlay
siempre se alinea al borde derecho. En una pantalla de 2048 px el documento queda
limitado aproximadamente al 35 % del ancho aunque el resto de la interfaz no sea
necesario durante la lectura.

El viewer ya persiste preferencias en `app-state.js`, y los changes y specs
comparten el mismo contenedor `#detail`. La configuración puede ser común a ambos
sin duplicar renderizadores. Mermaid dispone además de una expansión propia, que
debe seguir funcionando con cualquier layout.

## Proposal

Añadir un control compacto de presentación en la cabecera del detalle con dos
modos: panel lateral y modal flotante. Ofrecer tamaños discretos en lugar de un
redimensionador libre: `compact` (720 px), `wide` (960 px) y `full` (hasta 1280
px o el espacio seguro disponible). Los presets son predecibles, accesibles por
teclado y suficientes para diagramas sin introducir la complejidad de drag,
límites y estados intermedios.

La preferencia de modo y tamaño será global al viewer y persistirá en
`localStorage`. En pantallas pequeñas ambos modos convergen en un detalle a
pantalla completa. El modal se centra con altura acotada y scroll interno; el
panel conserva visible el contexto de la tabla o board detrás del overlay.

Se descarta comenzar con resize continuo: aporta precisión marginal, complica la
accesibilidad y no está respaldado todavía por evidencia de uso.

## Specification

### CR1 — Elegir modo de presentación
- **Given** un change o spec abierto en una pantalla de escritorio
- **When** la persona selecciona `Side panel` o `Floating modal` desde el control de presentación
- **Then** el mismo detalle cambia de layout sin cerrarse ni perder su posición de lectura
- **And** el modo seleccionado se aplica también al siguiente change o spec abierto

### CR2 — Elegir ancho útil
- **Given** un detalle abierto en cualquiera de los dos modos de escritorio
- **When** la persona selecciona `Compact`, `Wide` o `Full`
- **Then** el contenedor usa respectivamente hasta 720 px, 960 px o 1280 px sin exceder el viewport seguro
- **And** Markdown, tablas, código y Mermaid se adaptan al nuevo ancho sin overflow de la página

### CR3 — Persistir preferencias
- **Given** un modo y tamaño seleccionados
- **When** el viewer se recarga o se vuelve a abrir usando el mismo almacenamiento local
- **Then** restaura ambas preferencias
- **And** valores ausentes o inválidos vuelven a `Side panel` y `Wide`

### CR4 — Modal flotante enfocado
- **Given** el modo `Floating modal` activo en escritorio
- **When** se abre un change o spec
- **Then** el detalle aparece centrado, con altura máxima segura y scroll interno
- **And** Escape, el botón accesible de cierre y el backdrop cierran el detalle

### CR5 — Comportamiento móvil
- **Given** un viewport de hasta 680 px
- **When** se abre un detalle con cualquier preferencia guardada
- **Then** ocupa todo el viewport y conserva controles legibles y alcanzables
- **And** la preferencia de escritorio no se sobrescribe por esa adaptación temporal

### CR6 — Controles accesibles y diagramas
- **Given** una persona que navega con teclado o lector de pantalla
- **When** recorre el control de modo, tamaño, cierre y expansión Mermaid
- **Then** cada acción tiene nombre accesible, foco visible y estado seleccionado perceptible
- **And** expandir y cerrar Mermaid sigue funcionando en todos los modos y tamaños

## Plan

- [ ] Extend `src/viewer/public/app-state.js`; verify: `node --test test/app-state.test.mjs` (CR3, CR5)
- [ ] Add detail presentation controls and shared change/spec wiring in `src/viewer/public/app.js` and `src/viewer/public/view-parts.js`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR1, CR2, CR4, CR6)
- [ ] Implement side, floating, width and responsive styles in `src/viewer/public/styles.css`; verify: `pnpm test` and manual viewer checks at 2048 px, 1280 px and 680 px (CR1, CR2, CR4, CR5, CR6)
- [ ] Record durable viewer layout behavior in `.changeledger/specs/viewer.md`; verify: `node bin/changeledger.mjs check 20260703-150228` (CR1, CR2, CR3, CR4, CR5, CR6)
- [ ] Run the complete quality gate after implementation; verify: `pnpm verify` (support)

## Log

- 2026-07-03T15:02:28Z — Se autorizó documentar una configuración compartida
  para changes y specs a partir de la evidencia visual en una pantalla ancha.
- 2026-07-03T15:12:00Z — Se eligieron presets discretos como primera versión y
  se dejó el resize continuo fuera hasta observar una necesidad adicional.
- **2026-07-03T15:10:11Z** — status: draft → approved
- **2026-07-03T22:14:35Z** — status: approved → in-progress
- **2026-07-03T22:14:35Z** — owner → Roberto Ruiz (auto)
