---
id: "20260812-003313"
title: El contrato nombra cómo se adopta el estado por primera vez
type: quick
status: done
created: 2026-08-12T00:33:13Z
depends_on: []
branch: quick/20260812-003313
related_to: ["20260811-151426"]
owner: rarc88
---

## Request

Hallazgo 5 del experimento de adopción (ranchops, 2026-08-12): el bloque
"Synchronizing the global state" de core describe sync y activate pero no
cómo se llega al estado activado por primera vez — el agente encontró
`cutover` solo listando help. Una línea en ese bloque ("un repo aún no
activado entra con `changeledger cutover` desde su rama de integración; los
clones posteriores, con `activate`") cierra el hueco, con la disciplina de
budgets vigente y el concept guard 15 intacto.

## Log
- **2026-08-12T00:33:46Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T00:37:05Z** `[status]` approved → in-progress
- **2026-08-12T00:37:05Z** `[branch]` set: quick/20260812-003313 (auto)
- **2026-08-12T00:39:31Z** `[note]` Línea de adopción en el bloque de sync de core (cutover una vez desde la rama de integración; clones con activate); guard 15 ampliado con la obligación, visto fallar antes de la prosa (y una vez más por exigir el backtick exacto — afinado a la palabra)
- **2026-08-12T00:39:31Z** `[status]` in-progress → in-validation
- **2026-08-12T00:50:14Z** `[validation]` in-validation → done (human accepted via conversation)
