---
id: "20260810-213634"
title: Añadir edit al catálogo de comandos del contrato
type: quick
status: in-progress
created: 2026-08-10T21:36:34Z
depends_on: []
branch: quick/20260810-213634
related_to: []
owner: rarc88
---

## Request

`edit` no aparece en el catálogo "Useful mutation commands" del fragmento
`templates/contract/implement.md`: los agentes no aprenden el comando del
contexto y en modo activado es la única vía de escritura de cuerpo. Añadir
la línea del comando con su forma (`edit <change-id|spec:slug> --from
<file|->`) respetando el techo de `budgets.yml` — si no cabe, parar y
devolver al humano, nunca vaciar otra norma para cuadrar.

## Log
- **2026-08-10T21:38:10Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T21:42:17Z** `[status]` approved → in-progress
- **2026-08-10T21:42:17Z** `[branch]` set: quick/20260810-213634 (auto)
