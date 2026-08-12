---
id: "20260812-024553"
title: Los fixtures fijan line endings deterministas
type: quick
status: done
created: 2026-08-12T02:45:53Z
depends_on: []
branch: quick/20260812-024553
related_to: ["20260812-011851", "20260812-022248"]
owner: rarc88
---

## Request

Capa siguiente del CI de Windows (run tras `20260812-022248`): 8 tests de
cutover/undo fallan comparando BYTES del worktree — los runners Windows
traen `core.autocrlf=true` y el checkout/revert materializa CRLF donde el
fixture escribió LF. Producción no está afectada (la puerta del undo compara
blobs normalizados, `assertRevertRestoresSnapshot`); es la clase de
fixtures que aseveran bytes de archivos del worktree.

Cierre en el asiento único ya existente: `initGitFixture`
(test/helpers/git-env.mjs) fija `core.autocrlf false` en cada repo de
fixture, como ya fija la identidad — los repos de test son deterministas en
todos los SO por construcción.

## Log
- **2026-08-12T02:45:55Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T02:45:55Z** `[status]` approved → in-progress
- **2026-08-12T02:45:55Z** `[branch]` set: quick/20260812-024553 (auto)
- **2026-08-12T02:48:17Z** `[note]` core.autocrlf=false en initGitFixture (mismo asiento que la identidad), pin visto fallar antes; los 8 tests de undo que comparan bytes del worktree quedan deterministas en todos los SO. Producción intacta: la puerta del undo ya comparaba blobs normalizados
- **2026-08-12T02:48:17Z** `[status]` in-progress → in-validation
- **2026-08-12T10:17:43Z** `[validation]` in-validation → done (human accepted via conversation)
