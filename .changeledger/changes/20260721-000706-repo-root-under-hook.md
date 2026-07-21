---
id: "20260721-000706"
title: changeledger check resuelve mal repoRoot bajo git hooks con multi-worktree
type: bug
status: done
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

- [x] Write a failing reproduction against `src/check.mjs`'s current resolution: a fixture with 2+ `git worktree` off one `.git`, each with its own AGENTS.md at a different bootstrap version, that installs a real `pre-commit` hook invoking the built CLI's `check` and runs an actual `git commit` in one worktree; assert the result differs from running `check` directly in that same worktree (red, proving today's bug — do not assume the cause, let the test show it); verify: `node --test test/repo-root-hook.test.mjs` (CR1)
  - **Resolved:** `2026-07-21T13:21:54Z`
- [x] Trace the exact repoRoot/file resolution `check` uses under the hook's inherited `GIT_DIR`/`GIT_WORK_TREE` (start in `src/repo.mjs` and wherever `check` locates AGENTS.md); in the same pass, run `readStateStore`/`syncStateStore`/`publishStateStore` from `src/state-store.mjs` under the same hook fixture and record in the Log whether they share the bug; verify: `node --test test/repo-root-hook.test.mjs` (CR2)
  - **Resolved:** `2026-07-21T13:21:55Z`
- [x] Fix the resolution so it always targets the invoking worktree — extending the fix to `src/state-store.mjs` too if CR2's trace found it exposed — and turn the reproduction test green; verify: `node --test test/repo-root-hook.test.mjs test/check.test.mjs` (CR1)
  - **Resolved:** `2026-07-21T13:21:55Z`
- [x] Run the full gate to confirm no other command sharing this resolution path regressed; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-21T13:21:56Z`

## Log

- **2026-07-21T00:07:06Z** `[note]` Change creado a partir de un hallazgo de sesión (chip de tarea), no de una investigación de código todavía. Reemplaza ese chip.
- **2026-07-21T12:49:15Z** `[status]` draft → approved
- **2026-07-21T13:02:40Z** `[status]` approved → in-progress
- **2026-07-21T13:02:40Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-21T13:02:41Z** `[note]` Rama creada desde codex/global-state-branch, no desde dev: dev todavía no tiene el código de 20260720-124231 (done, sin graduar/mergear).
- **2026-07-21T13:17:57Z** `[note]` [note] Trace CR2: readStateStore/syncStateStore/publishStateStore in src/state-store.mjs son SEGUROS, no comparten resolucion defectuosa. Reciben repoRoot como parametro explicito y enrutan el 100% de git por objectRun/objectRunBuffer -> sanitizedEnv() (src/git.mjs:24), que elimina GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES/GIT_COMMON_DIR/GIT_CEILING_DIRECTORIES. Demostrado con evidencia red/green: con GIT_DIR heredado apuntando a un repo NO relacionado y cwd=repoRoot, readStateStore(repoRoot) lee correctamente la rama de estado del repoRoot; al neutralizar la linea de stripping en sanitizedEnv, git usa el GIT_DIR heredado y falla ('state branch does not exist'). repoRoot en si viene de findChangeledgerDir(cwd) (walk-up de filesystem), correcto bajo un hook.
- **2026-07-21T13:18:21Z** `[note]` [note] Causa raiz CR1: NO existe defecto independiente de resolucion de repoRoot en check/repo.mjs/state-store.mjs. La deteccion de 'outdated AGENTS.md' vive en checkContract (src/contract.mjs:251), que lee AGENTS.md/CLAUDE.md SOLO del sistema de archivos en repo.repoRoot = path.dirname(findChangeledgerDir(cwd)) (src/config.mjs:10, src/repo.mjs:152); no invoca git, asi que ninguna variable GIT_* heredada puede redirigirla. Bajo un git hook (incluido un worktree enlazado, donde git fija GIT_DIR=.git/worktrees/<n> y GIT_INDEX_FILE) el cwd es el top del worktree invocador, por lo que repoRoot y la lectura de AGENTS.md son correctos: check en hook == check interactivo. Reproducido de verdad: worktrees reales compartiendo un .git + hook pre-commit real que ejecuta el CLI + git commit real; y forzando GIT_DIR/GIT_WORK_TREE hacia un hermano/repo ajeno. Todos identicos al interactivo. El sintoma original (falso 'outdated' en hook pero limpio interactivo) solo puede darse si el AGENTS.md del working tree ya estaba stale al correr el hook: el hook corre 'pnpm test' antes de 'changeledger check', y los fixtures pre-fix filtraban GIT_DIR/GIT_WORK_TREE a comandos git en tmpdirs (bug ya corregido aparte), pudiendo alterar el working tree real del invocador. Esa es la clase real, ya arreglada; no un defecto de check.
- **2026-07-21T13:22:08Z** `[note]` [note] Resultado de implementacion: NO se requiere cambio en src/. CR1 y CR2 ya se cumplen en el codigo actual; el defecto de la premisa (check resuelve mal repoRoot bajo hook) no existe de forma independiente. Entregable: cobertura de regresion permanente en test/repo-root-hook.test.mjs — CR1 (worktrees reales compartiendo .git + hook pre-commit real que ejecuta el CLI + git commit real en el worktree enlazado invocador con AGENTS.md al dia mientras el hermano esta stale: el commit pasa y check==interactivo, el hermano no influye) y CR2 (readStateStore/publishStateStore anclados en repoRoot son inmunes a GIT_DIR/GIT_WORK_TREE heredados apuntando a un repo ajeno; caso red-sin-guard/green-con-guard verificado). Gate completo verde: biome lint limpio, 791/791 node --test, changeledger check 207 valid. El sintoma original pertenece a la clase ya corregida de fuga de GIT_DIR en fixtures de test.
- **2026-07-21T13:22:20Z** `[status]` in-progress → in-review
- **2026-07-21T13:27:51Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-21T15:50:23Z** `[validation]` in-validation → done (human accepted)
