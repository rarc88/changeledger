---
id: "20261023-134240"
title: El test de empaquetado acepta la salida JSON de npm 12
type: quick
status: draft
created: 2026-10-23T13:42:40Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

`CR6: the skeletons ship in the publishable package` en
`test/agent-prompt.test.mjs` lee `npm pack --dry-run --json` como un array
y toma `[0].files`. npm 12.2 devuelve un objeto indexado por nombre de
paquete, así que el test muere con `TypeError: Cannot read properties of
undefined (reading 'files')` antes de su aserción, en `dev` y en toda
rama; la CI no lo ve porque usa el npm que trae cada Node de la matriz.

Cambio: el test toma el primer paquete tanto si la salida es un array como
si es un objeto (`Array.isArray(parsed) ? parsed : Object.values(parsed)`)
y conserva intacta la aserción sobre los ficheros. Verificación:
`node --test test/agent-prompt.test.mjs` en verde con npm 12.2 en local, y
el test sigue en rojo si se quita un skeleton de `package.json` `files`.
Solo test; sin cambio de comportamiento ni de empaquetado.

## Log
- **2026-10-23T13:42:40Z** `[version]` 0.18.0
