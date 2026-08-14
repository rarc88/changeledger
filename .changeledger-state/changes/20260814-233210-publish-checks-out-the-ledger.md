---
id: "20260814-233210"
title: El workflow de publish trae y activa el ledger como el CI
type: quick
status: draft
created: 2026-08-14T23:32:10Z
depends_on: []
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
