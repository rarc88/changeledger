---
id: "20260613-205853"
title: Check con scope por id y validación de config
type: refactor
status: draft
created: 2026-06-13T20:58:53Z
depends_on: ["20260613-135500"]
---

## Request

Dos mejoras a `sl check`:

1. **Scope por id**: `sl check <id>` valida solo ese change (rápido, para que un
   agente valide lo que acaba de escribir). `sl check` sin args sigue validando
   todo el repo + agregados.
2. **Validar `config.yml`**: hoy `check` valida changes contra el config, pero no
   el config en sí. Si está ausente o mal formado, todo se rompe en silencio.

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

- [ ] `checkConfig(config)` con reglas CR2/CR3
- [ ] `sl check [id]`: filtrar al change pedido; correr config siempre
- [ ] Tests de config inválido y scope
- [ ] Actualizar README/AGENTS si cambia el uso

## Log

- **2026-06-13T20:58:53Z** — Creado en draft a partir de la duda humana sobre si
  `check` es por-change o global. Resolución: un comando con scope opcional +
  validación de config.
