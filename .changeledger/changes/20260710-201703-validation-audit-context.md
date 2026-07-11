---
id: "20260710-201703"
title: Permitir auditorías read-only de changes en validación
type: bug
status: done
created: 2026-07-10T20:17:03Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Permitir una auditoría independiente, estrictamente de solo lectura, de un
change que ya espera aceptación humana en `in-validation`, sin devolverlo a
`in-progress` ni registrar un segundo veredicto de review.

## Investigation

La auditoría de los changes en validación no puede delegarse mediante el
contexto de rol actual: `changeledger agent-context review <id>` exige que el
change esté en `in-review` y falla para `in-validation`. Volverlo a
`in-progress` sólo para inspeccionarlo altera el lifecycle, añade eventos al
Log y confunde una auditoría posterior con el gate que ya se completó.

El rol `review` tampoco es semánticamente correcto para este caso: su cápsula
pide recomendar y registrar un veredicto que mueve el change. La necesidad es
distinta: contrastar criterios, código, pruebas y Git, y devolver hallazgos al
orquestador o al humano sin exponer comandos de mutación ni cambiar el estado.

## Specification

### CR1 — Contexto de auditoría para validación
- **Given** un change en `in-validation`
- **When** un agente solicita su contexto de auditoría read-only
- **Then** recibe una cápsula autocontenida con el change seleccionado, sus
  criterios y una frontera explícita de no modificar archivos, Git ni ledger
- **And** la operación no cambia el status ni agrega entradas al Log

### CR2 — Separación del gate de review
- **Given** una auditoría solicitada para un change en `in-validation`
- **When** el delegado termina su inspección
- **Then** su salida pide hallazgos y evidencia, no un veredicto que avance o
  retroceda el lifecycle
- **And** el contexto `review` conserva su restricción actual a
  `in-review` y su receta de veredicto única

### CR3 — Contrato y CLI consistentes
- **Given** los comandos y prompts de delegación publicados
- **When** se descubre o invoca la auditoría
- **Then** la ayuda enumera el rol o modo de auditoría y explica que sólo sirve
  para inspección posterior a review
- **And** las pruebas cubren permiso en `in-validation`, rechazo fuera de ese
  estado y ausencia de superficie de mutación

## Plan

- [x] Añadir en `test/agent-context.test.mjs` pruebas de la cápsula de auditoría y sus guards para `src/commands/agent-context.mjs`; verify: `node --test test/agent-context.test.mjs` (CR1) — 2026-07-11T16:02:02Z
- [x] Implementar la cápsula de auditoría en `src/commands/agent-context.mjs` y `templates/contract/agent-contexts/audit.md`; verify: `node --test test/agent-context.test.mjs` (CR1) — 2026-07-11T16:02:02Z
- [x] Preservar la restricción de `review` en `src/commands/agent-context.mjs` y cubrirla en `test/agent-context.test.mjs`; verify: `node --test test/agent-context.test.mjs` (CR2) — 2026-07-11T16:02:02Z
- [x] Exponer la auditoría en `src/commands/agent-prompt.mjs`, `bin/changeledger.mjs`, `templates/contract/agent-prompts/audit.md` y `README.md`; verify: `node --test test/agent-prompt.test.mjs test/cli-bin.test.mjs` (CR3) — 2026-07-11T16:02:02Z
- [x] Ejecutar el gate completo tras actualizar `templates/contract/core.md`; verify: `pnpm verify` (support) — 2026-07-11T16:02:02Z

## Log
- **2026-07-11T10:47:16Z** — status: draft → approved
- **2026-07-11T15:50:29Z** — status: approved → in-progress
- **2026-07-11T15:50:29Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T16:02:03Z** — Integrada implementación delegada (1f2c807..84feac9): rol audit read-only restringido a in-validation, cápsula y skeleton nuevos, guard de review intacto, empaquetado a 4 roles; snapshot de core.md reclasificado. pnpm verify 606/606.
- **2026-07-11T16:02:03Z** — status: in-progress → in-review
- **2026-07-11T16:09:16Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:39:30Z** — validation → done (human accepted)
- **2026-07-11T21:51:13Z** — graduado a spec `lifecycle.md`
- **2026-07-11T21:54:25Z** — archived
