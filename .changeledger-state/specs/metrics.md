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
que estampan la graduación y `sync`— no siembra ningún tramo de la timeline, porque el
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
  validación, que carga la mayoría de los rechazos jamás registrados. Sin ella
  la métrica leería casi cero sobre todo el histórico.
  `[validation] in-validation → done` es la aceptación y no suma.

Una devolución del agente no cuenta en ninguna de las dos formas, y un
`review fail` tampoco: sale de `in-review`, no de `done`.

Cómo se reconoce al agente difiere entre las dos formas. En
`[status] done → in-progress` el actor se exige en positivo (`(human)`,
`(human reopened)`), porque el escritor está vivo y se sabe qué estampa. En la
forma histórica se excluye en negativo —cuenta todo lo que no sea `(agent …)`—
porque su escritor está retirado y los detalles que pudo estampar no se leen de
ningún código vigente, así que lo no marcado como agente se toma como del
humano. Ninguna de las dos reglas se comporta distinto sobre el archivo real:
no existe ni un retorno en esa puerta sin actor.

Que el agente use esa puerta corrige la premisa de `20261018-131621`, que dio
por hecho que un retorno allí era humano por definición. De los 214 retornos
que los dos repos consumidores tienen registrados en esa puerta, 111 son
`(agent rejected)` —el agente devolviéndose su propio trabajo, con motivos como
haberse autorrevisado o haber encontrado su propio bug en pruebas— y 103 son
del humano. Contarlos todos inflaba la métrica alrededor del doble.

`rejectionCount` no cuadra con las aristas de retrabajo de `usage-analysis.mjs`
(`FAILED_VERDICT_EDGES`), y no debe cuadrar. Difieren en dos ejes. Por actor:
el retrabajo no filtra ninguno, porque mide consumo y un tramo rehecho cuesta
lo mismo lo pidiera quien lo pidiera, así que `[status] done → in-progress
(agent)` es retrabajo y no es rechazo. Y por aristas: el retrabajo cuenta
además `[review] in-review → in-progress` y `[review] in-review → blocked`, que
son veredictos del revisor y no devoluciones del humano, así que
`rejectionCount` no los cuenta nunca. Leer las dos cifras como si midieran lo
mismo es el error que esta nota existe para evitar.

`reviewRetries` cuenta esa otra arista, `[review] in-review → in-progress`: todo
veredicto `fail` del revisor independiente. El veredicto no tiene clases, así que
la cifra es el número de rondas de revisión que no pasaron, sin distinguir entre
un defecto corregible y uno que necesita juicio del humano — esa clasificación
vive en el informe del revisor, no en la métrica.

El server las precalcula y el visor las pinta en la pestaña **Metrics**.
