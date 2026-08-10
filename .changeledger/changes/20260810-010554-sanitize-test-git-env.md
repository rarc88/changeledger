---
id: "20260810-010554"
title: Sanear el entorno git en todos los fixtures de tests
type: quick
status: approved
created: 2026-08-10T01:05:54Z
depends_on: []
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
