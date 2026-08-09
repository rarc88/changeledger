---
id: "20260809-140158"
title: Derivar la matriz de help de program.commands
type: quick
status: done
created: 2026-08-09T14:01:58Z
depends_on: []
reviewed: true
branch: quick/20260809-140158
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
- **2026-08-09T16:18:33Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T16:22:39Z** `[status]` approved → in-progress
- **2026-08-09T16:22:39Z** `[branch]` set: quick/20260809-140158 (auto)
- **2026-08-09T17:36:16Z** `[note]` Implementación TDD completada: matriz derivada recursivamente del help de Commander, 34 rutas cubiertas, exclusión explícita de help, cli-bin 60/60 y pnpm verify 1324/1324.
- **2026-08-09T17:36:53Z** `[status]` in-progress → in-validation
- **2026-08-09T19:37:00Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-09T19:39:45Z** `[graduation]` skipped: matriz de help derivada en tests: sin verdad persistente
