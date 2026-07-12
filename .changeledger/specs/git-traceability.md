---
title: Trazabilidad git
updated: 2026-07-12T10:49:41Z
tags: [ git ]
---

## Trazabilidad git

> Graduado del change 20260617-161309 (workflow git para trazabilidad).
> Actualizado por el change 20260711-103757 (contrato de commits ejecutable: helper y lint).
> Actualizado por el change 20260711-204419 (diagnóstico de fallos de commit).
> Actualizado por el change 20260711-210115 (rama de integración configurable).
> Actualizado por el change 20260711-225637 (migración y edición de la rama de integración).
> Actualizado por el change 20260711-225638 (marcadores múltiples en el cuerpo del commit).

`git.mjs` (`gitRefs`, runner inyectable) enlaza un change con git por la
convención de commit `[#<id>]`: lista los commits que lo referencian y las
branches cuyo nombre lo contiene; tolera repos no-git devolviendo vacío. El
endpoint `GET /api/git?project=&id=` los sirve y el detalle muestra la sección
**Git**. El lookup de PR (red/`gh`) queda fuera del visor local.

**Contrato de commits ejecutable.** `changeledger commit -m "<subject>"
[--id <id>...]` deja un único `[#id]` al final del subject. Con varios ids
mantiene el subject limpio y escribe una línea canónica en el cuerpo:
`ChangeLedger: [#A] [#B]`. Resuelve el único change `in-progress` cuando se
omite `--id` y valida la forma conventional-commit antes de delegar en Git.
`changeledger check --commits [base]` acepta exclusivamente esas dos formas y
reporta la causa concreta de marcadores ausentes, ambiguos o mal formados;
exime merges y `chore(release)`. `gitRefs()` busca en el mensaje completo y
presenta el subject limpio. El runner de `git.mjs` sanea
`GIT_DIR`/`GIT_WORK_TREE` del entorno heredado para que hooks anidados no
redirijan comandos git al repo equivocado. `git.mjs` distingue dos perfiles de
ejecución: las consultas tolerantes (`defaultRun`) degradan en silencio a vacío,
mientras el camino mutador de `changeledger commit` usa `mutatingRun`, que
captura stderr/stdout de git y los incluye en el error lanzado — un commit
fallido (hook, nada staged, identidad ausente) siempre expone su diagnóstico en
vez de un exit 1 opaco.

La clave opcional `git.integration_branch` declara la base y el destino de las
ramas de change. Cuando existe, `check --commits` la usa como base por defecto
(una base posicional explícita conserva precedencia) y `changeledger context`
la publica como `integration_branch=<rama>` en la política efectiva. Cuando no
existe, se conserva la autodetección de base mediante `origin/HEAD`, `main` o
`master`.

El schema 3 distribuye esta capacidad a configuraciones existentes y repos
nuevos. La migración v2 → v3 y la plantilla crean un bloque Git separado y
documentado con `integration_branch:` vacío, que conserva la autodetección. El
formulario estructurado del viewer permite declarar, cambiar o vaciar la rama;
al eliminarla preserva las demás claves bajo `git`. Preview y aplicación usan el
mismo motor de migración.

El contrato canónico protege esa trazabilidad con un workflow git explícito:
los agentes no implementan changes aprobados en `main`, `master` ni `dev`;
revisan el worktree antes de empezar; commitean la documentación aprobada antes
de tocar código; e implementan un change a la vez. Una unidad completada se
commitea antes de continuar cuando otra tarea, change o modificación de la misma
superficie podría volver ambigua la atribución. Los cambios no relacionados no
se incluyen silenciosamente. Si archivos compartidos vuelven inevitable un
commit combinado, se declara como excepción y se nombran los changes que
comparten la superficie.

Cuando se declara una rama de integración, las ramas de change parten de ella y
el resultado se integra de vuelta en ella; `main` queda reservado para releases.

Una corrección candidata nacida de un `review fail --retry` queda sin commit y
aislada hasta que otro revisor de contexto limpio la confirme. Tras el `pass`, se
commitea con la verdad relacionada antes de solicitar validación humana. Una
corrección nacida de un rechazo humano permanece sin commit hasta la aceptación
final. Los intentos fallidos iteran sobre el mismo diff y no se empieza otra
tarea/change durante la espera; tras aceptación, se gradúa o salta graduación y
se commitean juntos la corrección validada y su verdad relacionada.
