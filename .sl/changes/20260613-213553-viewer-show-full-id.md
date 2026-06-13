---
id: "20260613-213553"
title: El visor abrevia el id y oculta los segundos
type: bug
status: done
created: 2026-06-13T21:35:53Z
depends_on: ["20260613-150430"]
---

## Request

El visor muestra el id abreviado `#MMDD-HHMM` (sin segundos). Changes creados en
el mismo minuto (p.ej. 205852/205853/205854) se ven idénticos `#0613-2058` y
parecen duplicados. Mostrar el **id completo**.

## Investigation

- `shortId()` en `app.js` recorta a `MMDD-HHMM`, descartando los segundos que son
  justo lo que distingue ids del mismo minuto.
- El id completo `YYYYMMDD-HHMMSS` es la unidad real; mostrarlo elimina la
  ambigüedad. Se usa en card, nodo del grafo y tabla (id + deps).

## Specification

### CR1 — Id completo en el visor
- **Given** dos changes creados en el mismo minuto, distinto segundo
- **When** los veo en el visor (board, table, graph)
- **Then** cada uno muestra su id completo y se distinguen

## Plan

- [x] Eliminar `shortId`; mostrar el id completo en card, grafo y tabla (CR1) — 2026-06-13T21:37:20Z

## Log

- **2026-06-13T21:35:53Z** — Creado. Bug de UX: la abreviatura ocultaba los
  segundos y los changes del mismo minuto parecían duplicados.
- **2026-06-13T21:37:20Z** — status: in-progress → done
- **2026-06-13T21:37:20Z** — Eliminado shortId; id completo en board/table/graph. Verificado en navegador.
