---
id: "20260614-191531"
title: pre-commit lintea todo el arbol y rompe commits parciales
type: bug
status: draft
created: 2026-06-14T19:15:31Z
depends_on: ["20260614-182511"]
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

- [ ] `hooks/pre-commit`: tras `lint-staged`, correr solo `pnpm test` + `node bin/sl.mjs check` (no el `biome check` de árbol completo); el lint de staged ya lo hace lint-staged (CR1) — `hooks/pre-commit`
- [ ] Conservar `pnpm verify` intacto como gate completo para CI/manual (CR2) — `package.json`
- [ ] Verificar el escenario de CR1 a mano (staged limpio + no-staged sucio → commit pasa)

## Log
