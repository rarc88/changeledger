---
title: Validación (changeledger check)
updated: 2026-07-11T15:45:50Z
tags: [ validation ]
graduated_from: ["20260616-151221", "20260616-162014", "20260616-162050", "20260616-162104", "20260703-150231", "20260711-103800"]
---

## Validación (`changeledger check`)

`check.mjs` es puro (sin IO) y valida changes y, en modo repo completo, también
la capa de specs y sus enlaces: marcadores de conflicto de merge, etapas
duplicadas, enlaces change↔spec rotos (error), specs huérfanos y `updated`
desfasado respecto a la actividad de un change enlazado (warning). Los enlaces
change→spec salen solo de los marcadores reales que `changeledger graduate` escribe en
`## Log`; ejemplos o placeholders del mismo texto en otras etapas no crean
enlaces reales. Para detectar specs stale, `updated` se compara contra la
actividad de graduación enlazada, no contra entradas posteriores del Log como
`archived`, porque esas no cambian la verdad persistente.

La validación también fija invariantes del formato Markdown que el parser expone:
headings de etapa con casing canónico, tareas `[x]` con timestamp ISO UTC,
tareas `[!]` con razón y criterios `CRn` no duplicados. El parser de tareas
interpreta el sufijo de resolución/bloqueo desde el último separador ` — ` para
preservar descripciones que contienen la misma raya.
Las tareas exponen una forma machine-readable: `task.text` es la descripción
antes del bloque final de criterios y antes del sufijo reservado ` — ...`;
`task.criteriaRefs` contiene solo los `CRn` del bloque final `(CR1, CR2)`, y
`task.suffix` conserva el sufijo de resolución o bloqueo cuando existe. La
evidencia de readiness, como `verify: ...`, pertenece al texto de la tarea y debe
aparecer antes del bloque final de criterios. Si una tarea pendiente coloca
evidencia de verificación dentro del sufijo reservado, `check.mjs` emite un
diagnóstico específico para distinguir contrato mal escrito de criterio ausente.
El parser de etapas reconoce `##` solo fuera de fenced code blocks, por lo que
los ejemplos Markdown dentro de fences no crean etapas espurias ni duplicadas.

Un change `done` con tareas `todo` o `blocked` es inválido: `check` informa como
error el número de tareas incompletas. `checkSelectedChange` reutiliza exactamente
la validación scoped para evaluar tanto el archivo actual como un candidato aún
no escrito; sólo sus errores bloquean, no sus warnings ni hallazgos de otros
changes. La aceptación humana valida primero el candidato con la transición
`validation → done`, y los modos de graduación validan el `done` seleccionado
antes de tocar change o spec. Estas rutas resuelven y parsean únicamente el
archivo seleccionado; incluso un sibling ilegible queda fuera del gate scoped.

Con `tdd: true`, `approved` e `in-progress` endurecen la Definition of Ready:
cada `CRn` debe declarar pasos `Given`/`When`/`Then`, y cada tarea que referencia
un criterio debe nombrar tanto objetivo como verificación según los patrones
configurados en `readiness.target_patterns` y `readiness.verification_patterns`.
Los patrones pueden cubrir layouts distintos por repo: tests en `test/`, specs
colocados junto al archivo (`**/*.spec.*`, `**/*.test.*`) o comandos concretos de
verificación. Para repos con validaciones manuales o de dispositivo, una
convención portable es configurar `verification_patterns: ["verify:"]` y exigir
que cada tarea describa su evidencia con una cláusula `verify: ...`, sin inflar
la configuración con frases específicas de consola, UI o dispositivo. Cuando una
tarea no cumple la política, el diagnóstico muestra si se usó `readiness`
configurado o por defecto, junto con los `target_patterns` y
`verification_patterns` efectivos. Además, cada `CRn` referenciado por una tarea
debe existir en `## Specification`; un `(CR999)` huérfano es un error en cambios
listos para implementar. En `draft`, esos mismos huecos son warnings para no
bloquear la autoría temprana; con `tdd:false` no se evalúan.

**Normalización mecánica (`changeledger fix`).** `src/fix.mjs` es puro
(texto → fixes, sin IO) y repara solo defectos de formato inequívocos de las
tareas del Plan: sufijo `verify:` dentro del sufijo reservado, guión simple en
lugar de raya en el sufijo de resolución (decidido comparando la posición del
último ` - ` contra el último ` — `, para no tocar descripciones con rayas
legítimas), timestamps casi-ISO y marcadores de checkbox no canónicos. Soporta
`--dry-run`, es idempotente y deja lo ambiguo (p.ej. referencia a un CR
inexistente) intacto, listándolo como `requires manual fix`. `check` sugiere
`changeledger fix` cuando detecta defectos reparables (`hasFixableDefects`).
