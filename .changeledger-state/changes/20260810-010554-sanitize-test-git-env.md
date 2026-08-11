---
id: "20260810-010554"
title: Sanear el entorno git en todos los fixtures de tests
type: quick
status: done
created: 2026-08-10T01:05:54Z
depends_on: []
archived: true
reviewed: true
branch: quick/20260810-010554
related_to: []
owner: rarc88
---

## Request

Incidente real del 2026-08-10: al commitear en un worktree, el hook
pre-commit ejecutó la suite y algún fixture que invoca `git` directamente
(`execFileSync('git', ['init'|'config'…], { cwd })` sin sanear el entorno)
heredó el `GIT_DIR` absoluto que git exporta durante el hook y escribió en el
`.git` COMPARTIDO del repo real: `core.bare = true` (rompió todos los
worktrees) e identidad de test (`user.email test@example.com`) en la config.
Reparado a mano; los commits de los carriles pasaron a `--no-verify` con gate
manual. El saneo ya existe (`sanitizedEnv` en `test/helpers/state-repo.mjs`
borra `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`) pero solo lo usa ese helper:
barrer TODO `test/**` para que cada invocación git de fixture pase por un
entorno saneado (hoisting del helper a un módulo compartido si hace falta), y
añadir un guard que falle si un test invoca git con `GIT_DIR` heredado, para
que la clase no reaparezca con el siguiente fixture nuevo. Test-only; sin
superficie pública ni verdad persistente.

## Log
- **2026-08-10T01:18:47Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T14:48:59Z** `[status]` approved → in-progress
- **2026-08-10T14:48:59Z** `[branch]` set: quick/20260810-010554 (auto)
- **2026-08-10T14:48:59Z** `[owner]` set: claude
- **2026-08-10T14:48:59Z** `[note]` Rama apilada sobre feature/20260810-120457 (in-validation): superficie compartida en test/**; se integra a dev tras la aceptación de 120457
- **2026-08-10T15:07:28Z** `[note]` Barrido completo: sanitizedEnv hoisted a test/helpers/git-env.mjs (nueva ubicación, decisión no especificada); ~20 ficheros con invocaciones git de fixture saneadas; guard estático nuevo en test/git-env.test.mjs (sweep de execFileSync/spawnSync sobre 'git' literal, exige env: resuelto a sanitizedEnv). Probado fallando (offender real en register.test.mjs) y pasando tras revertir. pnpm lint, pnpm test (1385/1385) y changeledger check en verde; también verde bajo GIT_DIR=/nonexistent/fake.git pnpm test.
- **2026-08-10T15:10:04Z** `[status]` in-progress → in-validation
- **2026-08-10T17:31:30Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-10T17:31:30Z** `[graduation]` skipped: test-only: saneo de entorno git en fixtures y guard estático; ninguna verdad persistente ni superficie pública cambia
- **2026-08-10T17:39:45Z** `[archive]` archived
- **2026-08-11T11:57:28Z** `[owner]` set: rarc88
