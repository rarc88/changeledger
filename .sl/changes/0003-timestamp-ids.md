---
id: "0003"
title: IDs basados en timestamp para autoría concurrente
type: refactor
status: draft
created: 2026-06-13T15:04:02Z
depends_on: ["0001"]
---

## Request

Los ids secuenciales (`0001`, `0002`) colisionan cuando varios devs/agentes crean
changes en ramas paralelas: dos ramas generan `0003` y al hacer merge chocan,
obligando a renombrar a mano. Necesitamos ids únicos sin coordinación central.

## Proposal

**id = timestamp UTC de creación**, formato `YYYYMMDD-HHMMSS` (p.ej.
`20260613-150402`). Ordenable cronológicamente, colisión casi imposible (mismo
segundo + misma acción en dos devs), cero merge manual. El visor lo muestra
abreviado (`#0613-1504`).

- `id` se deriva del `created` (mismo instante, una sola fuente).
- Nombre de archivo: `{id}-{slug}.md`.
- `depends_on` referencia ids timestamp.

Migración: reasignar los changes existentes (`0001`→`20260613-134548`, etc.) y
actualizar `depends_on`. Solo hay 3 changes; coste bajo.

_Alternativas descartadas:_
- _Código corto aleatorio:_ único pero no cronológico ni significativo.
- _Mantener secuencial + resolver en merge:_ no elimina el problema, solo lo detecta.

## Plan

- [ ] Contrato `AGENTS.md` §7: id = timestamp UTC, formato y display
- [ ] `sl new`: generar id desde `created` (quitar `id_digits`)
- [ ] Visor: mostrar id abreviado
- [ ] Migrar changes existentes (ids + `depends_on`) y commits de referencia
- [ ] Tests: generación de id y unicidad

## Log

- **2026-06-13T15:04:02Z** — Creado en draft tras detectar colisión de ids
  secuenciales en escenarios multi-dev. Decisión: timestamp UTC `YYYYMMDD-HHMMSS`.
