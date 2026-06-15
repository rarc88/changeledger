---
id: "20260615-222619"
title: Corregir el grafo cuando no hay cambios visibles
type: bug
status: draft
created: 2026-06-15T22:26:19Z
depends_on: ["20260615-214819"]
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

- [ ] Añadir test unitario de `graphSvg([])` para estado vacío y ausencia de `Infinity`/`NaN` (CR1)
- [ ] Añadir o preservar test con cambios visibles para no romper nodos/edges (CR2)
- [ ] Cambiar `graphSvg()` para devolver un estado vacío antes de calcular capas o usar mínimos seguros (CR1, CR2)
- [ ] Ejecutar `pnpm test -- test/viewer-metadata.test.mjs test/viewer-sanitize.test.mjs` y `pnpm check` (CR1, CR2)

## Log
