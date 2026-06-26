---
id: "20260614-191531"
title: pre-commit lintea todo el arbol y rompe commits parciales
type: bug
status: done
created: 2026-06-14T19:15:31Z
depends_on: ["20260614-182511"]
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Tras añadir lint-staged (#20260614-182511), un commit parcial seguía fallando: el
commit de un subconjunto de archivos abortaba si OTRO archivo modificado pero no
staged estaba sin formatear. Pasó al implementar #20260614-182513 (el primer
commit `feat(owner)` abortó y su código terminó mezclado en el commit de tests).

## Investigation

- `hooks/pre-commit` corre `npx lint-staged` y luego `pnpm verify`.
- `pnpm verify` = `biome check` (lint de **todo el árbol**) + test + `sl check`.
- lint-staged solo formatea/lintea los archivos **staged**. Pero el `biome check`
  de `verify` lintea el árbol completo, incluidos los modificados-no-staged que
  aún no se formatearon → falla → aborta el commit.
- Esto **anula** el propósito de lint-staged (lintear solo lo que se commitea).
  Verificado: `biome check --write` sale 0 al solo formatear; el fallo no era de
  lint-staged sino del lint completo de `verify` en pre-commit.

## Specification

### CR1 — commit parcial con otro archivo sucio no aborta
- **Given** `fileA.mjs` staged y bien formateado, y `fileB.mjs` modificado-no-staged y mal formateado
- **When** corro `git commit` (solo fileA)
- **Then** el commit pasa (lint-staged formatea fileA; el lint no evalúa fileB)
- **And** fileB queda intacto, sin commitear

### CR2 — `pnpm verify` sigue siendo el gate completo
- **Given** el árbol con un archivo mal formateado
- **When** corro `pnpm verify`
- **Then** falla (lint completo + test + check) — sin cambios respecto a hoy

## Plan

- [x] En `hooks/pre-commit`: tras `lint-staged`, correr solo `pnpm test` + `node bin/sl.mjs check` (sin el `biome check` de árbol completo; el lint de staged lo hace lint-staged) (CR1) — 2026-06-14T19:17:11Z
- [x] `pnpm verify` en `package.json` intacto como gate completo CI/manual (CR2) — 2026-06-14T19:17:11Z
- [x] Verificado a mano: staged limpio + no-staged sucio → hook exit 0, archivo sucio intacto (CR1) — 2026-06-14T19:17:11Z

## Log
- **2026-06-14T19:16:14Z** — status: draft → approved
- **2026-06-14T19:16:14Z** — status: approved → in-progress
- **2026-06-14T19:16:15Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-14T19:17:28Z** — status: in-progress → done
- **2026-06-14T19:17:28Z** — graduation skipped: fix de tooling (hook); sin verdad persistente
- **2026-06-15T21:17:57Z** — archived
