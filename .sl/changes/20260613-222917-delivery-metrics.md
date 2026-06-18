---
id: "20260613-222917"
title: "Métricas: cycle time y throughput"
type: feature
status: done
created: 2026-06-13T22:29:17Z
depends_on: []
archived: true
reviewed: true
---

## Request

Derivar métricas de entrega desde los timestamps: cycle time (created→done) y throughput por periodo. Mostrarlas en el visor.

## Investigation

- `created` está en frontmatter. El instante de "done" no está en frontmatter:
  vive en el `## Log` como `- **<iso>** — status: ... → done` (lo escribe
  `sl status`). Es la única fuente del momento de cierre.
- Cycle time = doneAt − created, solo para changes `done` con esa entrada de Log.
- Throughput = nº de changes cerrados por periodo (día), agrupando por la fecha
  de `doneAt`.
- El cálculo debe ser puro y testeable; el visor solo lo pinta. `serialize()` ya
  envía `stages` (incluido el Log), así que conviene calcular en el server y
  mandar `metrics` en `/api/repo` en vez de duplicar el parseo en el cliente.

## Proposal

Módulo puro `metrics.mjs` con `computeMetrics(changes)`:

- `doneAt(change)`: extrae el último `→ done` del Log y su ISO.
- Devuelve `{ count, avgCycleMs, medianCycleMs, perChange:[{id,cycleMs}],
  throughput:[{date,count}] }` (throughput ordenado por fecha).

`serialize()` añade `metrics`. El visor añade una vista **Metrics**: tarjetas
(cerrados, cycle medio/mediana) + barras de throughput por día.

Descartado: persistir un `closed_at` en frontmatter — duplicaría info que el Log
ya tiene (fuente única); y calcular en el cliente — no testeable y duplica lógica.

## Specification

### CR1 — Cycle time desde Log
- **Given** un change `done` con `created` y una entrada de Log `→ done`
- **When** se calculan métricas
- **Then** su cycle time es `doneAt − created` en ms

### CR2 — Agregados y throughput
- **Given** varios changes done en distintas fechas
- **When** se calculan métricas
- **Then** se obtiene count, media y mediana de cycle time
- **And** throughput agrupa los cierres por fecha (YYYY-MM-DD)

### CR3 — Vista en el visor
- **Given** un proyecto con changes done
- **When** abro la pestaña Metrics
- **Then** veo cerrados, cycle medio/mediana y barras de throughput

## Plan

- [x] `metrics.mjs`: `doneAt` + `computeMetrics` puros (CR1, CR2) — 2026-06-14T11:54:54Z
- [x] `serialize()` añade `metrics`; pestaña Metrics en el visor (CR3) — 2026-06-14T11:54:55Z
- [x] Tests: cycle time, agregados, throughput, ignora no-done (CR1, CR2) — 2026-06-14T11:54:55Z

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
- **2026-06-14T11:54:55Z** — status: in-progress → done
- **2026-06-15T21:17:55Z** — archived
