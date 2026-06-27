---
title: Definition of Ready
updated: 2026-06-27T21:25:58Z
tags: [ readiness, tdd ]
---

## Definition of Ready (tdd)

El modelo de uso es **documentar con modelo fuerte, implementar con modelo menos
potente**. El flag `tdd` en `config.yml` (default `true`) gobierna la política: con
`true`, los changes se documentan *test-grade* (cada requisito un CR concreto;
cada tarea del Plan nombra archivos+test y mapea a un CR) y se implementan con TDD.
`change.mjs` expone los CR declarados en `## Specification` (`parseChange().criteria`);
`check.mjs` (`checkCoverage`) cruza CR↔tarea y emite **warnings** (nunca errores)
cuando, en un change `approved`/`in-progress` cuyo tipo activa `specification`, un
CR no tiene tarea o una tarea no referencia CR. No juzga si un CR es realmente
test-grade (no parseable) — eso queda como juicio del agente documentador. `draft`
(autoría en curso) y `done` (histórico) no se evalúan. `tdd: false` desactiva el
cruce (repos exploratorios).
