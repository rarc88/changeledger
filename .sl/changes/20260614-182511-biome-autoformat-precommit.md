---
id: "20260614-182511"
title: Autoformatear con Biome en pre-commit (lint-staged)
type: chore
status: done
created: 2026-06-14T18:25:11Z
depends_on: []
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Recurrente: código nuevo sin formatear rompe `pnpm verify` en el commit (Biome
"Formatter would have printed…"). Causa raíz: nada autoformatea antes del gate.

Queremos autoformatear lo que se va a commitear, **sin corromper commits
parciales** (archivos con cambios staged y no-staged a la vez): solo debe tocarse
lo que está en el index.

La pieza correcta es **lint-staged**: hace `git stash` de los cambios no-staged,
corre el formateador sobre los staged, los re-añade, y restaura el stash. Así el
formateo nunca alcanza lo que no estaba en stage. Cuesta una dev-dep.

## Plan

- [x] Añadir `lint-staged` como devDependency (`package.json`) — 2026-06-14T18:34:27Z
- [x] Config `lint-staged` en `package.json`: `"*.{js,mjs,json,jsonc,css}": "biome check --write --no-errors-on-unmatched"` — 2026-06-14T18:34:28Z
- [x] `hooks/pre-commit`: `npx lint-staged` antes de `pnpm verify` (autoformatea staged, re-add, luego el gate) — 2026-06-14T18:34:28Z
- [x] Documentar en README §Development (autoformat en commit; `pnpm format` sigue disponible manual) — 2026-06-14T18:34:28Z
- [x] Verificar commit parcial: archivo con hunk staged + hunk no-staged → solo el staged se formatea/commitea — 2026-06-14T18:34:28Z

### Descartado
- **`git add` de staged + `biome format` sin stash** — corrompe commits parciales
  (formatea y re-añade también los hunks no-staged). Por eso lint-staged (stash).
- **Script propio con `git stash --keep-index`** — replica lint-staged pero frágil
  ante conflictos al `stash pop`; no vale reinventarlo.
- **Solo `biome check` (sin write)** — no autoformatea; el olvido persiste.

## Log

- **2026-06-14T18:30:52Z** — status: draft → approved
- **2026-06-14T18:32:41Z** — status: approved → in-progress
- **2026-06-14T18:32:41Z** — owner → Roberto Ruiz (auto)
- **2026-06-14T18:34:28Z** — status: in-progress → done
- **2026-06-14T18:34:28Z** — graduation skipped: chore de tooling, sin verdad persistente
