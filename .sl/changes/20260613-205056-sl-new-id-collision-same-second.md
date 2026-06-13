---
id: "20260613-205056"
title: sl new colisiona ids creados en el mismo segundo
type: bug
status: draft
created: 2026-06-13T20:50:56Z
depends_on: ["20260613-150402"]
---

## Request

`sl new` genera ids `YYYYMMDD-HHMMSS` con granularidad de segundo. Al crear
varios changes en el mismo segundo (un agente en bucle, o creación en lote)
todos reciben el **mismo id** → ids duplicados y nombres de archivo en colisión.

Detectado por dogfooding: tres `sl new` seguidos produjeron el mismo id
`20260613-204950`.

## Investigation

- `idFromTimestamp(now)` es determinista por segundo; no consulta los ids
  existentes, así que no garantiza unicidad.
- El riesgo real no es multi-dev (raro), sino **intra-proceso**: un agente que
  crea N changes en milisegundos. Es el caso de uso más común.
- `created` se deriva del instante; `id` se deriva de `created`.

## Specification

### CR1 — IDs únicos en creación en lote
- **Given** un repo donde ya existe un change con id del segundo actual
- **When** ejecuto `sl new` en el mismo segundo
- **Then** el nuevo change recibe un id distinto y único
- **And** el formato sigue siendo `YYYYMMDD-HHMMSS`

### CR2 — `created` coherente con el `id`
- **Given** un id ajustado por colisión
- **When** se escribe el change
- **Then** `created` coincide con el `id` (un instante, una fuente)

## Plan

- [ ] `sl new`: tras derivar el id, si ya existe en `changes_dir`, incrementar 1s hasta uno libre (CR1)
- [ ] Derivar `created` del id final ajustado (CR2)
- [ ] Test: dos `sl new` con el mismo `now` producen ids consecutivos distintos

## Log

- **2026-06-13T20:50:56Z** — Creado en draft. Bug encontrado por dogfooding al
  crear los changes del CLI/specs. Fix: guardia de unicidad en `sl new`
  (incrementar segundos hasta id libre), manteniendo el formato.
