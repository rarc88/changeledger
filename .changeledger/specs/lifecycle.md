---
title: Ciclo de vida y gate de revisión
updated: 2026-07-18T12:33:08Z
tags: [ lifecycle ]
---

## Ciclo de vida y gate de revisión

> Graduado del change 20260614-165720 (revisión de graduación / reviewed).
> Graduado del change 20260614-182513 (owner desde GitHub login).
> Graduado del change 20260615-150510 (gate de revisión independiente + invariantes de transición).
> Graduado del change 20260615-170803 (graduación a spec existente, `changeledger graduate --into`).
> Graduado del change 20260615-210508 (estado terminal `discarded`).
> Graduado del change 20260616-212836 (ejemplos de graduación no crean enlaces reales).
> Graduado del change 20260616-212840 (captura automática de fricciones).
> Graduado del change 20260616-212319 (archivar no vuelve stale el spec).
> Graduado del change 20260616-212322 (archivado masivo de graduados).
> Graduado del change 20260626-160038 (política económica de delegación).
> Graduado del change 20260630-225210 (validación secuencial del Log).
> Actualizado por el change 20260703-150231 (integridad scoped de aceptación y graduación).
> Actualizado por el change 20260703-150232 (reapertura humana antes del cierre durable).
> Actualizado por el change 20260703-220014 (parada de validación local por change).
> Actualizado por el change 20260711-103756 (carril quick para trabajo pequeño trazable).
> Actualizado por el change 20260710-201703 (rol audit read-only en validación).
> Actualizado por el change 20260711-160446 (baseline declarado y verificado en delegaciones que escriben).

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> approved: humano aprueba (viewer o conversación)
    approved --> in_progress
    in_progress --> in_review: review_required
    in_progress --> in_validation: si NO review_required
    in_progress --> blocked
    in_review --> in_validation: review pass
    in_review --> in_progress: fail --retry
    in_review --> blocked: fail --block
    in_validation --> done: humano acepta (viewer o conversación)
    in_validation --> in_progress: agente o humano rechaza con motivo
    done --> in_progress: agente o humano reabre antes del cierre durable
    blocked --> in_progress
    draft --> discarded: changeledger discard "razón"
    approved --> discarded
    in_progress --> discarded
    blocked --> discarded
    done --> [*]
    discarded --> [*]
```

**Descartar.** `discarded` es un estado **terminal** alternativo a `done`: el
change se decidió no hacer. Se alcanza desde cualquier estado activo no terminal
(`draft`, `approved`, `in-progress`, `blocked`) con `changeledger discard <id> "<razón>"`
—la razón es obligatoria y se registra en el Log—. Preferirlo a borrar el
archivo: la decisión y su porqué siguen siendo verdad, y las referencias
`depends_on` se mantienen resolubles. El visor lo oculta por defecto (toggle
"Discarded") y nunca le da columna. `changeledger status` rechaza `discarded` para forzar
el verbo con razón; tampoco es alcanzable desde el visor.

El gate opcional **`in-review`** cierra el lazo doc↔código para los tipos que
requieren una **revisión independiente**. La revisión la
ejecuta un **subagente con contexto limpio** (sin el historial de implementación,
para no heredar sesgo) y un **modelo acorde a la dificultad**. *Qué* valida:
cada `CRn` cumplido, sin residuo y Plan realmente hecho. La
auditoría profunda de seguridad/lint/SAST queda en herramientas dedicadas que el
revisor puede invocar; ChangeLedger no las reimplementa. El *cómo* se lanza el
subagente es del agente anfitrión — `changeledger context review` solo fija el qué.

El estado revisado es el estado entregable: tras mover a `in-review`, el agente
anfitrión aplica el formatter local y ejecuta los gates completos antes de
delegar. Como el veredicto vuelve a mutar status y Log, antes del commit o del
handoff reaplica el formatter y repite los checks afectados, incluido
`changeledger check`. Los tipos sin review hacen lo mismo después de su
transición directa a `in-validation`. El núcleo no ejecuta hooks, formatters ni
comandos externos configurables como efecto lateral; esos gates pertenecen al
repositorio anfitrión.

**Auditoría post-review.** Un change en `in-validation` admite una inspección
delegada estrictamente read-only: `changeledger agent-context audit <id>` entrega
una cápsula autocontenida con el change, sus criterios y una frontera explícita
de no mutación (archivos, Git, ledger). El delegado devuelve hallazgos y
evidencia, nunca un veredicto que mueva el lifecycle, y la operación no cambia el
status ni añade entradas al Log. El contexto `review` conserva su restricción a
`in-review` y su receta de veredicto única.

El contrato canónico permite delegar cualquier etapa a subagentes cuando reduce
presión de contexto, baja coste con un modelo suficiente, paraleliza trabajo
realmente independiente o aporta revisión de contexto limpio. La delegación no es
un requisito universal ni un mecanismo prescrito por ChangeLedger: el agente
principal decide según el harness disponible. Sí es una decisión auditable: cada
delegación debe tener motivo, ownership o pregunta clara, salida esperada y
criterio de integración; los roles que escriben declaran además el baseline
esperado (rama o commit) que el delegado verifica antes de tocar su worktree. El contrato desaconseja sobrefragmentar (por archivo,
por línea o por edición mecánica diminuta), exige disjunción para trabajo en
paralelo y pide ajustar el modelo a la dificultad: modelos fuertes para
ambigüedad, arquitectura, seguridad o revisiones difíciles; modelos suficientes y
baratos para exploración localizada, inventarios, edición mecánica, tests y
verificaciones acotadas.

**Activación por tipo.** `config.yml` marca `review_required: true` por tipo
(`feature`, `bug`, `refactor` por defecto). `chore`, `audit` y `quick` saltan
únicamente la revisión: van `in-progress → in-validation`. Todo tipo pasa por
validación humana antes de `done`; así `done` siempre significa resultado
aceptado.

**Carril `quick`.** Tipo oficial para trabajo pequeño trazable que antes acababa
en bypass silencioso: un solo concern, reversible, sin ampliar superficie
pública ni verdad persistente (`specs/`). Stages activos solo `## Request` y
`## Log` (documento objetivo ~10-15 líneas), sin Specification, Plan ni review
gate, pero con el ciclo corto completo (`draft → approved` humano →
`in-progress → in-validation → done`) y las mismas reglas de rama y marcador
`[#id]`. Si el alcance crece durante la ejecución, se descarta y se recrea con
el tipo correcto. Su graduación es siempre `--skip`: por elegibilidad no
produce verdad persistente.

**Ownership operacional.** El core compuesto publica una única matriz de
transición → propietario → mecanismo. Distingue las decisiones humanas
(`draft → approved`, aceptación en `in-validation`), los movimientos del
agente, los tres veredictos que registra el orquestador mediante
`changeledger review`, y el descarte con razón; evita que esa autoridad se
infiera de prosa o de un diagrama paralelo.

Las decisiones human-owned admiten dos superficies confiadas: el viewer y una
instrucción explícita en la conversación activa que identifique inequívocamente
el change y el veredicto. El agente transmite esta última con `changeledger
approve <id>`, `changeledger validation <id> pass` o, para rechazo con razón,
`changeledger validation <id> fail --human "<razón>"`. Elogios, “continúa”,
silencio o una recomendación del agente no autorizan estos comandos. No se
persisten conversaciones ni se añaden tokens de confirmación.

**Invariantes de transición.** El grafo del ciclo vive en `src/lifecycle.mjs` y
es la **única autoridad**, compartida por `changeledger status` y el visor.
`lifecycle.assertTransition(from, to, { type, reviewRequired })` valida el grafo
completo (no solo el gate) y `agent.status()` lo invoca antes de escribir, así que
el CLI rechaza saltos, regresiones y no-ops
(`change is already "X"`), y el gate (`in-progress → in-validation` bajo
`review_required` → mensaje accionable). Entre statuses no canónicos degrada a
validación por enum. `changeledger status done` se rechaza por separado porque solo el
veredicto humano puede cerrar. `discarded` es terminal. `done` puede volver a
`in-progress` por acción humana o del agente con motivo mientras siga sin
graduación/skip, sin archive y fuera de releases; `reviewed: true` también cierra
esa ventana. Después de cualquiera de esas fronteras no se reabre. El
visor añade la política de actor: permite `draft → approved`, `in-validation →
done|in-progress` y la reapertura elegible `done → in-progress`; rechazo y
reapertura exigen motivo. El CLI permite al agente rechazar con `changeledger
validation <id> fail "<razón>"` y reabrir con `changeledger reopen <id>
"<razón>"`; los verbos conversacionales positivos y `--human` solo transmiten
una decisión humana explícita y reutilizan los mismos guards del viewer.
Antes de aceptar, construye en memoria la única transición `validation → done
(human accepted)` y ejecuta el check scoped. Tareas incompletas o cualquier
inconsistencia del Log rechazan la operación antes de escribir, conservando el
archivo en `in-validation`; warnings del seleccionado y errores ajenos no
bloquean.

El Log distingue el canal conversacional con `status: draft → approved (human
via conversation)`, `validation → done (human accepted via conversation)` y
`validation → in-progress (human rejected via conversation): <reason>`. El
viewer conserva sus eventos históricos sin el sufijo de canal y el rechazo
agent-owned conserva `(agent rejected)`.

**Reapertura provisional.** El viewer ofrece `Reopen` sólo en `done`; exige una
razón y registra `status: done → in-progress (human reopened): <reason>`. El
comando del agente registra `agent reopened` con las mismas fronteras. El change
repite review cuando corresponde y siempre validación humana. La acción
sirve para completar o corregir el alcance original; cualquier expansión
observable requiere un change nuevo. `reviewed: true`, una marca real de
graduación/skip, `archived: true` o pertenencia a un release registrado son
fronteras irreversibles comprobadas antes de escribir.
La comprobación de releases y la mutación comparten el lock de historial de
releases; así ningún manifest puede incorporar el `done` entre el preflight y la
escritura de la reapertura.

**Veredicto (`changeledger review`, en `agent.review()`).** `pass` → `in-validation`;
`fail --retry`
→ `in-progress` (defecto dentro del contrato, el implementador corrige);
`fail --block` → `blocked` (excede el contrato, decide el humano). Exige estar en
`in-review`, `fail` exige motivo, y cada veredicto deja un marker inglés en el Log
(`review → …`). `in-review` e `in-validation` cuentan como WIP en métricas.

**Parada de validación local.** `in-validation` detiene solo ese change: el
humano decide, el agente nunca acepta en su nombre. No es una pausa global de
la cola. El agente puede empezar el siguiente change `approved` cuya cadena
`depends_on`, directa o transitiva, no llegue a ese ni a ningún otro change en
`in-validation`; `changeledger context <id>` ya resuelve el status de cada
dependencia directa en una línea, así que la cadena transitiva se recorre
consultándola de un salto en otro sin un comando nuevo. Si la dependencia
bloqueante existe, el agente la nombra y no empieza ese candidato. Si todos los
`approved` restantes están bloqueados así, el agente se detiene por completo:
no inventa trabajo ni toca los resultados ya entregados mientras espera. El
change seleccionado sigue las reglas normales de rama, baseline, commits y
aislamiento de correcciones; solo uno está en implementación activa por
worktree, aunque otro ya entregado siga esperando validación humana.

**Triage de fricción y autorización.** Antes de entregar al humano un resultado
completado o bloqueado, el agente clasifica la fricción ya descubierta. Si es
necesaria para cumplir el objetivo autorizado de un change activo, la incorpora
a su Specification/Plan/Log. Si amplía materialmente el comportamiento observable,
aunque esté relacionada, pide autorización antes de incorporarla. Si es un paso
operativo (verificar, commitear, graduar, archivar o cerrar), lo ejecuta o registra
allí: no crea un chore. Si es independiente, propone al humano tipo, título y
motivo y espera autorización antes de crear el `draft`. Lo demasiado vago se
menciona sin crear archivos. Al alcanzar `done`, comparte además una retrospectiva
breve del ciclo; `discarded` no implica un ciclo de implementación completado.

**Fronteras de commit.** Git conserva evidencia significativa y el Log conserva
la granularidad temporal. Al iniciar, `approved → in-progress` se commitea como
baseline con el documento aprobado antes del código. Cada unidad de
implementación agrupa código, tests y verdad del ledger relacionada; la
transición a `in-review` puede acompañar la última unidad. Un movimiento que solo
cambia status y Log no exige commit propio: se agrupa con el commit sustantivo
más cercano. Tras aceptación, `done`, graduación o skip y la edición durable de
spec forman un único commit final de cierre. Un handoff real entre sesión,
agente o worktree puede persistir todo el estado pendiente en un único
checkpoint justificado, nunca en un commit por transición. Las correcciones no
confirmadas tras review o rechazo humano conservan las reglas de aislamiento del
worktree hasta superar su gate.

## Intención y ejecución

El contrato separa intención y ejecución. Antes de crear un change permite
conversación e investigación de solo lectura, pero exige conjuntamente claridad
suficiente y autorización humana explícita; una petición directa de creación ya
autoriza, sin permitir que el agente invente requisitos faltantes. El humano
autoriza alcance, aprueba drafts y acepta resultados; el agente divide y ejecuta
el trabajo dentro de ese alcance.

## Log y owner

El `## Log` es el **ledger del ciclo de vida**, ortogonal a las etapas de
contenido del tipo: registra cada transición de `status` con su timestamp y se
crea automáticamente al primer cambio de estado aunque el tipo no lo declare
(p.ej. `chore`).

**Validación secuencial.** `changeledger check` reproduce los eventos del Log
desde `draft` contra el grafo de `src/lifecycle.mjs` mediante el parser
compartido `parseLogEvent` (líneas `status: from → to` con origen explícito;
`review → …` y `validation → …` con origen implícito `in-review`/`in-validation`).
Son **errores**: una transición cuyo origen no coincide con el estado
reconstruido (p.ej. un veredicto `review → in-validation` duplicado), self-loops,
aristas fuera del grafo y un `status` final incompatible con la secuencia. Dos
compatibilidades **acotadas** mantienen legible el historial anterior al gate
universal sin relajar el grafo para trabajo nuevo: las aristas legacy literales
(`in-review → done`, `in-progress → done`, `draft → in-progress`) y el *resync*
de huecos tempranos — solo un origen explícito `status:` puede adelantar la
reconstrucción, solo hacia delante y solo entre `draft`/`approved`/`in-progress`;
los orígenes implícitos de review/validation exigen siempre la secuencia exacta.
Statuses no canónicos desactivan la validación del change (el grafo no modela
esos estados). El `owner` se autoasigna al pasar a `in-progress` (cuando empieza
el trabajo) vía `ownerHandle`: username de GitHub (`gh api user --jq .login`), con
fallback a `git config user.name` si `gh` falta o no está autenticado; tolerante
(vacío si ninguno). No pisa un owner fijado a mano (`changeledger owner`).

## Graduación

**Revisión de graduación.** Tras `done`, cada change se resuelve: gradúa a un spec
o registra un skip (bug/chore sin verdad persistente). La finalización con
`--into` y el skip fijan `reviewed: true` (`writer.setReviewed`);
`changeledger list --pending graduation` lista los `done` con `reviewed !==
true`. `changeledger graduate <id> --skip [razón]`
(`skipGraduation`, solo en `done`) deja `graduation skipped` en el Log sin crear
una spec. "Graduado a spec" sigue siendo derivable de la marca `graduado a spec`
del Log — `reviewed` solo registra que la pregunta quedó zanjada. `check` valida
que `reviewed`, si está, sea booleano; no avisa de pendientes (es bajo demanda).
Los tres modos que escriben (`--new`, `--into`, `--skip`) ejecutan primero el
mismo check scoped del change `done`. Si existen tareas incompletas o errores de
secuencia/formato, fallan antes de crear una spec, refrescar `updated`, añadir el
marker de graduación o fijar `reviewed: true`.

`changeledger list --pending archive [--owner NAME|--unowned]` previsualiza los
changes `done`, `reviewed: true`, no archivados y con resolución de graduación en
`## Log` (`graduado a spec` o `graduation skipped`). `changeledger archive
--graduated` acepta el mismo filtro opcional y archiva exactamente el conjunto
previsualizado; sin filtro conserva el alcance global. Escribe `archived: true`
más una entrada `archived` en el Log y no toca estados activos, bloqueados,
descartados, changes sin reviewed ni changes ya archivados. Una graduación
múltiple se acota con `list --pending graduation --owner NAME`, pero cada id se
resuelve individualmente con `--new`, `--into` o `--skip`.

La intención es siempre explícita y los modos `--new`, `--into` y `--skip` son
mutuamente excluyentes. Un slug posicional sin modo falla sin
escribir, por lo que `skip` o `skip-*` nunca pueden convertirse accidentalmente
en nombres de spec.

Para una spec nueva, `--new` llama a `scaffoldSpec()`: crea una semilla desde
Specification/Proposal con un marcador explícito de scaffold, pero no escribe el
Log ni fija `reviewed`; el change continúa pendiente. El agente reemplaza la
semilla por verdad actual durable y elimina el marcador. Después `--into`
(`graduate(..., { into: true })`) exige que la spec exista y que el marcador ya
no esté, refresca `updated` (`writer.setSpecUpdated`), deja intacto el cuerpo y
registra el vínculo más `reviewed: true`. Para una spec ya existente, el agente
edita primero su cuerpo y usa directamente `--into`.
