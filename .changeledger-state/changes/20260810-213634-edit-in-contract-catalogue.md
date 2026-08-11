---
id: "20260810-213634"
title: Añadir edit al catálogo de comandos del contrato
type: quick
status: done
created: 2026-08-10T21:36:34Z
depends_on: []
branch: quick/20260810-213634
related_to: []
owner: claude
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
- **2026-08-10T21:42:18Z** `[owner]` set: claude
- **2026-08-10T21:44:03Z** `[note]` Línea de edit añadida al catálogo de implement.md (forma completa + acotación: solo contenido, nunca lifecycle; única vía de cuerpo en activado). Budgets verificados por la suite (1396/1396): el fragmento sigue bajo techo
- **2026-08-10T21:44:03Z** `[status]` in-progress → in-validation
- **2026-08-11T00:35:21Z** `[validation]` in-validation → done (human accepted via conversation)
