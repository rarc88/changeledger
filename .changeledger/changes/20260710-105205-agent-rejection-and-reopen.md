---
id: "20260710-105205"
title: El agente no puede rechazar validaciones ni reabrir changes provisionales
type: feature
status: done
created: 2026-07-10T10:52:05Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Permitir que el agente rechace un change en `in-validation` y reabra uno en
`done` aún provisional, siempre con motivo y dentro de las mismas fronteras
durables ya comprobadas. La aceptación de `draft → approved` y de
`in-validation → done` seguirá siendo exclusivamente humana. El viewer conserva
ambas acciones para el humano como alternativa, sin convertirlas en obligatorias.

## Investigation

La lógica ya existe en `src/commands/agent.mjs`: `validation(..., 'fail',
{ reason })` exige el motivo y devuelve a `in-progress`; `reopen(id, reason)`
exige el motivo, toma el lock de releases y rechaza changes graduados/skipped,
archivados o incluidos en un release. Sin embargo, ambas funciones no están
expuestas por el CLI: `validation` sólo la invoca el dominio del viewer y
`reopen` se bloquea explícitamente en `status`. Además sus entradas de Log dicen
"human rejected" y "human reopened", y el core, el pack de implementación y
las specs asignan esos movimientos sólo al humano.

La separación que se quiere mantener no depende de que el actor sea el viewer:
depende de que nadie pueda aceptar por el humano. El rechazo y la reapertura son
movimientos correctivos, reversibles dentro del alcance original y ya disponen
de validación, motivo auditado y fronteras durables fail-closed. La solución debe
exponer comandos explícitos que permitan registrar correctamente el actor,
conservar la ruta del viewer y no abrir una vía para `done` ni para aprobar un
draft desde el agente.

## Proposal

Agregar comandos explícitos para el agente: uno de rechazo de validación y uno
de reapertura, ambos con razón obligatoria. El dominio del viewer reutilizará la
misma lógica pero identificará el actor humano, de modo que el Log distinga
"agent rejected/reopened" de "human rejected/reopened" sin cambiar el grafo ni
las fronteras de seguridad. Actualizar el contrato, ayuda y specs para que sólo
las dos transiciones positivas permanezcan human-only.

## Specification

### CR1 — Rechazo de validación desde el agente
- **Given** un change `in-validation` y una razón no vacía
- **When** el agente ejecuta `changeledger validation <id> fail "<razón>"`
- **Then** el change pasa a `in-progress` y el Log registra `validation → in-progress (agent rejected): <razón>`
- **And** razón vacía, veredicto distinto de `fail` o estado distinto de `in-validation` fallan sin escribir

### CR2 — Reapertura provisional desde el agente
- **Given** un change `done` sin `reviewed`, sin resolución de graduación, sin archive y fuera de releases
- **When** el agente ejecuta `changeledger reopen <id> "<razón>"`
- **Then** el change pasa a `in-progress` y el Log registra `status: done → in-progress (agent reopened): <razón>`
- **And** los cuatro límites durables, una razón vacía o cualquier otro status fallan sin escribir

### CR3 — Aceptación sigue siendo exclusivamente humana
- **Given** los comandos que expone el CLI al agente
- **When** intenta aprobar un draft o aceptar `in-validation → done`
- **Then** no existe una ruta de CLI que complete esas transiciones
- **And** el viewer mantiene aprobación, aceptación, rechazo y reapertura, registrando `human` para sus dos movimientos correctivos

### CR4 — Contrato, ayuda y verdad durable coherentes
- **Given** el contrato generado, la ayuda del CLI y las specs de lifecycle/viewer
- **When** describen ownership de transiciones
- **Then** sólo `draft → approved` e `in-validation → done` figuran como human-only
- **And** rechazo y reapertura admiten agente o humano con razón, sin alterar el grafo ni permitir ampliar el alcance original

## Plan

- [x] Escribir pruebas rojas en `test/agent.test.mjs` y `test/cli-bin.test.mjs` para `src/commands/agent.mjs`/`bin/changeledger.mjs`: `validation ... fail`, errores sin escritura y Log de actor; verify: `node --test test/agent.test.mjs test/cli-bin.test.mjs` (CR1, CR3) — 2026-07-10T14:19:34Z
- [x] Escribir pruebas rojas en `test/agent.test.mjs` y `test/viewer-domain.test.mjs` para `src/commands/agent.mjs`: `reopen`, fronteras durables y Logs diferenciados; verify: `node --test test/agent.test.mjs test/viewer-domain.test.mjs` (CR2, CR3) — 2026-07-10T14:19:34Z
- [x] Exponer comandos en `bin/changeledger.mjs` y parametrizar actor en `src/commands/agent.mjs`/`src/viewer/domain.mjs` sin duplicar guards; verify: `node --test test/agent.test.mjs test/viewer-domain.test.mjs test/cli-bin.test.mjs` (CR1, CR2, CR3) — 2026-07-10T14:19:34Z
- [x] Actualizar `templates/contract/core.md`, `templates/contract/validation.md` y specs `.changeledger/specs/lifecycle.md`/`viewer.md`; verify: `node --test test/context.test.mjs && changeledger check 20260710-105205` (CR4) — 2026-07-10T14:19:34Z
- [x] Ejecutar revisión independiente y el gate completo; verify: `pnpm verify` (support) — 2026-07-10T14:29:48Z

## Log
- **2026-07-10T12:03:39Z** — status: draft → approved
- **2026-07-10T14:14:44Z** — status: approved → in-progress
- **2026-07-10T14:14:44Z** — owner → Roberto Ruiz (auto)
- **2026-07-10T14:19:34Z** — status: in-progress → in-review
- **2026-07-10T14:24:27Z** — review → in-progress (retry): El CLI aún permitía draft → approved; se corrigió la autoridad humana y el contrato.
- **2026-07-10T14:24:28Z** — status: in-progress → in-review
- **2026-07-10T14:25:36Z** — review → in-progress (retry): La spec y comentarios aún atribuían rechazo/reapertura sólo al humano.
- **2026-07-10T14:26:28Z** — status: in-progress → in-review
- **2026-07-10T14:28:04Z** — review → in-progress (retry): Quedaban una expectativa de ayuda CLI y un comentario de mantenimiento con la reapertura human-only.
- **2026-07-10T14:28:29Z** — status: in-progress → in-review
- **2026-07-10T14:29:48Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-10T17:11:40Z** — validation → done (human accepted)
- **2026-07-10T17:13:14Z** — graduado a spec `lifecycle.md`
- **2026-07-10T20:18:08Z** — archived
