---
id: "20260616-210825"
title: Métricas cuentan cierres por review pass
type: bug
status: done
created: 2026-06-16T21:08:25Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Las métricas del visor subcuentan los changes cerrados hoy: hay muchos cambios
completados por revisión independiente, pero Metrics solo muestra dos cierres
para 2026-06-16. Además, la primera marca de graduación en
`.sl/specs/architecture.md` se ve inconsistente frente a las demás.

## Investigation
- `src/metrics.mjs` solo reconoce cierres con líneas de Log
  `status: ... → done`.
- Los changes con `review_required: true` se cierran por `sl review pass`, que
  escribe `review → done (delegated subagent, clean context)` y actualiza el
  frontmatter a `status: done`.
- Como `doneAt()` no entiende ese marcador, `computeMetrics()` ignora esos
  changes al calcular `count`, throughput, cycle time y desgloses.
- La primera línea de graduación de `architecture.md` fue la semilla histórica
  del primer spec. Es parseable, pero le falta el contexto humano que tienen las
  marcas posteriores.

## Specification
### CR1 — Cierres por review pass
- **Given** un change con `status: done` y una línea `review → done` en el Log
- **When** se calculan métricas
- **Then** el change cuenta como cerrado en su fecha de revisión

### CR2 — Cierres por status directo
- **Given** un change con `status: done` y una línea `status: ... → done`
- **When** se calculan métricas
- **Then** mantiene el comportamiento existente

### CR3 — Graduación inicial clara
- **Given** `architecture.md` contiene la marca del primer change graduado
- **When** se lee la lista de graduaciones
- **Then** esa primera entrada conserva el id parseable y añade contexto humano

## Plan
- [x] Ampliar `src/metrics.mjs` para reconocer `review → done` como cierre, cubierto por `test/metrics.test.mjs` (CR1, CR2) — 2026-06-16T21:09:38Z
- [x] Añadir cobertura en `test/metrics.test.mjs` para cierre por revisión y convivencia con cierres directos en `src/metrics.mjs` (CR1, CR2) — 2026-06-16T21:09:38Z
- [x] Normalizar la primera marca de graduación de `.sl/specs/architecture.md`, cuyo formato sigue validado por `src/check.mjs` y `test/check.test.mjs` (CR3) — 2026-06-16T21:09:38Z

## Log
- **2026-06-16T21:08:25Z** — Creado desde reporte del usuario: Metrics muestra solo dos cierres del día aunque varios changes terminaron por revisión.
- **2026-06-16T21:08:47Z** — status: draft → approved
- **2026-06-16T21:08:50Z** — status: approved → in-progress
- **2026-06-16T21:08:50Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T21:11:57Z** — status: in-progress → in-review
- **2026-06-16T21:13:39Z** — review clarification: untracked CLAUDE.md preexisted this change and is excluded as user worktree state
- **2026-06-16T21:14:28Z** — review → done (delegated subagent, clean context)
- **2026-06-16T21:14:31Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
