---
id: "20260721-000706"
title: changeledger check resuelve mal repoRoot bajo git hooks con multi-worktree
type: bug
status: draft
created: 2026-07-21T00:07:06Z
depends_on: []
related_to: ["20260720-124231"]
---

## Request

Al cerrar `20260720-124231` en un setup de 3 `git worktree` compartiendo un
`.git` común, `changeledger check` ejecutado a mano (shell interactivo) daba 0
errores, pero el MISMO comando ejecutado dentro de `hooks/pre-commit` (como
parte de `git commit`) reportaba consistentemente "AGENTS.md has an outdated
ChangeLedger reference" — pese a que el AGENTS.md del worktree invocador ya
estaba al día. Esto bloqueó repetidamente el commit y obligó a usar
`--no-verify` como salida, lo cual no es sostenible: cualquier commit futuro en
un worktree de este tipo puede toparse con el mismo bloqueo falso.

## Investigation

Evidencia recogida en la sesión que originó este bug (ver Log de
`20260720-124231`):

- `changeledger check` interactivo: 0 errores, AGENTS.md en bootstrap v3
  (correcto).
- `changeledger check` dentro del hook: error "outdated", de forma repetible.
- Se confirmó que el worktree hermano (`codex/global-state-branch` en ese
  momento, checkout separado del mismo repo) tenía su propio AGENTS.md en
  bootstrap v2 (desactualizado). Se actualizó ese worktree con
  `changeledger register` como hipótesis de causa.
- El error bajo el hook **persistió** incluso después de actualizar el
  worktree hermano — la hipótesis "lee el AGENTS.md del hermano" no quedó
  confirmada como causa completa; puede ser una resolución de repoRoot
  distinta (ej. cache, timing, u otra ruta) todavía sin identificar en el
  código fuente.
- Un git hook recibe `GIT_DIR`/`GIT_WORK_TREE` apuntando al `.git/worktrees/<nombre>`
  del worktree que lo invoca — no descartado como factor, pero no rastreado
  hasta una línea concreta de `src/repo.mjs` o similar en esta sesión.

Este documento parte de evidencia observacional, no de una causa raíz
confirmada en código. La investigación real (leer `src/repo.mjs`/resolución de
`repoRoot`, reproducir con un hook mínimo, aislar la variable exacta) queda
pendiente.

## Specification

### CR1 — `check` resuelve el repoRoot del invocador, no de otro worktree
- **Given** 2+ `git worktree` del mismo repo, cada uno con su propio AGENTS.md
- **When** `changeledger check` corre dentro de un git hook (`pre-commit`) en
  uno de esos worktrees
- **Then** el resultado es idéntico al de ejecutar el mismo comando de forma
  interactiva desde ese worktree
- **And** ningún archivo de un worktree distinto influye en el resultado

## Plan

## Log

- **2026-07-21T00:07:06Z** `[note]` Change creado a partir de un hallazgo de sesión (chip de tarea), no de una investigación de código todavía. Reemplaza ese chip.
