---
id: "20260710-102908"
title: INTENT contradice el cierre provisional de un change done
type: bug
status: done
created: 2026-07-10T10:29:08Z
depends_on: [ "20260710-105205" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Alinear `INTENT.md` con el comportamiento ya implementado: `done` permite una
reapertura humana y acotada mientras no se haya resuelto la graduación, archivado
o publicación. La intención no debe inducir a un agente a tratar esa ventana
como una contradicción o a evitar una corrección del alcance original.

## Investigation

`INTENT.md` afirma dos veces que un change `done` nunca se reabre o que un
change cerrado es terminal. En cambio, la spec canónica `lifecycle.md`, el
comando `reopen` y el contexto de validación especifican la misma regla:
la reapertura sólo la hace el humano, exige razón, vuelve a `in-progress` y
queda limitada al alcance ya autorizado; se bloquea definitivamente al graduar
o hacer skip, archivar o incluir el change en un release. `discarded` sí es
terminal desde el principio.

No hay desacuerdo de producto: el usuario confirmó que la reapertura previa a
graduación/archivado es intencional. El defecto es documental y de vocabulario:
`done` significa aceptación humana provisional, mientras que el cierre durable
ocurre al resolver graduación/skip y cruzar una frontera irreversible. La
actualización debe preservar que el trabajo posterior o más amplio necesita un
change nuevo y no alterar la semántica del CLI.

## Specification

### CR1 — Intención alineada con la reapertura provisional
- **Given** que `20260710-105205` ya está cerrado
- **When** se leen las secciones 8 y Reglas generales de `INTENT.md`
- **Then** `done` se describe como aceptación humana provisional, no como estado terminal inmediato
- **And** la reapertura con motivo puede hacerla el agente o el humano sólo para el alcance original mientras no haya graduación/skip, archivo o release
- **And** `discarded` sigue siendo terminal desde su creación

### CR2 — La autoridad humana queda inequívoca
- **Given** el flujo de lifecycle documentado en `INTENT.md`
- **When** se identifica quién puede decidir los hitos
- **Then** sólo el humano aprueba `draft → approved` y acepta `in-validation → done`
- **And** el rechazo y la reapertura no se presentan como aceptación ni como ampliación de alcance

### CR3 — Sin cambio de comportamiento adicional
- **Given** el cambio de intención
- **When** se revisan los archivos fuera de `INTENT.md` y el documento de cambio
- **Then** no se alteran CLI, viewer, lifecycle ni el contrato operativo, salvo `test/intent.test.mjs` que verifica esta intención
- **And** la verdad persistente de lifecycle sigue perteneciendo a `lifecycle.md`

## Plan

- [x] Añadir `test/intent.test.mjs`, usar `src/commands/agent.mjs` como referencia de actores y actualizar las secciones de cierre, retrospectiva y reglas de `INTENT.md`; verify: `node --test test/intent.test.mjs` (CR1, CR2) — 2026-07-10T17:27:52Z
- [x] Usar `test/intent.test.mjs` y `.changeledger/specs/lifecycle.md` para comprobar que `INTENT.md` no declara cambios de CLI/viewer/lifecycle y revisar el diff documental; verify: `node --test test/intent.test.mjs && git diff --check` (CR3) — 2026-07-10T17:27:52Z

## Log
- **2026-07-10T12:02:45Z** — status: draft → approved
- **2026-07-10T17:26:36Z** — status: approved → in-progress
- **2026-07-10T17:26:36Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-10T17:27:52Z** — status: in-progress → in-review
- **2026-07-10T17:28:47Z** — review → in-progress (retry): INTENT decía aceptación definitiva y la CR3 contradice su test documental.
- **2026-07-10T17:29:08Z** — status: in-progress → in-review
- **2026-07-10T17:30:41Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-10T20:16:14Z** — validation → done (human accepted)
- **2026-07-10T20:19:47Z** — graduation skipped: La corrección alinea INTENT.md con la verdad de lifecycle ya existente; no crea un spec adicional.
- **2026-07-10T20:19:48Z** — archived
