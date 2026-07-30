---
title: Definition of Ready
updated: 2026-07-29T23:52:23Z
tags: [ readiness, tdd ]
graduated_from: ["20260614-162547", "20260616-151216", "20260617-020229", "20260626-115134", "20260630-225208", "20260726-141122", "20260729-185200", "20260729-203257"]
---

## Definition of Ready (tdd)

El modelo de uso es **documentar con modelo fuerte, implementar con modelo menos
potente**. El flag `tdd` en `config.yml` (default `true`) gobierna la política: con
`true`, los changes se documentan *test-grade* (cada requisito un CR concreto;
cada tarea del Plan declara sus hijos `Target`/`Verify` y traza vía su hijo
`Criteria`) y se implementan con TDD.
`change.mjs` expone los CR declarados en `## Specification` (`parseChange().criteria`);
`check.mjs` (`checkCoverage`) evalúa readiness cuando el tipo activa
`specification` y el status es `draft`, `approved` o `in-progress`; `done` y los
estados de cierre no se evalúan, y `tdd: false` desactiva todo el cruce (repos
exploratorios).

Severidad por estado:

- `draft` (autoría en curso): **todos** los diagnósticos son warnings.
- `approved`/`in-progress`: son **errores** los defectos de readiness — un CR sin
  estructura Given/When/Then, una tarea que referencia un CR inexistente y una
  tarea CR-bearing sin hijos `Target`/`Verify` que casen
  `readiness.target_patterns`/`readiness.verification_patterns` — cada lista
  juzga **solo su campo**, nunca el texto de la descripción
  (`20260729-203257`, que cerró la vacuidad de casar ambas sobre el mismo
  string) — **y también los gaps de cobertura**: un CR sin tarea que lo cubra y
  una tarea sin `Criteria` ni `Support` (escalados por `20260729-185200`; en
  `draft` siguen siendo warnings).

`changeledger approve` es el gate de salida del draft: valida el texto pre-flip
con la severidad de `approved` (proyección `asStatus`, confinada a la severidad
de cobertura y jamás al lifecycle), rechaza con exit distinto de 0 nombrando los
defectos y deja el documento byte-idéntico. La transición `draft → approved`
tiene una sola sede (`status()`), así que CLI, `approve()` y el drag del viewer
heredan el gate por construcción. Rechaza por cualquier error de `check`
acotado al documento, no solo readiness.

Solo la estructura Given/When/Then de un CR es verificable mecánicamente; la
calidad semántica (inputs concretos, outputs exactos) queda como juicio del
agente documentador.

**Los patrones se publican, no se esconden.** `target_patterns` y
`verification_patterns` tienen forma JavaScript por defecto (`src/**`,
`test/**`), y esos defaults se exigen como error desde `approved`: un repo con
otro layout no podía aprobar un change bien formado sin saber siquiera qué clave
tocar, porque la plantilla distribuía el bloque comentado. Ahora `init` lo
publica sin comentar con esos mismos valores efectivos y un comentario que dice
que se exigen desde `approved` y hay que adaptarlos; la migración de esquema los
añade a los repos que ya existían, y respeta byte a byte cualquier `readiness`
que el repo ya declarara. El deber tiene sujeto nombrado en el contrato: al
empezar a trabajar en un repo, el agente verifica que ambas claves coinciden con
su stack y las configura cuando no. Bajar los patrones hasta que todo pase
—por ejemplo un backtick literal como target— se rechazó de forma explícita:
falsifica la puerta en vez de arreglarla, y el hijo `Support` ya cubre las
tareas que legítimamente no necesitan destino ni verificación.
