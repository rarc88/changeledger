---
id: "20260810-213632"
title: Pinear los follow-ups de test del review de la costura de autoría
type: quick
status: in-progress
created: 2026-08-10T21:36:32Z
depends_on: []
branch: quick/20260810-213632
related_to: ["20260810-182641"]
owner: rarc88
---

## Request

Dos follow-ups del review de `20260810-182641`, ambos pins de test sin
tocar producción:

- Los guards de `archived` y `reviewed` como campos con comando dueño en
  `edit` se confirmaron con probe en vivo pero ningún test los pinea — hoy
  solo `status`/`owner`/`branch` están cubiertos y un refactor podría
  retirarlos en silencio.
- Ningún test conduce un conflicto CAS a través de `newChangeFrom`: la
  propagación está pineada en la costura (`change-store` CR2) pero no en el
  caller nuevo, que no debe ganar nunca un catch silencioso.

Test-only en `test/edit.test.mjs` (o `test/cli.test.mjs` si el fixture de
conflicto vive mejor ahí); cada pin con su mutante aislado.

## Log
- **2026-08-10T21:38:10Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T21:49:36Z** `[status]` approved → in-progress
- **2026-08-10T21:49:36Z** `[branch]` set: quick/20260810-213632 (auto)
