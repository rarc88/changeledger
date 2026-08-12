---
id: "20260812-013145"
title: El CI trae y activa el ledger del repo
type: quick
status: done
created: 2026-08-12T01:31:45Z
depends_on: []
archived: true
reviewed: true
branch: quick/20260812-013145
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
- **2026-08-12T01:31:47Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T01:47:05Z** `[status]` approved → in-progress
- **2026-08-12T01:47:05Z** `[branch]` set: quick/20260812-013145 (auto)
- **2026-08-12T01:48:52Z** `[note]` fetch-depth: 0 en el checkout (trae refs/heads/changeledger/state como remote-tracking... como todas las ramas) + paso activate antes del verify (siembra desde remote-tracking, dogfood de 163203 en cada run); check del CI pasa a validar el ledger real. La verificación definitiva es el propio run del PR 4
- **2026-08-12T01:48:52Z** `[status]` in-progress → in-validation
- **2026-08-12T01:54:07Z** `[validation]` in-validation → in-progress (agent rejected): El paso activate necesita identidad git en el runner: writeActivation crea el commit de activación via commit-tree y linux/windows no autodetectan (macOS sí). Falta el paso convencional de identidad en el workflow
- **2026-08-12T01:54:07Z** `[note]` Capa 4 (producción observada en CI): activate committea la activación y el runner linux/windows no tiene identidad — paso convencional de git config en el workflow (changeledger-ci). Anotado follow-up de producto: ¿debe writeActivation/mutateState llevar identidad fallback de herramienta para máquinas sin identidad? Decisión de Roberto pendiente
- **2026-08-12T01:54:08Z** `[status]` in-progress → in-validation
- **2026-08-12T10:17:42Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-12T10:18:46Z** `[graduation]` skipped: la verdad duradera es el propio ci.yml versionado
- **2026-08-12T10:18:47Z** `[archive]` archived
