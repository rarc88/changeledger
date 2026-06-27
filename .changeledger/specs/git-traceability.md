---
title: Trazabilidad git
updated: 2026-06-27T21:25:58Z
tags: [ git ]
---

## Trazabilidad git

`git.mjs` (`gitRefs`, runner inyectable) enlaza un change con git por la
convención de commit `[#<id>]`: lista los commits que lo referencian y las
branches cuyo nombre lo contiene; tolera repos no-git devolviendo vacío. El
endpoint `GET /api/git?project=&id=` los sirve y el detalle muestra la sección
**Git**. El lookup de PR (red/`gh`) queda fuera del visor local.

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
