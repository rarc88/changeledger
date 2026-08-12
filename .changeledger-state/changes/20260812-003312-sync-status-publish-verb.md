---
id: "20260812-003312"
title: El status sin copia remota dice publicar, no fetch
type: quick
status: done
created: 2026-08-12T00:33:12Z
depends_on: []
reviewed: true
branch: quick/20260812-003312
related_to: ["20260811-151426"]
owner: rarc88
---

## Request

Hallazgo 3 del experimento de adopción (ranchops, 2026-08-12): recién
cortado, `sync --status` reporta "no remote-tracking copy of the state ref
yet; run `changeledger sync` to fetch one" — pero no hay nada que traer:
lo que sync hará en ese estado es PUBLICAR la ref local. El mensaje del
caso sin copias (reportStatus, sync.mjs) pasa a describir ambas salidas
posibles con el verbo honesto: `sync` la publicará si el remoto no la
tiene, o la traerá si existe — sin adivinar cuál, que para eso está
ejecutarlo.

## Log
- **2026-08-12T00:33:46Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T00:33:47Z** `[status]` approved → in-progress
- **2026-08-12T00:33:47Z** `[branch]` set: quick/20260812-003312 (auto)
- **2026-08-12T00:35:55Z** `[note]` Mensaje del caso sin copias reescrito con ambas salidas honestas (publicar si el remoto no la tiene, traer si existe); pin endurecido con doesNotMatch de 'to fetch one', visto fallar antes del cambio
- **2026-08-12T00:35:56Z** `[status]` in-progress → in-validation
- **2026-08-12T00:50:14Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-12T00:50:15Z** `[graduation]` skipped: corrección de mensaje; la verdad del comando vive en la sección de sync ya graduada
