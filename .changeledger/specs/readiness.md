---
title: Definition of Ready
updated: 2026-07-01T23:21:38Z
tags: [ readiness, tdd ]
---

## Definition of Ready (tdd)

> Graduado del change 20260614-162547 (Definition of Ready / tdd).
> Graduado del change 20260616-151216 (Definition of Ready verificable).
> Graduado del change 20260617-020229 (Definition of Ready con patrones configurables).
> Graduado del change 20260626-115134 (formato machine-readable de tareas y readiness).
> Corregido por el change 20260630-225208 (severidades reales por estado).

El modelo de uso es **documentar con modelo fuerte, implementar con modelo menos
potente**. El flag `tdd` en `config.yml` (default `true`) gobierna la política: con
`true`, los changes se documentan *test-grade* (cada requisito un CR concreto;
cada tarea del Plan nombra archivos+test y mapea a un CR) y se implementan con TDD.
`change.mjs` expone los CR declarados en `## Specification` (`parseChange().criteria`);
`check.mjs` (`checkCoverage`) evalúa readiness cuando el tipo activa
`specification` y el status es `draft`, `approved` o `in-progress`; `done` y los
estados de cierre no se evalúan, y `tdd: false` desactiva todo el cruce (repos
exploratorios).

Severidad por estado:

- `draft` (autoría en curso): **todos** los diagnósticos son warnings.
- `approved`/`in-progress`: son **errores** los defectos de readiness — un CR sin
  estructura Given/When/Then, una tarea que referencia un CR inexistente y una
  tarea CR-bearing sin target+verificación reconocibles según
  `readiness.target_patterns`/`readiness.verification_patterns`. Los gaps de
  cobertura — un CR sin tarea que lo cubra y una tarea no-`(support)` sin CR —
  siguen siendo **warnings**.

Solo la estructura Given/When/Then de un CR es verificable mecánicamente; la
calidad semántica (inputs concretos, outputs exactos) queda como juicio del
agente documentador.
