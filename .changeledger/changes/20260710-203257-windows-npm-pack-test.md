---
id: "20260710-203257"
title: El test del paquete falla al invocar npm en Windows
type: bug
status: done
created: 2026-07-10T20:32:57Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Hacer que la comprobación del artefacto publicable de `agent-prompt` funcione
en el job Windows de CI, igual que en Linux y macOS.

## Investigation

`test/agent-prompt.test.mjs` ejecuta `execFile('npm', ['pack', '--dry-run',
'--json'])`. En Windows, `npm` se distribuye como el shim `npm.cmd` y
`execFile` no lo resuelve por el shell; el proceso falla con `spawn npm ENOENT`
antes de ejecutar el empaquetado. La matriz de CI sí instala Node, pnpm y npm:
el defecto está en la selección del ejecutable desde el test, no en el workflow
ni en los assets del paquete.

## Specification

### CR1 — El test usa el ejecutable npm correcto por plataforma
- **Given** la prueba de `npm pack --dry-run --json` del artefacto publicable
- **When** se ejecuta en Windows
- **Then** invoca `npm.cmd` y no falla por `ENOENT`
- **And** en plataformas no Windows conserva la invocación directa de `npm`

### CR2 — La comprobación de contenido se conserva
- **Given** que el comando de empaquetado termina correctamente en cualquier
  sistema de la matriz
- **When** se inspecciona su JSON de salida
- **Then** el test sigue exigiendo los tres esqueletos y las tres cápsulas bajo
  `templates/contract/`
- **And** no se relaja ni se omite la prueba de artefacto publicable

## Plan

- [x] Añadir en `test/agent-prompt.test.mjs` una regresión de plataforma para el empaquetado de `src/commands/agent-prompt.mjs`; verify: `node --test test/agent-prompt.test.mjs` (CR1)
  - **Resolved:** `2026-07-11T15:54:36Z`
- [x] Ajustar la invocación de `execFile` en `test/agent-prompt.test.mjs` para el artefacto de `src/commands/agent-prompt.mjs`; verify: `node --test test/agent-prompt.test.mjs` (CR1)
  - **Resolved:** `2026-07-11T15:54:36Z`
- [x] Conservar en `test/agent-prompt.test.mjs` las aserciones de los assets bajo `templates/contract/agent-prompts/` y `templates/contract/agent-contexts/`; verify: `node --test test/agent-prompt.test.mjs` (CR2)
  - **Resolved:** `2026-07-11T15:54:36Z`
- [x] Ejecutar el gate completo y confirmar la matriz Windows en CI; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-11T15:54:36Z`

## Log
- **2026-07-11T10:47:22Z** `[status]` draft → approved
- **2026-07-11T15:50:11Z** `[status]` approved → in-progress
- **2026-07-11T15:50:11Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T15:54:36Z** `[note]` Integrada implementación delegada (278f46d): npmCommand(platform) selecciona npm.cmd en win32 con shell:true, invocación directa intacta en el resto; regresión de plataforma añadida; aserciones de assets conservadas. pnpm verify 603/603.
- **2026-07-11T15:54:36Z** `[status]` in-progress → in-review
- **2026-07-11T15:56:34Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:39:33Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T21:53:44Z** `[graduation]` skipped: fix de infraestructura de tests multiplataforma, sin verdad persistente nueva
- **2026-07-11T21:54:25Z** `[archive]` archived
