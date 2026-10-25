---
title: Validación (changeledger check)
updated: 2026-10-25T23:13:38Z
tags: [ validation ]
graduated_from: ["20260616-151221", "20260616-162014", "20260616-162050", "20260616-162104", "20260703-150231", "20260711-103800", "20260726-194220", "20260729-162616", "20260824-134716", "20261002-113320", "20261018-131621", "20261019-184719", "20261023-181733"]
---

## Validación (`changeledger check`)

`checkRepo` no escribe nada ni carga el repo —su único subproceso es el
`check-ref-format` que valida el nombre de rama de cada change— y valida
changes y, en modo repo completo, también
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

El aviso de aceptación pendiente es la excepción deliberada a esa exención: sí
toma como sujeto a un archivado. En el caso para el que existe, el merge
aterriza después del archivo, así que el dato es nuevo y derivado de git en vez
de una reescritura de deliberación cerrada; y exceptuarlo dejaría el aviso
imposible de limpiar para siempre, que es justo el diagnóstico sin salida que
la doctrina de congelado existe para evitar.

Junto a ese núcleo puro viven las pasadas que sí tocan git: `pendingAcceptances`,
exportada como autoridad única que `sync` comparte para que aviso y sello no
diverjan, y la comprobación de configuración de `usage`.

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

Un documento vivo que declare un estado retirado del ciclo —`in-validation` o
`blocked`— recibe un error que nombra la edición que lo resuelve
(`status "in-validation" is retired: move it to "done" or "in-progress"`;
`status "blocked" is retired: move it to "in-progress" and record a [!] task`)
en lugar del diagnóstico genérico de estado desconocido. Sólo un documento vivo
puede ser sujeto de esa regla: el histórico congelado conserva sus estados y sus
entradas de Log sin recibir diagnóstico, así que el archivo sigue siendo válido
sin reescribir historia terminada.

Lo mismo vale para los tipos y las etapas retirados. Los tipos son dos, `change`
y `epic`, y las etapas cuatro, `request`, `specification`, `plan` y `log`, fijos
en código (`CHANGE_TYPES`, `CANONICAL_STAGES`, `src/change.mjs`); `check` no
exige ninguna etapa y ningún tipo activa una. Un documento vivo con un tipo retirado
(`RETIRED_TYPES`) recibe `type "<t>" is retired: set type to "change"`, y
cualquier otro tipo desconocido `unknown type "<t>"; valid types: change, epic`.
Una etapa desconocida recibe `unknown stage "## <k>"; valid stages: request,
specification, plan, log`, con la cola `— run \`changeledger fix\`` cuando es
una etapa retirada, `investigation` o `proposal` (`RETIRED_STAGES`), que `fix`
sabe plegar bajo el Request. Un `epic` que lleve `## Specification` o `## Plan`
recibe error: sus hijos llevan el trabajo. El histórico congelado conserva sus
tipos y etapas sin diagnóstico. En el frontmatter, `tdd` debe ser booleano y
`release_impact` uno de `none`, `patch`, `minor` o `major`; en un `epic`
cualquiera de los dos es un aviso, porque no tiene lector.

En la configuración, `checkConfig` reporta como error cada clave retirada
—`types`, `stages`, `release.impacts`, `readiness`— nombrando `changeledger
config migrate`, como el aviso de un esquema 6; un esquema anterior al 6 recibe
el aviso de migrarlo con ChangeLedger 0.19. `release.default_impact` se valida
contra los mismos cuatro impactos.

La validación también fija invariantes del formato Markdown que el parser expone:
headings de etapa con casing y orden canónicos, tareas `[x]` con un hijo
`Resolved` con timestamp ISO UTC, tareas `[!]` con un hijo `Blocked` con razón y
criterios `CRn` no duplicados. El parser de tareas (`src/task.mjs`) lee cada
traza de un hijo estructurado —`Target`, `Verify`, `Criteria`, `Support`, a lo
sumo uno de cada—, nunca de una posición, y una línea del Plan que no sabe
decidir se reporta en vez de descartarse.
El parser de etapas reconoce `##` solo fuera de fenced code blocks, por lo que
los ejemplos Markdown dentro de fences no crean etapas espurias ni duplicadas.

Un change `done` con tareas `[ ]` o `[!]` es inválido: `check` informa como
error el número de tareas incompletas. `checkSelectedChange` reutiliza exactamente
la validación scoped para evaluar tanto el archivo actual como un candidato aún
no escrito; sólo sus errores bloquean, no sus warnings ni hallazgos de otros
changes. La **puerta de entrega** aplica esa validación scoped en las dos sedes
que llevan a `done`: `changeledger review <id> pass` para un change en revisión y
`changeledger status <id> done` para un change cuya rama no toca código o un
`epic`, en ambos casos sobre el texto
ya volcado a `done`, porque las reglas que importan allí —tareas sin cerrar, un
Log que no reconstruye el frontmatter— sólo aplican a un change entregado.

Ninguna de esas dos sedes alcanza el documento editado a mano, que la spec de
arquitectura declara vía legítima y es la normal en los repos en layout de
worktree. Lo cubre una pasada propia de `check`: sobre un documento ya `done`,
una línea de Log `[status] in-review → done` —la forma sin veredicto, frente a
`[review]`— es error, y el mensaje nombra `changeledger review <id> pass`. Es
una pasada aparte y no un paso del replay, porque el replay abandona el
documento en el primer estado que no modela y eso la dejaría muerta justo en
los Log que vivieron la retirada. Y se limita a `done`, que es el único estado
donde el remedio que imprime se puede tomar. Los
modos de graduación validan después el `done` seleccionado antes de tocar change
o spec. Estas rutas resuelven y parsean únicamente el
archivo seleccionado; incluso un sibling ilegible queda fuera del gate scoped.

La entrada a `in-review` y la salida de `draft` usan la misma validación scoped
pero sobre el texto **previo** al cambio de status, y cada una añade su gate de
contenido. La aprobación exige un `## Request` con cuerpo que contenga
`### Objective` y `### Frontier`, cada una con cuerpo (`assertApprovable`):
`cannot approve: "## Request" is missing`, `… is empty`, `cannot approve:
"### Frontier" is missing` o `cannot approve: "### Objective", "### Frontier" are
empty`; ninguna otra etapa necesita cuerpo. La entrada a `in-review` exige
`## Specification` y `## Plan` presentes y con cuerpo, y al menos un `### CRn` en
la Specification (`assertReviewable`): `cannot request review: "## Specification"
is empty` o `cannot request review: "## Specification" declares no criterion`.
Un rechazo deja el documento byte a byte intacto.

Sobre un change `done` sin `accepted_at` cuya rama ya está fusionada en la rama
de integración, `check` emite un **aviso** —nunca un error— que nombra el change
y la aceptación pendiente, y no escribe nada: un merge sin graduar no es un
repositorio roto. El sellado tiene dos sedes —la graduación al cerrar y
`changeledger sync` para la rama que aterriza después—, y el aviso nombra a
`sync`, que es la que puede limpiarlo en cualquier caso, incluido un archivado.
Por eso resuelve el merge de cada `done` sin sellar, archivado o no, y no
exceptúa a los congelados.

Una tarea del Plan cuyo `Criteria` cita un `CRn` que `## Specification` no
declara es error en cualquier estado de un documento vivo, el draft incluido
(`Plan task references unknown criterion "<CRn>"`): una referencia rota, como una
etapa desconocida. `check` no juzga la forma Given/When/Then de los criterios ni
la cobertura del Plan, y el `tdd` efectivo no activa ni desactiva ningún
diagnóstico: sólo lo publica la línea `Effective policy:` de los contextos.

Las entradas superiores de Log que incumplen la gramática reciben un
diagnóstico con archivo, línea, forma canónica y los diez tipos válidos
(`LOG_EVENT_TYPES`). `fix` no repara el Log.

**Resoluciones de hallazgos.** Sobre el Log de un documento vivo, `check` lee los
hallazgos con la misma lectura que `finding` y `list` (`findingsInLog`,
`src/lifecycle.mjs`) y reporta como error cada resolución que no resuelve nada,
con su número de línea en el documento: la que nombra un ordinal que ninguna
línea anterior abrió (`Log line <n>: finding F<k> resolved but never recorded`)
y la que nombra uno ya resuelto (`Log line <n>: finding F<k> already resolved at
line <m>`). `finding` y `list` ignoran esas líneas; aquí son un Log que miente
sobre lo pendiente. Un hallazgo abierto nunca es diagnóstico.

**Normalización mecánica (`changeledger fix`).** `src/fix.mjs` es puro
(texto → fixes, sin IO). En las tareas del Plan repara solo defectos de formato
inequívocos: guión simple en lugar de raya en el sufijo de resolución (decidido
comparando la posición del último ` - ` contra el último ` — `, para no tocar
descripciones con rayas legítimas), timestamps casi-ISO y marcadores de checkbox
no canónicos. En un documento vivo (`frozenReason`), además, lleva el documento a
la forma de dos tipos y cuatro etapas (`repairLiveDocument`): un tipo retirado
pasa a `change`, conservando un comentario final, y el frontmatter recibe lo que
ese tipo implicaba —`release_impact`, `integrates_into: release`, `tdd: false`—
salvo lo que ya declare; el cuerpo de cada `## Investigation` o `## Proposal`
pasa bajo `## Request` como `### Investigation` o `### Proposal`, al final de su
contenido y en orden, con sus propios encabezados un nivel más abajo, y una
etapa retirada vacía desaparece. El histórico congelado sólo recibe las
reparaciones del Plan. Soporta `[id]` y `--dry-run`, sin otros modos, es
idempotente y deja lo ambiguo intacto, listándolo como `requires manual fix`: una
referencia a un CR inexistente, una línea `type:` que no sabe leer o una etapa
retirada sin `## Request` bajo la que moverse. `check` sugiere `changeledger fix`
cuando detecta defectos reparables del Plan (`hasFixableDefects`) y en el error
de una etapa retirada.
