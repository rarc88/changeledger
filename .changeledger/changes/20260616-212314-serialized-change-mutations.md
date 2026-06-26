---
id: "20260616-212314"
title: Mutaciones concurrentes de un mismo change no deben perder escrituras
type: bug
status: done
created: 2026-06-16T21:23:14Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Al marcar varias tareas del mismo change en paralelo, una escritura pisó a otra:
solo persistió una de las marcas. Las mutaciones individuales son atómicas, pero
el patrón read-modify-write sobre el mismo archivo no está serializado.

## Investigation
- `writeFileAtomic` evita archivos parciales, pero no evita lost updates cuando
  dos procesos leen la misma versión, calculan cambios distintos y renombram al
  mismo destino.
- Comandos como `task`, `log`, `archive`, `review`, `status` y `graduate` mutan
  el mismo documento mediante read-modify-write.
- La fricción apareció al llamar varios `sl task ... done` contra el mismo id en
  paralelo.
- La solución debe proteger mutaciones del mismo archivo sin volver lenta la
  lectura ni bloquear changes distintos.

## Specification
### CR1 — Mutaciones concurrentes preservadas
- **Given** dos mutaciones concurrentes sobre el mismo change
- **When** ambas terminan correctamente
- **Then** el archivo final conserva los efectos de ambas, sin perder Log ni tareas

### CR2 — Serialización por archivo
- **Given** mutaciones concurrentes sobre changes distintos
- **When** se ejecutan en paralelo
- **Then** no se bloquean por un lock global innecesario

### CR3 — Fallos sin locks huérfanos
- **Given** una mutación falla mientras sostiene el mecanismo de coordinación
- **When** otro comando intenta mutar el mismo change después
- **Then** no queda bloqueado indefinidamente por estado temporal huérfano

### CR4 — Atomicidad existente preservada
- **Given** una mutación se escribe correctamente
- **When** ocurre un fallo de IO durante la escritura
- **Then** se mantiene la garantía de no dejar contenido parcial
  

## Plan
- [x] Añadir coordinación por archivo en `src/writer.mjs` o una capa cercana a `src/atomic-write.mjs`, cubierta por `test/agent.test.mjs` o `test/atomic-write.test.mjs` (CR1, CR2, CR3, CR4) — 2026-06-17T10:32:57Z
- [x] Migrar las mutaciones de `src/commands/agent.mjs` y `src/commands/graduate.mjs`, cubiertas por `test/agent.test.mjs`, para usar la sección crítica compartida (CR1, CR2, CR4) — 2026-06-17T10:32:57Z
- [x] Añadir en `test/agent.test.mjs` una carrera con múltiples `task done` sobre el mismo change y otra sobre changes distintos de `src/commands/agent.mjs` (CR1, CR2) — 2026-06-17T10:32:57Z
- [x] Ejecutar `pnpm test -- test/agent.test.mjs test/atomic-write.test.mjs` contra `src/commands/agent.mjs` y `src/atomic-write.mjs` (CR1, CR2, CR3, CR4) — 2026-06-17T10:32:57Z

## Log
- **2026-06-16T21:23:14Z** — Creado desde fricción observada: mutaciones paralelas del mismo change perdieron actualizaciones pese a escritura atomica.
- **2026-06-17T10:02:28Z** — status: draft → approved
- **2026-06-17T10:30:13Z** — status: approved → in-progress
- **2026-06-17T10:30:13Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:33:23Z** — status: in-progress → in-review
- **2026-06-17T10:34:49Z** — review → in-progress (retry): stale-lock recovery can delete a live long-running lock
- **2026-06-17T10:35:40Z** — status: in-progress → in-review
- **2026-06-17T15:17:57Z** — review → in-progress (retry): lock metadata write failure can orphan the newly created lock
- **2026-06-17T15:21:10Z** — status: in-progress → in-review
- **2026-06-17T15:21:17Z** — review → done (delegated subagent, clean context)
- **2026-06-17T15:21:24Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
