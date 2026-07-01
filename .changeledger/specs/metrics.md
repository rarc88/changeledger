---
title: Métricas
updated: 2026-07-01T22:18:32Z
tags: [ metrics ]
---

## Métricas

> Graduado del change 20260616-210825 (métricas cuentan cierres por revisión).
> Graduado del change 20260630-225210 (parser de eventos compartido con check).

`metrics.mjs` deriva, sin IO, métricas de entrega de los timestamps. El cierre
(`done`) y el paso a cada estado se leen del `## Log` con `parseLogEvent` de
`src/lifecycle.mjs` — el mismo parser que usa la validación secuencial de
`changeledger check`, para que métricas y validación no diverjan: una entrada que
métricas contaría pero que rompe la secuencia la señala `check` como error, no
produce silenciosamente una timeline engañosa. Reconoce `status: from → estado`,
`review → estado` y `validation → estado`; de ahí salen:
cycle time (`done − created`), lead time por etapa, WIP actual, aging de los
`in-progress`, tiempo bloqueado, throughput por día y desgloses por tipo/owner.
El server las precalcula y el visor las pinta en la pestaña **Metrics**.
