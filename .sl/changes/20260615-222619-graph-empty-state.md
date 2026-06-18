---
id: "20260615-222619"
title: Corregir el grafo cuando no hay cambios visibles
type: bug
status: done
created: 2026-06-15T22:26:19Z
depends_on: [ "20260615-214819" ]
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Evitar que el graph del visor genere dimensiones inválidas cuando los filtros
dejan cero changes visibles.

## Investigation

`graphSvg(changes)` calcula ancho y alto con `Math.max(...Object.keys(layers))`
y `Math.max(...Object.values(layers))`. Si `changes` está vacío, ambos spreads
también están vacíos y el resultado cae en `-Infinity`, generando un SVG con
`viewBox`/`height` inválidos.

El bug aparece con filtros de texto/tipo/estado o tombstones que oculten todos
los changes. Es pequeño, pero visible y fácil de cubrir ahora que el renderer del
graph está aislado en `src/viewer/public/view-renderers.js`.

## Specification

### CR1 — Graph vacío muestra estado vacío
- **Given** los filtros activos dejan cero changes visibles
- **When** el visor renderiza la pestaña Graph
- **Then** no genera dimensiones `Infinity` ni `NaN`
- **And** muestra un estado vacío consistente con el resto del visor

### CR2 — Graph con cambios mantiene layout
- **Given** hay changes visibles con y sin dependencias
- **When** el visor renderiza la pestaña Graph
- **Then** conserva nodos, edges y clicks existentes
- **And** las dimensiones del SVG siguen siendo números finitos

## Plan

- [x] Añadir test unitario de `graphSvg([])` para estado vacío y ausencia de `Infinity`/`NaN` (CR1) — 2026-06-15T22:45:09Z
- [x] Añadir o preservar test con cambios visibles para no romper nodos/edges (CR2) — 2026-06-15T22:45:09Z
- [x] Cambiar `graphSvg()` para devolver un estado vacío antes de calcular capas o usar mínimos seguros (CR1, CR2) — 2026-06-15T22:45:09Z
- [x] Ejecutar `pnpm test -- test/viewer-metadata.test.mjs test/viewer-sanitize.test.mjs` y `pnpm check` (CR1, CR2) — 2026-06-15T22:45:20Z

## Log
- **2026-06-15T22:38:28Z** — status: draft → approved
- **2026-06-15T22:44:43Z** — status: approved → in-progress
- **2026-06-15T22:44:43Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:45:20Z** — status: in-progress → in-review
- **2026-06-15T22:46:10Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:51:10Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:24Z** — archived
