---
id: "20260711-160444"
title: Test CLI del wiring de context --have
type: quick
status: done
created: 2026-07-11T16:04:44Z
depends_on: [ "20260711-103759" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Hallazgo del review de #20260711-103759: la lógica de `--have <rev>` está
cubierta a nivel de módulo, pero no existe un test que ejercite el wiring
completo del binario (`bin/changeledger.mjs` → `src/commands/context.mjs`):
que `changeledger context --have <rev-vigente>` responda el bloque corto
`unchanged` con exit 0 y que un rev obsoleto devuelva la salida completa.
Añadir la regresión CLI-level en `test/cli-bin.test.mjs` o `test/cli.test.mjs`
siguiendo el patrón existente. Solo tests, reversible, sin superficie nueva.

## Log
- **2026-07-11T16:12:29Z** `[status]` draft → approved
- **2026-07-11T16:23:00Z** `[status]` approved → in-progress
- **2026-07-11T16:23:00Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T16:29:43Z** `[note]` Integrada implementación delegada (d8c2ec1): regresión CLI del wiring de --have (unchanged con rev vigente, salida completa con rev obsoleto) en test/cli-bin.test.mjs. pnpm verify 608/608. Fricción: changeledger commit salió 1 sin diagnóstico en el worktree del delegado.
- **2026-07-11T16:29:44Z** `[status]` in-progress → in-validation
- **2026-07-11T21:39:48Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T21:53:44Z** `[graduation]` skipped: cobertura de tests del wiring, sin verdad persistente nueva
- **2026-07-11T21:54:25Z** `[archive]` archived
