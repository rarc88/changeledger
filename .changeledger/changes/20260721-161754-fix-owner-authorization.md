---
id: "20260721-161754"
title: changeledger fix debe respetar el owner del change global
type: bug
status: in-progress
created: 2026-07-21T16:17:54Z
depends_on: []
owner: Roberto Ruiz
related_to: []
---

## Request

El almacén global reserva un change aprobado o activo para su `owner`, pero
`changeledger fix` puede modificar sus líneas de tareas sin comprobar la
identidad del invocador. Además registra `Change-Actor` usando el owner escrito
en el documento, aunque quien ejecutó el comando sea otra persona. Esto permite
alterar trabajo reservado y produce trazabilidad falsa.

## Investigation

`src/commands/fix.mjs` calcula reparaciones deterministas y llama a
`mutateResolvedChange` con `actor: c.frontmatter.owner ?? 'unknown'`. A
diferencia de `task`, `log` y las transiciones agent-owned, no obtiene la
identidad local mediante `ownerHandle` ni ejecuta `assertOwnedBy`.

El problema afecta tanto a `fix <id>` como a las variantes que recorren todos
los changes. En estas últimas, validar mientras se escribe también permitiría
un resultado parcial: reparar changes autorizados antes de descubrir otro cuyo
owner es diferente. La autorización debe resolverse para todos los objetivos
antes de la primera mutación.

## Specification

### CR1 — `fix` usa la identidad efectiva
- **Given** un change global aprobado o activo cuyo owner es `ana`
- **When** una identidad `luis` ejecuta cualquier variante de `changeledger fix` que modificaría ese documento
- **Then** el comando falla antes de escribir y muestra que el owner vigente es `ana`
- **And** no crea un commit cuyo `Change-Actor` suplante a `ana`
- **When** `ana` ejecuta la misma reparación
- **Then** la mutación se permite y registra a `ana` como actor efectivo

### CR2 — Preflight sin reparaciones parciales
- **Given** una ejecución de `fix` sobre varios changes globales, algunos autorizados y otro reservado para una identidad diferente
- **When** el comando prepara las reparaciones
- **Then** valida todos los objetivos antes de la primera escritura
- **And** si alguno no está autorizado, ningún change ni spec se modifica

### CR3 — Compatibilidad legacy y decisiones humanas
- **Given** un repositorio sin almacén global
- **When** se ejecuta `fix`
- **Then** conserva el comportamiento legacy actual
- **And** ninguna reparación mecánica adquiere implícitamente autoridad humana para transferir ownership o saltarse la exclusividad

## Plan

- [x] Add failing coverage in `test/fix.test.mjs` and `test/state-agent.test.mjs` for the current `src/commands/fix.mjs` behavior with `fix <id>`, `fix --structured-sections` and multi-change preflight under a non-owner identity; verify: `node --test test/fix.test.mjs test/state-agent.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-21T16:45:19Z`
- [x] Update `src/commands/fix.mjs` to resolve the effective actor through the shared identity path, authorize every target before mutation, and record that actor instead of copying frontmatter owner; verify: `node --test test/fix.test.mjs test/state-agent.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-21T16:45:19Z`
- [x] Run focused legacy regressions for `src/commands/fix.mjs` and the complete quality gate; verify: `node --test test/fix.test.mjs && pnpm verify` (CR3)
  - **Resolved:** `2026-07-21T16:47:41Z`

## Log
- **2026-07-21T16:21:50Z** `[status]` draft → approved
- **2026-07-21T16:40:33Z** `[owner]` set: Roberto Ruiz
- **2026-07-21T16:40:34Z** `[status]` approved → in-progress
