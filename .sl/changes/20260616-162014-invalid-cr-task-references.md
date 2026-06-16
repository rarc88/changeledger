---
id: "20260616-162014"
title: Validar referencias CR inexistentes en tareas
type: bug
status: done
created: 2026-06-16T16:20:14Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

La auditoria encontro que `sl check` valida la cobertura desde criterios
declarados hacia tareas, pero no valida la direccion inversa: una tarea puede
referenciar un `CRn` que no existe en `## Specification` y el check no lo marca
como error.

## Investigation

El problema esta en `src/check.mjs`: `checkCoverage` construye el conjunto de
criterios referenciados por las tareas y avisa cuando un criterio declarado no
esta cubierto, pero no compara cada referencia de tarea contra los criterios
declarados.

Reproduccion minima observada durante la auditoria:

- `## Specification` declara solo `CR1`.
- `## Plan` contiene una tarea con `(CR999)`.
- `checkRepo` no emite error por `CR999`; solo avisa que `CR1` no esta cubierto.

Esto debilita la trazabilidad criterio -> tarea que el contrato promete.

## Specification

### CR1 — Referencia inexistente en tarea
- **Given** un cambio `feature` con `status: approved`, `## Specification` que declara `CR1`, y una tarea en `## Plan` que referencia `(CR999)`
- **When** se ejecuta `checkRepo` sobre el cambio
- **Then** el resultado contiene un error literal `Plan task references unknown criterion "CR999"`
- **And** el error apunta al archivo del cambio

### CR2 — Referencias existentes siguen siendo validas
- **Given** un cambio `feature` con `status: approved`, `## Specification` que declara `CR1`, y una tarea en `## Plan` que referencia `(CR1)`
- **When** se ejecuta `checkRepo` sobre el cambio
- **Then** el resultado no contiene errores de criterios desconocidos

### CR3 — Multiples referencias reportan cada criterio inexistente
- **Given** un cambio `feature` con `status: approved`, `## Specification` que declara `CR1`, y una tarea que referencia `(CR1, CR2, CR404)`
- **When** se ejecuta `checkRepo` sobre el cambio
- **Then** el resultado contiene un error literal `Plan task references unknown criterion "CR2"`
- **And** el resultado contiene un error literal `Plan task references unknown criterion "CR404"`

## Plan

- [x] Añadir tests en `test/check.test.mjs` para `src/check.mjs` con referencias CR inexistentes en tareas de `## Plan` y hacerlos fallar primero (CR1, CR3) — 2026-06-16T16:28:20Z
- [x] Actualizar `src/check.mjs` y cubrirlo con `test/check.test.mjs` para comparar `task.criteria` contra los criterios declarados y emitir errores por cada referencia desconocida (CR1, CR2, CR3) — 2026-06-16T16:28:24Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para verificar `src/check.mjs` con `test/check.test.mjs` y el contrato del repo (CR1, CR2, CR3) — 2026-06-16T16:28:28Z

## Log
- **2026-06-16T16:24:48Z** — status: draft → approved
- **2026-06-16T16:27:49Z** — status: approved → in-progress
- **2026-06-16T16:27:50Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:28:32Z** — status: in-progress → in-review
- **2026-06-16T16:42:46Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:44:37Z** — graduado a spec `architecture.md`
