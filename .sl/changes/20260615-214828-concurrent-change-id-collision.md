---
id: "20260615-214828"
title: Evitar colisiones concurrentes en sl new
type: bug
status: done
created: 2026-06-15T21:48:28Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Evitar que ejecuciones concurrentes de `sl new` generen dos changes con el mismo
id cuando arrancan en el mismo segundo.

## Investigation

Durante esta auditoría se ejecutaron varios `sl new` en paralelo. Dos procesos
leyeron el directorio antes de que el otro terminara y ambos eligieron el id
`20260615-214816`, creando:

- `20260615-214816-empty-slug-validation.md`
- `20260615-214816-viewer-modularization.md`

`newChange()` intenta evitar colisiones con `idTaken(changesDir, id)`, pero la
comprobación y la escritura no son atómicas entre procesos. La protección sirve
para creaciones secuenciales en el mismo proceso/turno, no para concurrencia real.

Impacto: `sl check` detectaría id duplicado, pero el daño ya queda escrito y
requiere arreglo manual.

## Specification

### CR1 — Creaciones concurrentes producen ids únicos
- **Given** un repo Spec Ledger inicializado
- **When** dos llamadas a `newChange()` intentan crear changes en el mismo segundo
- **Then** ambos archivos se crean con ids diferentes
- **And** `sl check` no reporta `duplicate id`

### CR2 — La solución no pisa archivos existentes
- **Given** un archivo ya existe para un id candidato
- **When** `sl new` calcula el siguiente nombre
- **Then** usa otro id o falla limpiamente
- **And** ningún archivo existente se sobrescribe

### CR3 — La unicidad sigue derivada de `created`
- **Given** `sl new` necesita avanzar al siguiente segundo para evitar una colisión
- **When** escribe el change
- **Then** el frontmatter `created` y el `id` del filename siguen representando el mismo instante

## Plan

- [x] Añadir un test de concurrencia en `test/change.test.mjs` o `test/cli.test.mjs` que reproduzca dos creaciones simultáneas con el mismo `now` (CR1) — 2026-06-15T21:54:33Z
- [x] Cambiar `src/commands/new.mjs` para reservar el archivo de forma atómica, por ejemplo con modo de escritura exclusivo (`wx`) y retry al siguiente segundo (CR1, CR2, CR3) — 2026-06-15T21:54:37Z
- [x] Asegurar que el retry actualiza juntos `created`, `id` y filename (CR3) — 2026-06-15T21:54:37Z
- [x] Ejecutar `pnpm test -- test/change.test.mjs test/cli.test.mjs` y `pnpm check` (CR1, CR2, CR3) — 2026-06-15T21:59:43Z

## Log
- **2026-06-15T21:52:27Z** — status: draft → approved
- **2026-06-15T21:53:14Z** — status: approved → in-progress
- **2026-06-15T21:53:14Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:00:05Z** — status: in-progress → in-review
- **2026-06-15T22:02:31Z** — review → in-progress (retry): El test de concurrencia usaba procesos secuenciales
- **2026-06-15T22:03:03Z** — status: in-progress → in-review
- **2026-06-15T22:05:08Z** — review → in-progress (retry): El test concurrente era flaky y faltaba check/no-overwrite explícito
- **2026-06-15T22:05:41Z** — status: in-progress → in-review
- **2026-06-15T22:07:19Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:08:06Z** — graduado a spec `architecture.md`
