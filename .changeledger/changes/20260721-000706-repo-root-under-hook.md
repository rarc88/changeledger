---
id: "20260721-000706"
title: changeledger check resuelve mal repoRoot bajo git hooks con multi-worktree
type: bug
status: in-progress
created: 2026-07-21T00:07:06Z
depends_on: []
owner: raruiz-hiberuscom
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

**Pregunta abierta de alcance, sin responder todavía:** solo se observó el
síntoma en `check`. No se verificó si la misma resolución de `repoRoot` la
comparten las operaciones reales del almacén global (`readStateStore`,
`syncStateStore`, `publishStateStore` en `src/state-store.mjs`) — que son el
corazón del feature de `20260720-124231`, no un comando auxiliar. Si el mismo
bug alcanza esas rutas, el riesgo es mayor que un falso positivo de `check`. La
tarea de trace del Plan debe responder esto explícitamente antes de acotar el
fix solo a `check`.

## Specification

### CR1 — `check` resuelve el repoRoot del invocador, no de otro worktree
- **Given** 2+ `git worktree` del mismo repo, cada uno con su propio AGENTS.md
- **When** `changeledger check` corre dentro de un git hook (`pre-commit`) en
  uno de esos worktrees
- **Then** el resultado es idéntico al de ejecutar el mismo comando de forma
  interactiva desde ese worktree
- **And** ningún archivo de un worktree distinto influye en el resultado

### CR2 — Alcance confirmado sobre las operaciones del almacén global
- **Given** el mismo fixture multi-worktree bajo un hook
- **When** se ejecutan `readStateStore`, `syncStateStore` o `publishStateStore` desde `src/state-store.mjs` dentro de ese hook
- **Then** el resultado documenta explícitamente si comparten o no la resolución defectuosa de `repoRoot`
- **And** si la comparten, este change extiende su fix a esas rutas; si no, el Log deja constancia de por qué están a salvo

## Plan

- [ ] Write a failing reproduction against `src/check.mjs`'s current resolution: a fixture with 2+ `git worktree` off one `.git`, each with its own AGENTS.md at a different bootstrap version, that installs a real `pre-commit` hook invoking the built CLI's `check` and runs an actual `git commit` in one worktree; assert the result differs from running `check` directly in that same worktree (red, proving today's bug — do not assume the cause, let the test show it); verify: `node --test test/repo-root-hook.test.mjs` (CR1)
- [ ] Trace the exact repoRoot/file resolution `check` uses under the hook's inherited `GIT_DIR`/`GIT_WORK_TREE` (start in `src/repo.mjs` and wherever `check` locates AGENTS.md); in the same pass, run `readStateStore`/`syncStateStore`/`publishStateStore` from `src/state-store.mjs` under the same hook fixture and record in the Log whether they share the bug; verify: `node --test test/repo-root-hook.test.mjs` (CR2)
- [ ] Fix the resolution so it always targets the invoking worktree — extending the fix to `src/state-store.mjs` too if CR2's trace found it exposed — and turn the reproduction test green; verify: `node --test test/repo-root-hook.test.mjs test/check.test.mjs` (CR1)
- [ ] Run the full gate to confirm no other command sharing this resolution path regressed; verify: `pnpm verify` (support)

## Log

- **2026-07-21T00:07:06Z** `[note]` Change creado a partir de un hallazgo de sesión (chip de tarea), no de una investigación de código todavía. Reemplaza ese chip.
- **2026-07-21T12:49:15Z** `[status]` draft → approved
- **2026-07-21T13:02:40Z** `[status]` approved → in-progress
- **2026-07-21T13:02:40Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-21T13:02:41Z** `[note]` Rama creada desde codex/global-state-branch, no desde dev: dev todavía no tiene el código de 20260720-124231 (done, sin graduar/mergear).
