---
id: "20260814-233210"
title: El workflow de publish trae y activa el ledger como el CI
type: quick
status: in-validation
created: 2026-08-14T23:32:10Z
depends_on: []
branch: quick/20260814-233210
related_to: ["20260812-013145"]
owner: rarc88
---

## Request

Fallo real al publicar la v0.16.1 (run 31587588251): `publish.yml` ejecuta
el gate completo vía `prepublishOnly` sobre un checkout de una sola rama,
sin identidad git y sin el ledger — la clase exacta que `20260812-013145`
cerró en `ci.yml` y que no se barrió en el workflow hermano (defecto de
proceso: el fix de una clase de entorno de workflow debe enumerar TODOS los
workflows que ejecutan el gate).

Espejo de los tres pasos en `publish.yml`: `fetch-depth: 0` en el checkout,
identidad git del runner, y `changeledger activate` antes del publish.

## Log
- **2026-08-14T23:32:12Z** `[status]` draft → approved (human via conversation)
- **2026-08-14T23:32:12Z** `[status]` approved → in-progress
- **2026-08-14T23:32:12Z** `[branch]` set: quick/20260814-233210 (auto)
- **2026-08-14T23:33:49Z** `[note]` Espejo exacto de los tres pasos de ci.yml en publish.yml (fetch-depth 0, identidad del runner, activate antes del gate). Lección de proceso para memoria: un fix de clase de entorno de workflow enumera TODOS los workflows que ejecutan el gate, no solo el que falló
- **2026-08-14T23:33:50Z** `[status]` in-progress → in-validation
