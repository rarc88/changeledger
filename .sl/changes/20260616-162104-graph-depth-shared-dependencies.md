---
id: "20260616-162104"
title: Corregir profundidad del grafo con dependencias compartidas
type: bug
status: done
created: 2026-06-16T16:21:04Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Corregir el calculo de profundidad del grafo del viewer cuando un nodo depende
de ramas que comparten dependencias.

## Investigation

`src/viewer/public/view-renderers.js` calcula profundidad con una funcion
recursiva `depth(id, seen = new Set())`. El mismo `seen` se reutiliza entre ramas
de una llamada a `Math.max(...deps.map(...))`. Eso puede hacer que una
dependencia compartida parezca un ciclo si ya fue visitada por una rama hermana,
subestimando la profundidad del nodo.

La intencion de `seen` es detectar ciclos dentro del camino actual, no recordar
todo lo visitado por ramas hermanas.

## Specification

### CR1 — Dependencia compartida no se trata como ciclo
- **Given** cambios `A`, `B`, `C`, `D` donde `B` depende de `A`, `C` depende de `A`, y `D` depende de `B` y `C`
- **When** se renderiza `graphSvg`
- **Then** el nodo `D` se coloca en una capa posterior a `B` y `C`
- **And** `A` puede aparecer como dependencia compartida sin colapsar la profundidad

### CR2 — Ciclo real sigue siendo defensivo
- **Given** cambios `A` y `B` donde `A` depende de `B` y `B` depende de `A`
- **When** se renderiza `graphSvg`
- **Then** la funcion retorna un SVG finito
- **And** no lanza una excepcion por recursion infinita

### CR3 — Grafo simple conserva layout actual
- **Given** cambios `A` y `B` donde `B` depende de `A`
- **When** se renderiza `graphSvg`
- **Then** `B` se coloca en una capa posterior a `A`

## Plan

- [x] Añadir tests en `test/viewer-metadata.test.mjs` para `src/viewer/public/view-renderers.js` con dependencias compartidas, ciclo real y grafo simple (CR1, CR2, CR3) — 2026-06-16T16:34:17Z
- [x] Actualizar `src/viewer/public/view-renderers.js` y cubrirlo con `test/viewer-metadata.test.mjs` para clonar o retirar `seen` por rama, preservando el cache de profundidades (CR1, CR2, CR3) — 2026-06-16T16:34:20Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para verificar `src/viewer/public/view-renderers.js` con `test/viewer-metadata.test.mjs` (CR1, CR2, CR3) — 2026-06-16T16:34:23Z

## Log
- **2026-06-16T16:26:30Z** — status: draft → approved
- **2026-06-16T16:33:37Z** — status: approved → in-progress
- **2026-06-16T16:33:37Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:34:26Z** — status: in-progress → in-review
- **2026-06-16T16:43:36Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:45:02Z** — graduado a spec `architecture.md`
