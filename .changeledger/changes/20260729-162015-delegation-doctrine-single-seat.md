---
id: "20260729-162015"
title: "La doctrina de delegación tiene una sede: el core"
type: refactor
status: done
created: 2026-07-29T16:20:15Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260728-164620"]
owner: raruiz-hiberuscom
---

## Request

Fusión de CH-0b + CH-5b del acta, autorizada por Roberto el 2026-07-29 (CH-5a,
el mandato del review, queda aparte por el fallback también autorizado: su
superficie es la cápsula de prompt, disjunta de esta). Regla de Roberto, en sus
palabras: *"El core tiene todo el flujo general descrito, además es quien tiene
las políticas de commit y delegación, se debe evitar repetir esto en otros
lados, solo se puede ampliar y especificar algo puntual siempre y cuando no le
contradigan."*

Hechos verificados contra HEAD el 2026-07-29 (investigación delegada, cada cita
verbatim):

- `MODE_CONTEXT` en `src/commands/context.mjs` mete `delegation.md` en los
  packs `spec` e `implement`: la duplicación se paga en los dos.
- Tres doctrinas viven en dos sedes con palabras distintas: (a) dimensionar el
  delegado (core *"Size the delegate to the work…"* frente a `delegation.md`
  *"Use the strongest available models…"* bajo `## Size the model to the
  work`); (b) cuándo delegar (la tabla de propietarios del core frente a
  *"Delegate when it reduces main context pressure…"*); (c) un dueño por
  superficie (core *"One owner per write surface; concurrent subagents must not
  share files"* frente a *"Do not run parallel agents over the same files or
  conceptual surface…"*).
- Contenido único de `delegation.md` sin sede alternativa, que debe sobrevivir:
  el `## Delegation prompt contract` (los seis campos del prompt más la regla
  de codebase compartida), los disparadores por etapa (Request/Investigation,
  Proposal/Specification, Implementation con write sets disjuntos,
  Verification, review configurado como requisito de corrección), la guía de
  batch/script de `## Do not over-shard`, y la frase *"ChangeLedger is agnostic
  to how work is executed"*.
- `resolved selection of work` se usa **5 veces** (4 en `core.md`, 1 en
  `implement.md`; el acta decía 11 y está corregido allí) y **no está definido
  en ninguna parte** — hueco conocido que CH-21 dejó abierto y cuya definición
  el acta asigna a CH-5b.
- La regla de sede única existe solo en una dirección: core dice *"Every stage
  overlay is the authority for its stage; core never duplicates it"* (pinneado
  por `124835 CR2/CR3`); la inversa —el overlay no repite al core— no está
  escrita, y la clase 19/48 del acta apareció 6+ veces por eso.
- **Bloqueador duro nombrado**: el guard `234939 CR1-CR10` asserta hoy el
  reparto vigente — `match(fragments['delegation.md'], /Use the strongest
  available models for ambiguous scope/)` y `doesNotMatch(fragments['core.md'],
  /Size the model to the task's difficulty and risk/)`. Consolidar exige
  reescribir ese guard en la misma pasada, no es efecto colateral.
- El inventario de fragmentos está pinneado por `143656 CR4`: `delegation.md`
  no puede borrarse ni renombrarse sin tocar ese pin; este change lo conserva
  adelgazado, así que el pin no cambia.
- Ocupación medida hoy: core 203/400 líneas, spec 301/345 (andamio 3450 tokens
  con nota de salida), implement 191/250. El core tiene 197 líneas de margen
  para la definición y la regla inversa.

## Proposal

Tres movimientos, todos de prosa más sus guards:

1. **Desduplicar `delegation.md`**: retirar las tres doctrinas cuya sede es el
   core — la sección `## Size the model to the work` entera y las frases de
   cuándo-delegar y de superficies compartidas que el core ya posee — dejando
   solo el contenido único listado en el Request. El fragmento sigue existiendo
   y sigue sirviéndose en `spec` e `implement` (el inventario pinneado no
   cambia). El guard `234939 CR1-CR10` se reescribe para afirmar el reparto
   nuevo: core sede única de la doctrina transversal, `delegation.md` sede del
   contrato de prompt y los disparadores por etapa.
2. **Completar la regla de sede única en el core**, junto a la existente: el
   overlay amplía y especifica lo puntual de su etapa y nunca repite ni
   contradice al core. Y **definir `resolved selection` una sola vez, en el
   core**: la unidad de delegación medida por completitud y acoplamiento —
   tareas relacionadas viajan juntas al mismo delegado, las independientes
   solas o todas de una vez — que queda resuelta cuando su verificación local
   pasa, y se commitea al resolverse. Es la decisión de Roberto que CH-21
   recogió en los commits; aquí gana su definición. La frase *"A good
   delegation unit is a question, module…"* de `delegation.md` pasa a remitir a
   esa unidad en vez de insinuar una segunda definición.
3. **El contrato de evidencia de la delegación (CH-5b), mecanismo y no
   disciplina**, colocado por rol: en `delegation.md` (packs `spec` +
   `implement`) las cláusulas del prompt al implementador/corrector —
   disciplina de alcance como pass/fail incluyendo el arreglo silencioso de
   residuos conocidos, nombrar los residuos que no se tocan, reproducir el
   defecto original con salida literal antes de corregir, el test nuevo falla
   antes del fix, un mutante a la vez restaurado editando, cifras y punteros
   como dato a verificar, señalar instrucciones del orquestador que contradigan
   el contrato, y un cambio de tipo o alcance se reporta y se detiene. En
   `review.md` (pack `review`) las del revisor: marcar cada afirmación como
   confirmada ejecutándola o razonada desde el código, trazar todo helper
   llamado antes de reportar una validación ausente, recibir la lista de
   decisiones no especificadas del implementador como puntos de escrutinio, y
   las ediciones del orquestador se someten al mismo estándar que las del
   implementador.

Alternativas descartadas: borrar `delegation.md` y repartir su contenido único
entre overlays (rompe el pin de inventario sin necesidad y mezcla el contrato
de prompt con prosa de etapa); definir `resolved selection` en `delegation.md`
(el término vive en core/implement — segunda sede para una definición es la
clase 19/48 otra vez).

Fuera de alcance, nombrado: el techo andamio de `base.spec` (3450) **no baja
aquí** — su condición de salida es conjunta con CH-2 según §10 del acta; este
change registra el progreso en la nota del andamio sin tocar el número. CH-5a
(campo de alcance en la cápsula del review) queda como change propio.

## Specification

### CR1 — La doctrina transversal queda en una sede

- **Given** `templates/contract/delegation.md` tras la implementación
- **When** se buscan las tres doctrinas duplicadas: `Use the strongest
  available models for ambiguous scope`, la sección `## Size the model to the
  work`, y `parallel agents over the same files or conceptual surface`
- **Then** ninguna aparece en `delegation.md`; sus sedes en `core.md` (*"Size
  the delegate to the work"*, la tabla de propietarios, *"One owner per write
  surface"*) permanecen intactas, pinneadas por `124835 CR4/CR5`
- **And** el guard `234939 CR1-CR10` reescrito falla si la doctrina retirada
  reaparece en `delegation.md` (mutante temporal, restaurado editando)

### CR2 — El contenido único de `delegation.md` sobrevive

- **Given** el contenido sin sede alternativa listado en el Request
- **When** se grepea en `templates/contract/delegation.md`: `Delegation prompt
  contract`, `Do not create one subagent per file`, `write sets are disjoint`,
  `fresh clean-context subagent is a correctness requirement`, `agnostic to how
  work is executed`
- **Then** los cinco literales resuelven, y el pack `review` sigue sin
  contenerlos (guard vigente `225213 CR4/CR5/CR7`)

### CR3 — La regla de sede única tiene sus dos direcciones

- **Given** `templates/contract/core.md`
- **When** se lee la frase pinneada *"Every stage overlay is the authority for
  its stage; core never duplicates it"*
- **Then** la acompaña en el mismo párrafo la dirección inversa: el overlay
  amplía o especifica lo puntual de su etapa y nunca repite ni contradice al
  core; un test de `test/context.test.mjs` la asserta contra `core.md` y muere
  si se retira (mutante temporal, restaurado editando)

### CR4 — `resolved selection` queda definido una sola vez

- **Given** el término usado hoy 5 veces sin definición
- **When** se grepea `resolved selection` en `templates/contract/` tras la
  implementación
- **Then** exactamente una de las ocurrencias es una definición — en `core.md`,
  nombrando completitud y acoplamiento como medida, la verificación local como
  condición de resuelta y el commit al resolverse — y un test la asserta; las
  demás ocurrencias usan el término sin redefinirlo, y `delegation.md` remite a
  esa unidad sin definición propia

### CR5 — El contrato de evidencia existe por rol y en su pack

- **Given** los packs compuestos por `MODE_CONTEXT`
- **When** se capturan `context spec`, `context implement` y `context review`
- **Then** las cláusulas del implementador/corrector (alcance como pass/fail,
  residuos que no se tocan, reproducir antes de corregir, test en rojo antes
  del fix, un mutante a la vez, cifras como dato a verificar, señalar
  contradicciones, cambio de tipo o alcance se detiene) aparecen en `spec` e
  `implement` vía `delegation.md`; las del revisor (confirmado ejecutándolo o
  razonado desde el código, trazar todo helper llamado, decisiones no
  especificadas como puntos de escrutinio, el orquestador al mismo estándar)
  aparecen en `review` vía `review.md`; un guard por rol muere si su cláusula
  clave desaparece (mutantes temporales, restaurados editando)

### CR6 — Los packs de autoría adelgazan y nada revienta un techo

- **Given** las medidas de hoy: pack `spec` 301 líneas emitidas, pack
  `implement` 191, core 203/400
- **When** se leen las líneas BEGIN de `context spec`, `context implement` y
  `context` tras la implementación y corren los tests de presupuesto
- **Then** `spec` e `implement` emiten **menos líneas que hoy** (el neto de
  desduplicar supera al de las cláusulas añadidas, y si no es así el change se
  detiene y pregunta antes de recortar normativa), el core queda dentro de
  400/4000, y la nota de andamio de `base.spec` en
  `templates/contract/budgets.yml` registra la medida nueva sin cambiar el
  techo 3450 — su salida es conjunta con CH-2

## Plan

- [x] Desduplicar `templates/contract/delegation.md` (fuera `## Size the model to the work` y las frases de cuándo-delegar y superficies que el core posee) y reescribir el guard `234939 CR1-CR10` en `test/context.test.mjs` al reparto nuevo
  - **Verify:** `node --test test/context.test.mjs` con el mutante de reaparición en rojo
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-07-29T16:50:35Z`
- [x] Añadir en `templates/contract/core.md` la dirección inversa de la regla de sede única y la definición de `resolved selection`, con sus aserciones en `test/context.test.mjs`
  - **Verify:** `pnpm test` con ambos mutantes de retirada en rojo
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-29T16:50:35Z`
- [x] Escribir el contrato de evidencia por rol en `templates/contract/delegation.md` y `templates/contract/review.md` con un guard por rol en `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-29T16:50:35Z`
- [x] Medir los packs tras la edición, actualizar la nota de andamio de `base.spec` en `templates/contract/budgets.yml` sin tocar el techo, y comparar contra las medidas de hoy
  - **Verify:** `node bin/changeledger.mjs context spec 2>&1 | head -1` y `node bin/changeledger.mjs context implement 2>&1 | head -1` con menos líneas que 301/191
  - **Criteria:** CR6
  - **Resolved:** `2026-07-29T16:50:36Z`
- [x] Correr el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-29T16:50:36Z`

## Log

- **2026-07-29T16:24:00Z** `[note]` Documentado sobre investigación delegada contra HEAD del 2026-07-29, no sobre el acta: corrige dos hechos del acta (las ocurrencias de `resolved selection` son 5, no 11; existe el guard anti-duplicación `234939 CR1-CR10` que hoy asserta el reparto contrario y es bloqueador nombrado). CH-5a queda fuera por el fallback autorizado por Roberto: superficie disjunta (cápsula de prompt del review).
- **2026-07-29T16:33:17Z** `[status]` draft → approved
- **2026-07-29T16:35:12Z** `[status]` approved → in-progress
- **2026-07-29T16:35:12Z** `[note]` Implementación delegada en una sola pasada (las 4 tareas de prosa+guards son una selección: los tres fragmentos y sus guards comparten test/context.test.mjs; el gate cierra). Baseline 1daa9cdb, checkout principal. Modelo top-tier: prosa normativa transversal con riesgo de deformación de decisión — la frase literal de Roberto viaja en el prompt y el delegado verifica cláusula a cláusula que no añade cuantificadores.
- **2026-07-29T16:50:36Z** `[note]` Implementación entregada por delegado top-tier (114k tokens, 79 tool calls) y verificada por el orquestador: dedup ausente (grep=0), contenido único presente, definición única de selection en core (1 sede, 6 usos del término), regla inversa presente (envuelta entre líneas 5-7 — mi grep por línea la perdió y la confirmé leyendo el fichero), spec 301→299 líneas, implement 191→189, core 210/400. Gate del orquestador: pnpm verify EXIT=0, 951/951, lint limpio, check 0 errores. Auditoría de deformación cláusula a cláusula en el informe: cero cuantificadores añadidos (exactly one/never/always/only ausentes de la definición).
- **2026-07-29T16:50:36Z** `[note]` El Request nombró un bloqueador incompleto: además de 234939 CR1-CR10 había otros dos guards asertando el reparto viejo (234939 CR11-CR20 sobre el pack implement y 124835 CR11 sobre delegation.md). El delegado los reescribió dentro de su ownership y lo reportó como decisión no especificada. Dos ediciones suyas más para escrutinio del review: la frase de review.md 'owns the inspection checklist, read-only boundary and evidence contract' pasó a 'and return format' para no contradecir el estándar de evidencia nuevo (cero pins sobre la frase vieja, verificado por él); y la nota del andamio de budgets.yml registra ambas dimensiones (3140 tokens ↑ / 299 líneas ↓) para no desinformar. Restricción anotada para CH-2: el margen de los packs de autoría quedó en 2 líneas.
- **2026-07-29T16:50:46Z** `[status]` in-progress → in-review
- **2026-07-29T16:51:21Z** `[note]` Mandato del review, registrado antes de delegar: superficie que gobierna — el diff del commit 93b8b4f2 (fragmentos del contrato + guards), los seis criterios con re-derivación de mutantes, y escrutinio especial de deformación: comparar la definición de selection y las cláusulas de evidencia contra la frase literal de Roberto y contra el acta §CH-5b, buscando cuantificadores o cláusulas añadidas. Puntos de escrutinio: los dos guards extra reescritos, la frase reword de review.md, la nota bidimensional de budgets.yml. Revisor top-tier: prosa normativa, la clase de defecto que ninguna herramienta caza.
- **2026-07-29T17:04:20Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-29T17:04:21Z** `[note]` Review PASS top-tier (113k tokens): deformación auditada cláusula a cláusula contra la frase literal de Roberto — cero cuantificadores añadidos, las tres permisiones conservadas (grupo/todas/individuales), sin re-estrechamiento del dominio de commits; los dos guards extra verificados con protección antes/después (aserciones 430→440, la doctrina re-pinneada en su sede nueva, no borrada); los seis criterios re-derivados y los cinco mutantes muertos con mensaje literal. Cuatro hallazgos LOW registrados, ninguno defecto del contrato autorizado: F1 la mitad negativa del cuándo-delegar perdió sede (su efecto sigue alcanzable por tres vías; restaurarla cuesta ~2 líneas — decisión humana de alcance); F2 tres sub-obligaciones del acta comprimidas en mi Proposal (la sustantiva: el mutante debe fallar por la razón correcta); F3 la cláusula del revisor consume una lista que ninguna cláusula obliga al implementador a producir; F4 comentario rancio '3110 tokens' en test/context.test.mjs. El entregable NO se toca tras el PASS: F1-F4 propuestos como alcance de CH-5a, que posee la superficie de prompts y evidencia. Pendiente de decisión de Roberto en in-validation.
- **2026-07-29T18:06:11Z** `[validation]` in-validation → in-progress (human rejected via conversation): Decisión de Roberto: arreglar F1-F4 ahora en ronda de corrección, no diferir a CH-5a — restaurar la mitad negativa del cuándo-delegar, las tres sub-obligaciones comprimidas, la obligación productora de la lista de decisiones, y el comentario rancio
- **2026-07-29T18:18:50Z** `[note]` Corrección de F1-F4 entregada (110k tokens, 51 tool calls) y verificada por el orquestador: los cuatro literales presentes (grep=1 cada uno), cero '3110' residual, spec 300/345 e implement 190/250 — dentro de CR6 (<301/<191). Neto +1 línea: la fusión de los dos bullets de residuos (que el propio F1 pedía) pagó F1+F3. review.md no se tocó: la cláusula consumidora ya existía, solo faltaba la productora. 951/951, lint limpio. Los tres mutantes de la corrección con fallo literal contra los literales NUEVOS de los guards. Sin commitear a la espera del revisor de confirmación con mandato mínimo.
- **2026-07-29T18:18:50Z** `[status]` in-progress → in-review
- **2026-07-29T18:27:12Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-29T18:38:29Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-29T18:39:06Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-29T18:39:07Z** `[archive]` archived
