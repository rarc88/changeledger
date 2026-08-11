---
id: "20260810-213632"
title: Pinear los follow-ups de test del review de la costura de autoría
type: quick
status: done
created: 2026-08-10T21:36:32Z
depends_on: []
archived: true
reviewed: true
branch: quick/20260810-213632
related_to: ["20260810-182641"]
owner: claude
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
- **2026-08-10T21:49:36Z** `[owner]` set: claude
- **2026-08-10T21:58:09Z** `[note]` Pins añadidos en test/edit.test.mjs: CR3 ahora cubre archived/reviewed como owned fields; CR8 conduce un conflicto CAS real (git shim en PATH) a través de newChangeFrom, sin retry ni escritura parcial. Producción sin cambios (git diff -- src/ vacío en ambos mutantes).
- **2026-08-10T21:59:53Z** `[status]` in-progress → in-validation
- **2026-08-11T00:35:20Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T00:36:10Z** `[graduation]` skipped: test-only: pins de guardas ya documentadas por la graduación de 182641
- **2026-08-11T00:36:12Z** `[archive]` archived
