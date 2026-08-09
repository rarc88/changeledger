---
id: "20260809-140158"
title: Derivar la matriz de help de program.commands
type: quick
status: draft
created: 2026-08-09T14:01:58Z
depends_on: []
related_to: ["20260809-113241"]
owner: rarc88
---

## Request

Follow-up del review de `20260809-113241`: la matriz de help de `225212 CR6`
en `test/cli-bin.test.mjs` es un array de 24 entradas curado a mano que hoy
omite `import`, `cutover`, `activate`, `commit`, `fix`, `search` y
`validation` — un comando nuevo puede quedar sin help verificado sin que nada
lo detecte. Derivar la lista de `program.commands` (o equivalente) para que la
cobertura del help sea estructural: un comando registrado en el bin entra en
la verificación por construcción, y la omisión deliberada de uno exige
excluirlo por nombre, visible en review. Superficie: `test/cli-bin.test.mjs`
(y `bin/changeledger.mjs` solo si hace falta exponer la lista).

## Log
