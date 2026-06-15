---
id: "20260613-205853"
title: Check con scope por id y validación de config
type: feature
status: done
created: 2026-06-13T20:58:53Z
depends_on: ["20260613-135500"]
archived: true
reviewed: true
---

## Request

Dos mejoras a `sl check`:

1. **Scope por id**: `sl check <id>` valida solo ese change (rápido, para que un
   agente valide lo que acaba de escribir). `sl check` sin args sigue validando
   todo el repo + agregados.
2. **Validar `config.yml`**: hoy `check` valida changes contra el config, pero no
   el config en sí. Si está ausente o mal formado, todo se rompe en silencio.

## Investigation

- `checkRepo` ya recibe `{ config, changes }`; falta validar el `config` mismo
  antes de usarlo como referencia de enums/stages.
- El scope por id es filtrar `changes` al solicitado antes de las reglas por
  archivo; los agregados (ids, deps, ciclos) solo aplican al repo completo.
- Reusa `loadRepo` y `checkRepo`; el comando decide el scope.

## Proposal

- `sl check [id]`: con id, valida config + ese change (reglas por archivo). Sin
  id, valida config + todos + agregados (ids únicos, deps, ciclos).
- Validación de `config.yml`: existe; tiene `changes_dir`, `statuses`, `stages`,
  `types`; cada tipo referencia stages dentro de `stages` canónicos.
- No se parte en dos comandos (`check`/`health`): un comando, scope opcional. KISS.

## Specification

### CR1 — check scoped
- **Given** un repo con varios changes y uno inválido
- **When** ejecuto `sl check <id-valido>`
- **Then** valida solo ese change y termina exit 0 (ignora el inválido ajeno)

### CR2 — config ausente
- **Given** un `.sl/config.yml` ausente o vacío
- **When** ejecuto `sl check`
- **Then** reporta un error de config y exit ≠ 0

### CR3 — config mal formado
- **Given** un config sin `statuses` o con un tipo que referencia un stage desconocido
- **When** ejecuto `sl check`
- **Then** reporta el problema de config

## Plan

- [x] `checkConfig(config)` con reglas CR2/CR3 — 2026-06-13T21:02:00Z
- [x] `sl check [id]`: filtrar al change pedido; correr config siempre — 2026-06-13T21:03:00Z
- [x] Tests de config inválido y scope — 2026-06-13T21:04:00Z
- [x] Actualizar README/AGENTS si cambia el uso — 2026-06-13T21:04:30Z

## Log

- **2026-06-13T20:58:53Z** — Creado en draft a partir de la duda humana sobre si
  `check` es por-change o global. Resolución: un comando con scope opcional +
  validación de config.
- **2026-06-13T21:04:30Z** — Aprobado e implementado. `checkConfig` valida el
  `config.yml` (claves, tipos de stage); `sl check [id]` valida un change o todo
  el repo. 40 tests verde; README actualizado. `draft → done`.
- **2026-06-15T21:17:53Z** — archived
