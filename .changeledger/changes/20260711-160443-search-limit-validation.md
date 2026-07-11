---
id: "20260711-160443"
title: search valida --limit no numérico en vez de callar
type: quick
status: in-progress
created: 2026-07-11T16:04:43Z
depends_on: [ "20260711-103758" ]
owner: raruiz-hiberuscom
---

## Request

Hallazgo del review de #20260711-103758: `changeledger search x --limit abc`
degrada en silencio a "no matches" en lugar de fallar. Un `--limit` no numérico
o menor que 1 debe producir un error claro con exit distinto de 0 (fail fast),
como hace commander con las opciones desconocidas. Fix en
`src/commands/search.mjs` o el registro de la opción en `bin/changeledger.mjs`,
con regresión en `test/search.test.mjs`. Un solo concern, reversible.

## Log
- **2026-07-11T16:12:22Z** — status: draft → approved
- **2026-07-11T16:23:34Z** — status: approved → in-progress
- **2026-07-11T16:23:34Z** — owner → raruiz-hiberuscom (auto)
