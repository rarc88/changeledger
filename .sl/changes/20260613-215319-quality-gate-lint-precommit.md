---
id: "20260613-215319"
title: "Quality gate: Biome lint + pre-commit (lint, test, check)"
type: feature
status: done
created: 2026-06-13T21:53:19Z
depends_on: ["20260613-135500"]
---

## Request

Un gate de calidad que impida a los agentes acumular deuda técnica: lint del
código + tests + `sl check`, ejecutado en pre-commit para bloquear commits que no
pasen.

## Investigation

- El proyecto es **cero deps de runtime**; el linter es solo dev. Elegido **Biome**
  (una devDependency, binario rápido, lint + format) gestionado con **pnpm**.
- Pre-commit: **hook versionado + `core.hooksPath`** (sin Husky ni deps extra; se
  reparte con el repo). El hook corre `pnpm verify`.
- `verify` = lint + test (`node --test`) + `sl check`. Cubre código y documentos.

## Proposal

- `pnpm add -D @biomejs/biome`; `biome.json` con defaults razonables.
- `package.json` scripts: `lint` (biome check), `test` (node --test),
  `check` (node bin/sl.mjs check), `verify` (los tres).
- `hooks/pre-commit` (versionado) → `pnpm verify`; `git config core.hooksPath hooks`.
- Documentar en README; mencionar que cada repo activa el hook con `core.hooksPath`.

## Specification

### CR1 — Lint
- **Given** el proyecto
- **When** ejecuto `pnpm lint`
- **Then** Biome analiza el código y falla (exit ≠ 0) ante errores

### CR2 — Verify agrega todo
- **Given** el proyecto
- **When** ejecuto `pnpm verify`
- **Then** corre lint + test + `sl check` y falla si cualquiera falla

### CR3 — Pre-commit bloquea
- **Given** `core.hooksPath = hooks`
- **When** intento commitear con lint/test/check en rojo
- **Then** el hook aborta el commit

## Plan

- [x] `pnpm add -D @biomejs/biome` + `biome.json` — 2026-06-13T21:56:00Z
- [x] Scripts `lint`/`test`/`check`/`verify` en `package.json` — 2026-06-13T21:57:00Z
- [x] Aplicar Biome al código existente (fix/format) hasta verde — 2026-06-13T21:59:00Z
- [x] `hooks/pre-commit` + `core.hooksPath` — 2026-06-13T22:00:00Z
- [x] Documentar en README — 2026-06-13T22:01:00Z
- [x] `.gitignore`: node_modules ya ignorado (sin cambios) — 2026-06-13T22:01:30Z

## Log

- **2026-06-13T21:53:19Z** — Creado. Aprobado: Biome + pnpm, hook versionado vía
  core.hooksPath. Gate = lint + test + check.
- **2026-06-13T21:54:50Z** — status: approved → in-progress
- **2026-06-13T21:58:08Z** — status: in-progress → done
- **2026-06-13T21:58:08Z** — Biome + pnpm, scripts lint/test/check/verify, hook pre-commit vía core.hooksPath. Código formateado a verde. pnpm verify pasa.
