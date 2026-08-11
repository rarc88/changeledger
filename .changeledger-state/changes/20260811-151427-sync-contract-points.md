---
id: "20260811-151427"
title: Puntos estratégicos y protocolo de conflicto del sync en el contrato
type: quick
status: in-validation
created: 2026-08-11T15:14:27Z
depends_on: []
branch: quick/20260811-151427
related_to: []
owner: rarc88
---

## Request

Compañero de contrato del comando `sync` (etapa 3): el sync es obligación
de contrato en puntos estratégicos, nunca automatización oculta. Un
fragmento nuevo (o la extensión mínima de los packs que correspondan)
declara: (1) los puntos — al abrir sesión sobre un repo activado con
remoto, antes de delegar un review (el candidato se congela contra el
estado más fresco), en el cierre durable (graduación/archive) y en el
handoff; (2) el protocolo de conflicto — notificar al humano nombrando los
documentos en colisión, coordinar la resolución (el caso probable: dos
graduaciones sobre la misma spec), y tras resolver, `sync` de nuevo hasta
publicar; (3) la entrada de `sync`/`sync --status` en el catálogo de
comandos. Nada de esto bloquea el flujo local: sin remoto, los puntos son
no-op y el contrato lo dice. Respetar los techos de `budgets.yml` con la
disciplina vigente; si no cabe, parar y devolver al humano.

## Log
- **2026-08-11T15:20:10Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T16:11:18Z** `[status]` approved → in-progress
- **2026-08-11T16:11:18Z** `[branch]` set: quick/20260811-151427 (auto)
- **2026-08-11T16:15:57Z** `[note]` Obligación completa en un bloque propio de core (## Synchronizing the global state, core a 3000/4000 tras la edición): puntos estratégicos, protocolo de conflicto, nunca-bloqueante y activación manual por clon; catálogo de implement gana la línea de sync; obligaciones guardadas como entrada 15 del concept guard (vista fallar antes de la prosa — dos veces: la segunda porque mi gap no cruza oraciones, corregido poniendo sync en la frase de los puntos); pin estructural de core retargeteado a doce bloques
- **2026-08-11T16:15:57Z** `[status]` in-progress → in-validation
