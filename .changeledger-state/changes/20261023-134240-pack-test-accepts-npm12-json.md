---
id: "20261023-134240"
title: El test de empaquetado acepta la salida JSON de npm 12
type: quick
status: in-progress
created: 2026-10-23T13:42:40Z
depends_on: []
branch: quick/20261023-134240
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
- **2026-10-23T13:44:05Z** `[status]` draft → approved (human via conversation)
- **2026-10-23T13:44:11Z** `[status]` approved → in-progress
- **2026-10-23T13:44:11Z** `[branch]` set: quick/20261023-134240 (auto)
- **2026-10-23T13:48:28Z** `[note]` TDD: el test estaba en rojo con npm 12.2 ('TypeError: Cannot read properties of undefined (reading "files")'); con la lectura de array u objeto pasa 12/12. Mutante en copia: quitar templates/ de files en package.json lo pone en rojo con 'package missing investigation skeleton', así que no está verde por vacío. pnpm verify entero en verde por primera vez en esta máquina: biome 134 ficheros, suite 2146/2146, check en verde, exit 0.
