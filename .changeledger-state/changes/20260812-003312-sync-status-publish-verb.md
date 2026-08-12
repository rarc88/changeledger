---
id: "20260812-003312"
title: El status sin copia remota dice publicar, no fetch
type: quick
status: draft
created: 2026-08-12T00:33:12Z
depends_on: []
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
