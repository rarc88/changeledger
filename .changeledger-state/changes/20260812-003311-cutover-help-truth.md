---
id: "20260812-003311"
title: El cutover enumera sus precondiciones y deja solo config.yml
type: quick
status: draft
created: 2026-08-12T00:33:11Z
depends_on: []
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
