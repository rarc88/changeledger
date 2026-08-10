---
title: Validación (changeledger check)
updated: 2026-07-29T18:40:38Z
tags: [ validation ]
graduated_from: ["20260616-151221", "20260616-162014", "20260616-162050", "20260616-162104", "20260703-150231", "20260711-103800", "20260726-194220", "20260729-162616"]
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

La validación distingue el documento como **sujeto** de una regla del documento
como **dato** de un invariante. Un documento congelado —`discarded`, o `done` con
`archived: true`— no recibe ningún diagnóstico del bucle por documento, porque
`archived` es irreversible y `discarded` no reabre: el defecto no se podría
arreglar sin reescribir historia terminada, y como el hook `pre-commit` corre
`check` repo-wide, una regla que evolucione dejaría el gate rojo bloqueando
trabajo ajeno. Pero sigue alimentando sin filtrar los invariantes de repo: ids
duplicados, el grafo de `depends_on` y su búsqueda de ciclos, la reconstrucción
de graduaciones de `checkSpecs`, `checkReleases`, y tanto `knownIds` como los
backlinks de `related_to`. El predicado vive en un único sitio exportado y la
capa CLI lo consume en vez de re-derivarlo.

Congelado no es lo mismo que cerrado. Un `done` sin archivar sí se valida:
es trabajo vivo pendiente de graduación o archive, y sus defectos son
arreglables. Un documento que declare `archived: true` con un status abierto
también se valida, porque esa combinación sólo puede venir de una edición a mano
y el gate la nombra en vez de esconderla; por la misma razón, un `archived` que
no sea el booleano `true` no congela nada. `checkUnclassifiedMentions` conserva
un predicado propio y más amplio, que exime también al `done` sin archivar.

Lo omitido se publica en ambas ramas del resumen, para que un hallazgo nunca
oculte lo que la corrida se saltó: `✓ N change(s) valid — M not validated
(archived or discarded)` y `E error(s), W warning(s) — N change(s), M not
validated (archived or discarded)`, con el sufijo ausente cuando no hay ninguno.
`check <id>` sobre un congelado responde `not validated (archived)` o
`not validated (discarded)` en vez de llamarlo válido. Un documento congelado
nunca es sujeto emisor de los invariantes de repo —`depends_on` y `related_to`
colgados, `related_to` a sí mismo y graduación a una spec inexistente— pero
sigue siendo dato: un abierto que lo referencia resuelve, y un abierto con
referencia colgada sigue en error. El predicado de congelado tiene una sola
sede (`frozenReason`), consumida por identidad de función.

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
