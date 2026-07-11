---
id: "20260711-160445"
title: "Empates de score en search: spec antes que change"
type: quick
status: done
created: 2026-07-11T16:04:45Z
depends_on: [ "20260711-103758" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Hallazgo del review de #20260711-103758: en un empate de score entre un spec y
un change, el desempate actual (ref descendente) produce un orden que no
comunica intención. Decisión propuesta: a igual score, los specs se ordenan
antes que los changes porque son la verdad persistente vigente — exactamente lo
que un agente debe leer primero antes de investigar; entre iguales se conserva
el desempate estable actual. Ajuste en el comparador de `src/search.mjs` con
regresión del empate en `test/search.test.mjs`. Un solo concern, reversible.

## Log
- **2026-07-11T16:12:35Z** — status: draft → approved
- **2026-07-11T16:23:50Z** — status: approved → in-progress
- **2026-07-11T16:23:50Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T16:30:18Z** — Integrada implementación delegada (b17543c): el comparador prefiere spec sobre change a igual score, desempate estable intacto; 2 regresiones. pnpm verify 613/613.
- **2026-07-11T16:30:18Z** — status: in-progress → in-validation
- **2026-07-11T21:39:51Z** — validation → done (human accepted)
- **2026-07-11T21:52:41Z** — graduado a spec `architecture.md`
- **2026-07-11T21:54:25Z** — archived
