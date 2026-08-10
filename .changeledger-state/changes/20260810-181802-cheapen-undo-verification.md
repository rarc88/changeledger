---
id: "20260810-181802"
title: Abaratar y simplificar la verificación del undo
type: refactor
status: draft
created: 2026-08-10T18:18:02Z
depends_on: []
related_to: ["20260809-194233", "20260809-131004"]
owner: rarc88
---

## Request

Dos residuos anotados en los Logs de `20260809-131004` y `20260809-194233`,
misma superficie (`assertRevertRestoresSnapshot`, la puerta de
contenido+modo del undo del cutover):

- La verificación ejecuta un `ls-tree` por entrada del snapshot — O(N)
  subprocesos. Con este repo ya activado (319 documentos publicados) cada
  undo paga la N completa; `git-batch.mjs` ya existe para leer por lotes.
- Nit KISS anotado en review: simplificación local de la misma función sin
  cambio de comportamiento.

Mismo comportamiento observable, menos coste: ninguna aserción de la puerta
se debilita — los tests de `194233` (decoys, modo cambiado, round-trip
`100755`) deben pasar intactos.

## Proposal

## Specification

## Plan

## Log
