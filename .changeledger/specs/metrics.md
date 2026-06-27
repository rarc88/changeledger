---
title: Métricas
updated: 2026-06-27T21:50:56Z
tags: [ metrics ]
---

## Métricas

> Graduado del change 20260616-210825 (métricas cuentan cierres por revisión).

`metrics.mjs` deriva, sin IO, métricas de entrega de los timestamps. El cierre
(`done`) y el paso a cada estado se leen del `## Log`, tanto desde transiciones
`status: ... → estado`, `review → estado` y `validation → estado`; de ahí salen:
cycle time (`done − created`), lead time por etapa, WIP actual, aging de los
`in-progress`, tiempo bloqueado, throughput por día y desgloses por tipo/owner.
El server las precalcula y el visor las pinta en la pestaña **Metrics**.
