---
id: "20260613-215319"
title: "Quality gate: Biome lint + pre-commit (lint, test, check)"
type: feature
status: approved
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

- [ ] `pnpm add -D @biomejs/biome` + `biome.json`
- [ ] Scripts `lint`/`test`/`check`/`verify` en `package.json`
- [ ] Aplicar Biome al código existente (fix/format) hasta verde
- [ ] `hooks/pre-commit` + `core.hooksPath`
- [ ] Documentar en README
- [ ] `.gitignore`: node_modules ya ignorado; añadir pnpm si aplica

## Log

- **2026-06-13T21:53:19Z** — Creado. Aprobado: Biome + pnpm, hook versionado vía
  core.hooksPath. Gate = lint + test + check.
