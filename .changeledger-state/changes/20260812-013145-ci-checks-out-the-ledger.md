---
id: "20260812-013145"
title: El CI trae y activa el ledger del repo
type: quick
status: draft
created: 2026-08-12T01:31:45Z
depends_on: []
related_to: ["20260812-011851", "20260811-163203"]
owner: rarc88
---

## Request

Segunda capa del CI rojo post-release (PR #4): `actions/checkout` trae una
sola rama, así que el checkout de CI no tiene `refs/heads/changeledger/state`
ni activación — el repo corre los tests DESACTIVADO y sin ledger: el test
auto-referencial `111349 CR6` no puede leer la spec graduada, y el
`changeledger check` del verify valida un ledger vacío en vez del real.

`ci.yml`: el checkout trae todas las refs (`fetch-depth: 0`) y un paso
ejecuta `node bin/changeledger.mjs activate` antes del verify — que además
ejercita la siembra desde remote-tracking (`20260811-163203`) en cada run.
El workflow queda como el entorno de un desarrollador real: ledger legible,
check validando de verdad.

## Log
