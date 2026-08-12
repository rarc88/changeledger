---
id: "20260812-003311"
title: El cutover enumera sus precondiciones y deja solo config.yml
type: quick
status: done
created: 2026-08-12T00:33:11Z
depends_on: []
branch: quick/20260812-003311
related_to: ["20260809-113240"]
owner: rarc88
---

## Request

Hallazgos 1 y 2 del experimento de adopción con contexto limpio (ranchops,
2026-08-12): (a) la ayuda de `cutover` exige "whose ledger is clean" sin
definición operativa — el agente tuvo que inferir que los drafts sin
commitear bloqueaban, y nunca vio el error real; (b) la ayuda promete
"keeps only config.yml" pero el worktree conserva directorios de colección
vacíos (git no trackea directorios: el commit de limpieza no puede
retirarlos — confirmado: ningún rm de directorios en cutover.mjs).

La ayuda enumera las precondiciones exactas que el comando ya exige
(ledger sin cambios ni untracked bajo las colecciones, índice sin staged,
repo sin activar, HEAD en la rama de integración), y la limpieza borra del
worktree los directorios de colección que queden vacíos, cumpliendo el
texto al pie de la letra. Sin --dry-run por ahora: con las precondiciones
enumeradas, el fail-closed existente ya nombra el bloqueo real.

## Log
- **2026-08-12T00:33:45Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T00:40:38Z** `[status]` approved → in-progress
- **2026-08-12T00:40:38Z** `[branch]` set: quick/20260812-003311 (auto)
- **2026-08-12T00:45:13Z** `[note]` Precondiciones enumeradas en el help (rama, no activado, ledger limpio con su definición operativa); commitCleanup borra los directorios de colección vacíos del worktree (rmdirSync con catch estrecho ENOENT/ENOTEMPTY — el catch amplio inicial se tragó un ReferenceError de fs sin importar, lección anotada). El shape exacto de ranchops (releases/ vacío pre-corte) reproducido en test y visto fallar
- **2026-08-12T00:45:14Z** `[status]` in-progress → in-validation
- **2026-08-12T00:50:13Z** `[validation]` in-validation → done (human accepted via conversation)
