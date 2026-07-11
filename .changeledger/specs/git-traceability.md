---
title: Trazabilidad git
updated: 2026-07-11T21:53:18Z
tags: [ git ]
---

## Trazabilidad git

> Graduado del change 20260617-161309 (workflow git para trazabilidad).
> Actualizado por el change 20260711-103757 (contrato de commits ejecutable: helper y lint).
> Actualizado por el change 20260711-204419 (diagnóstico de fallos de commit).

`git.mjs` (`gitRefs`, runner inyectable) enlaza un change con git por la
convención de commit `[#<id>]`: lista los commits que lo referencian y las
branches cuyo nombre lo contiene; tolera repos no-git devolviendo vacío. El
endpoint `GET /api/git?project=&id=` los sirve y el detalle muestra la sección
**Git**. El lookup de PR (red/`gh`) queda fuera del visor local.

**Contrato de commits ejecutable.** `changeledger commit -m "<subject>"
[--id <id>...]` compone el sufijo canónico `[#id]` (varios ids → `[#A] [#B]`),
resuelve el único change `in-progress` cuando se omite `--id` y valida la forma
conventional-commit del subject antes de delegar en `git commit`. `changeledger
check --commits [base]` lintea un rango de commits exigiendo el marcador
`[#id]`; exime merges y `chore(release)`. El runner de `git.mjs` sanea
`GIT_DIR`/`GIT_WORK_TREE` del entorno heredado para que hooks anidados no
redirijan comandos git al repo equivocado. `git.mjs` distingue dos perfiles de
ejecución: las consultas tolerantes (`defaultRun`) degradan en silencio a vacío,
mientras el camino mutador de `changeledger commit` usa `mutatingRun`, que
captura stderr/stdout de git y los incluye en el error lanzado — un commit
fallido (hook, nada staged, identidad ausente) siempre expone su diagnóstico en
vez de un exit 1 opaco.

El contrato canónico protege esa trazabilidad con un workflow git explícito:
los agentes no implementan changes aprobados en `main`, `master` ni `dev`;
revisan el worktree antes de empezar; commitean la documentación aprobada antes
de tocar código; e implementan un change a la vez. Una unidad completada se
commitea antes de continuar cuando otra tarea, change o modificación de la misma
superficie podría volver ambigua la atribución. Los cambios no relacionados no
se incluyen silenciosamente. Si archivos compartidos vuelven inevitable un
commit combinado, se declara como excepción y se nombran los changes que
comparten la superficie.

Una corrección candidata nacida de un `review fail --retry` queda sin commit y
aislada hasta que otro revisor de contexto limpio la confirme. Tras el `pass`, se
commitea con la verdad relacionada antes de solicitar validación humana. Una
corrección nacida de un rechazo humano permanece sin commit hasta la aceptación
final. Los intentos fallidos iteran sobre el mismo diff y no se empieza otra
tarea/change durante la espera; tras aceptación, se gradúa o salta graduación y
se commitean juntos la corrección validada y su verdad relacionada.
