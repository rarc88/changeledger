---
title: Métricas
updated: 2026-10-19T18:46:32Z
tags: [ metrics ]
graduated_from: ["20260616-210825", "20260630-225210", "20261018-131621"]
---

## Métricas

`metrics.mjs` deriva, sin IO, métricas de entrega de los timestamps. El cierre
(`done`) y el paso a cada estado se leen del `## Log` con `parseLogEvent` de
`src/lifecycle.mjs` — el mismo parser que usa la validación secuencial de
`changeledger check`, para que métricas y validación no diverjan: una entrada que
métricas contaría pero que rompe la secuencia la señala `check` como error, no
produce silenciosamente una timeline engañosa. Reconoce `status: from → estado`, `review → estado` y
`validation → estado`;
un evento sin estado de destino —la línea `[validation] accepted (merged <sha>)`
que estampa la graduación— no siembra ningún tramo de la timeline, porque el
tramo exige `event.to`. De la timeline salen:
cycle time (`done − created`), lead time por etapa, WIP actual sobre los tres
estados vivos (`approved`, `in-progress`, `in-review`), aging de los
`in-progress`, throughput por día y desgloses por tipo/owner.

El tiempo bloqueado (`blockedMs`) suma los tramos en `blocked`. Como `blocked` no
es un estado del ciclo, sólo lee histórico de changes que lo atravesaron y vale
cero en un ledger que nunca lo usó.

`rejectionCount` es el número de veces que el humano devolvió trabajo entregado:
las retiradas de `done`. La aceptación no es un estado, así que la devolución es
el único rastro de un rechazo, y cuenta por tres formas del Log:

- `[status] done → in-progress (human)`, la forma vigente.
- `[status] done → in-progress (human reopened)`, la forma que llevan los
  Log de los repos consumidores.
- `[validation] in-validation → in-progress`, la forma histórica de la puerta de
  validación, que carga 258 de los 278 rechazos registrados en los repos que
  usan ChangeLedger. Sin ella la métrica leería cero sobre casi todo el
  histórico. `[validation] in-validation → done` es la aceptación y no suma.

Una devolución del agente (`(agent)` o `(agent reopened)`) no cuenta, y un
`review fail` tampoco: sale de `in-review`, no de `done`.

El filtro de actor no es uniforme entre las dos lecturas del mismo Log, y la
asimetría es deliberada. `rejectionCount` sólo cuenta las devoluciones del
humano porque mide insatisfacción con lo entregado, y la vuelta que el agente
toma por su cuenta es una segunda pasada suya. Las aristas de retrabajo de
`usage-analysis.mjs` (`FAILED_VERDICT_EDGES`) no filtran por actor porque miden
consumo, y un tramo rehecho cuesta lo mismo lo pidiera quien lo pidiera. De ahí
que `[status] done → in-progress (agent)` sea retrabajo en el coste y no sea
rechazo en la entrega: las dos cifras no tienen por qué cuadrar, y leerlas como
si midieran lo mismo es el error que esta nota existe para evitar.

`reviewRetries` cuenta esa otra arista, `[review] in-review → in-progress`: todo
veredicto `fail` del revisor independiente. El veredicto no tiene clases, así que
la cifra es el número de rondas de revisión que no pasaron, sin distinguir entre
un defecto corregible y uno que necesita juicio del humano — esa clasificación
vive en el informe del revisor, no en la métrica.

El server las precalcula y el visor las pinta en la pestaña **Metrics**.
