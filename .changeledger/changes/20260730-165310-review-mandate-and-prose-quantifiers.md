---
id: "20260730-165310"
title: Mandato de review declarado y cuantificadores en prosa entregable
type: feature
status: done
created: 2026-07-30T16:53:10Z
depends_on: []
reviewed: true
related_to:
  - "20260704-144327"
  - "20260728-195445"
  - "20260728-212043"
  - "20260729-111349"
  - "20260729-162015"
  - "20260729-185200"
  - "20260729-203257"
  - "20260730-002730"
  - "20260730-002908"
owner: raruiz-hiberuscom
---

## Request

Dos obligaciones autorizadas por Roberto (2026-07-29/30), ambas del contrato de
delegación de reviews:

1. **El mandato del review se declara y se registra.** La cápsula
   `agent-prompt review` gana un campo de mandato que obliga al orquestador a
   declarar qué se revisa —spot check del diff nombrado, la superficie que el
   change gobierna, o auditoría completa— y el contrato obliga a registrar ese
   mandato como nota de Log del change antes de delegar. Hoy los placeholders de
   la cápsula (`reason`, `expected_output`, `difficulty_or_risk`, `integration`)
   no acotan qué se revisa, así que por construcción todo review es auditoría
   completa. Coste medido en la fase A: una ronda de confirmación con mandato
   mínimo costó ~62k tokens frente a ~106k de la completa, y encontró lo que
   tenía que encontrar.
2. **La obligación de cuantificadores cubre la prosa entregable.** La obligación
   que `20260729-185200` escribió para criterios («A criterion that quantifies
   universally … either covers its whole domain or narrows to what it
   verifies») se extiende a comentarios de test y notas de Log como obligación
   pass/fail del contrato de evidencia: el productor ejecuta el borde del
   cuantificador antes de escribirlo o estrecha la frase, y el revisor trata el
   absoluto sin borde ejecutado como defecto, no como estilo. Coste medido: 3 de
   las 4 rondas de retry de `20260729-203257` fueron absolutos encadenados en
   comentarios de test, y los 3 retries de `20260729-111349` fueron notas de Log
   afirmando mecanismos, conteos y barridos no medidos.

## Investigation

Investigación delegada fresca contra HEAD (2026-07-30), cifras medidas con
`gpt-tokenizer/encoding/o200k_base` (el pinneado por `test/budget-support.mjs`)
y `emittedLines` de `src/commands/context.mjs`; las portadoras re-verificadas
por el orquestador con grep antes de redactar.

- **El hueco es genuino.** Un grep de `mandate`, `spot check`, `audit` (como
  alcance), `what is reviewed` y `bounded` (sentido de alcance de review) sobre
  `templates/contract/` da cero sedes: ningún fragmento declara hoy un alcance
  de review ni obliga a registrar nada en el Log antes de delegar. Nada que
  retirar ni contradecir.
- **La sede de la obligación tiene que ser `review.md` o la cápsula.**
  `MODE_CONTEXT` en `src/commands/context.mjs` compone el modo review solo con
  `['review', 'handoff']`: una obligación escrita en `delegation.md` no llega al
  orquestador cuando carga `changeledger context review`.
- **Añadir el campo no exige código.** `buildAgentPrompt`
  (`src/commands/agent-prompt.mjs`) lee el `.md` verbatim y lo envuelve en
  sentinelas; no hay motor de placeholders — `{{mandate}}` es texto inerte que
  rellena el orquestador. El bucle CR3 de `test/agent-prompt.test.mjs` usa
  `assert.match` por placeholder, no enumeración exhaustiva, así que un campo
  nuevo no rompe tests existentes; fijar su presencia exige un assert nuevo.
- **El contrato de evidencia vive partido por rol** desde `20260729-162015` y
  `20260730-002908`: las cláusulas del implementador/corrector en
  `## Evidence obligations` de `implement.md` (8 bullets), las del revisor en
  `review.md` (4 bullets tras «The review prompt adds the evidence standard the
  capsule does not carry»). El guard de concepto 11 (`002730 CR2`,
  `CONCEPT_GUARDS` en `test/context.test.mjs`) exige `>= 8` cláusulas en
  implement, prohíbe que el pack de spec recupere el lead-in, y fija la cláusula
  del revisor por regex tolerante: añadir una novena cláusula y una nueva del
  revisor no lo rompe.
- **La obligación de criterios no se reescribe.** La frase de `spec.md` la
  vigila `185200 CR5` (`DRAFTING_OBLIGATIONS`) con regex anclada a
  `criteri\w+`: está scoped a criterios de aceptación a propósito. La extensión
  a prosa entregable es una obligación nueva en la sede de su audiencia, no un
  ensanche de esa frase.
- **Presupuestos, medidos el 2026-07-30**: cápsula `agent-prompts/review.md`
  398 tokens / 40 líneas contra techo `agent` {1250, 125}; `base.review` 860/80
  contra {2500, 250}; `base.implement` 2288/198 contra {2500, 250}. Holgura
  amplia para ambos entregables. `base.spec` está a 2397/239 — a 103 tokens del
  techo — y este change no toca sus fragmentos (`spec.md`, `delegation.md`,
  `readiness.md`).
- **La forma legal del registro existe.** La gramática del Log
  (`implement.md`) da el tipo `note`, escrito con `changeledger log <id>`,
  como el tipo para texto arbitrario que no puede simular un evento operativo.
  Esa prosa no tiene pin que re-anclar.
- Changes relacionados, clasificados: `20260704-144327` (nacen las cápsulas),
  `20260728-212043` (los techos que las acotan), `20260729-162015` (el contrato
  de evidencia por rol), `20260729-185200` (la obligación de cuantificadores
  para criterios), `20260730-002730` (el perímetro de guards vigente),
  `20260730-002908` (el reparto actual de fragmentos por pack). Todos cerrados:
  contexto útil sin orden de ejecución → `related_to`.

## Proposal

**Entregable A — mandato declarado y registrado.** La cápsula
`templates/contract/agent-prompts/review.md` gana un bloque de mandato con
placeholder `{{mandate}}` que exige elegir una de tres formas: *spot check of
the named diff*, *the surface the change governs*, *full audit*. El fragmento
`templates/contract/review.md` gana la obligación del orquestador: antes de
delegar un review se declara el mandato y se registra como nota de Log del
change, y el prompt del revisor lo lleva rellenado — el revisor inspecciona
dentro del mandato declarado y reporta lo que encuentre fuera de él sin
expandir su inspección.

**Entregable B — cuantificadores en prosa entregable.**
`## Evidence obligations` de `implement.md` gana una novena cláusula: la prosa
entregable —comentarios de test y notas de Log— que cuantifica universalmente
(*every*, *all*, *no*, *cannot*, *always*) ejecuta el borde que la falsaría
antes de escribirse, o se estrecha a la forma histórico-incidental de lo
observado. La lista del revisor en `review.md` gana su contraparte pass/fail:
un cuantificador universal en prosa entregable cuyo borde no fue ejecutado es
defecto que falla el review, no estilo.

El sitio de aserción de cada obligación de prosa es su guard de obligación
(regla de `docs/workflow-hardening.md` §13.3): guards tolerantes a redacción
con doble evidencia —fragmento y pack compuesto—, el patrón de `002730 CR2`.
La presencia del placeholder en la cápsula es composición estructural y se fija
con assert literal, el patrón del bucle CR3 de `test/agent-prompt.test.mjs`.

Alternativas descartadas:

- **Sede en `delegation.md`**: no llega al modo review (`MODE_CONTEXT.review`
  no lo compone) y sus packs anfitriones incluyen `base.spec`, que está a 103
  tokens de su techo.
- **Reescribir la frase de cuantificadores de `spec.md`**: su guard está
  anclado a criterios y su audiencia es el autor del draft; ensancharla
  conflaría dos obligaciones con audiencias y momentos distintos, y obligaría a
  re-anclar `185200 CR5`. Obligación nueva en la sede de su audiencia.
- **Un CR de presupuesto**: redundante — `assertWithinBudget` ya falla si la
  cápsula o un pack excede su techo; un criterio que lo repita no puede fallar
  por causa propia (la clase señalada en O1 del review de `20260728-195445`).

Escenarios: (1) el orquestador delega una confirmación de corrección → declara
*spot check of the named diff*, lo registra con `changeledger log`, y el
revisor no re-audita el change entero; (2) un implementador escribe «every raw
control byte» en un comentario de test sin ejecutar DEL 0x7f → el revisor lo
trata como defecto y el retry lo paga la corrección, no una ronda de
descubrimiento; (3) una nota de Log afirma «barrí la clase» sin método ni
límite → mismo tratamiento.

## Specification

### CR1 — La cápsula de review lleva el campo de mandato
- **Given** la cápsula compuesta por `buildAgentPrompt('review')`
- **When** el orquestador la usa como skeleton del prompt
- **Then** el cuerpo contiene un bloque de mandato con el placeholder
  `{{mandate}}` que nombra las tres formas legales — *spot check of the named
  diff*, *the surface the change governs*, *full audit* — como elección
  obligatoria
- **And** un assert nuevo en `test/agent-prompt.test.mjs` fija la presencia del
  placeholder y de las tres formas en la cápsula de review

### CR2 — El pack de review obliga a declarar y registrar el mandato
- **Given** el pack compuesto por `buildContext('review', root)`
- **When** el orquestador lo carga antes de delegar un review
- **Then** contiene la obligación de declarar el mandato del review y
  registrarlo como nota de Log del change antes de delegar
- **And** un guard tolerante a redacción con doble evidencia — fragmento
  `templates/contract/review.md` y pack compuesto — falla si la obligación
  desaparece de cualquiera de las dos sedes

### CR3 — El contrato de evidencia cubre los cuantificadores de la prosa entregable
- **Given** el pack compuesto por `buildContext('implement', root)`
- **When** se lee `## Evidence obligations`
- **Then** contiene una cláusula nueva: la prosa entregable — comentarios de
  test y notas de Log — que cuantifica universalmente ejecuta el borde que la
  falsaría antes de escribirse, o se estrecha a lo observado
- **And** el guard de concepto 11 (`002730 CR2`) sigue en verde con la cláusula
  añadida — su conteo exige `>= 8`, no exactamente 8 — y un guard tolerante con
  doble evidencia fija la cláusula nueva

### CR4 — El revisor aplica la regla como pass/fail
- **Given** el pack compuesto por `buildContext('review', root)`
- **When** se lee el estándar de evidencia que el prompt del review añade
- **Then** contiene la cláusula del revisor: un cuantificador universal en
  prosa entregable cuyo borde no fue ejecutado se trata como defecto que falla
  el review, no como estilo
- **And** un guard tolerante a redacción con doble evidencia fija la cláusula,
  y el guard de concepto 11 sigue en verde con la lista del revisor ampliada

## Plan

- [x] Añadir el bloque de mandato a la cápsula de review y fijar su presencia
  con un assert literal junto al bucle CR3 existente
  - **Target:** `templates/contract/agent-prompts/review.md`
  - **Verify:** `node --test test/agent-prompt.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-30T17:27:16Z`
- [x] Escribir en el fragmento de review la obligación de declarar y registrar
  el mandato, con su guard de doble evidencia
  - **Target:** `templates/contract/review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T17:27:16Z`
- [x] Extender el contrato de evidencia a la prosa entregable: cláusula del
  productor en implement, contraparte pass/fail del revisor en review, guards
  de ambas
  - **Target:** `templates/contract/implement.md`, `templates/contract/review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-30T17:27:16Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T17:27:16Z`

## Log
- **2026-07-30T17:06:23Z** `[status]` draft → approved
- **2026-07-30T17:08:05Z** `[status]` approved → in-progress
- **2026-07-30T17:27:29Z** `[note]` Selección única resuelta (las 3 tareas comparten review.md y context.test.mjs). Rojo-verde literal por CR; 8 mutantes de uno en uno más 3 de la corrección pre-review. Defecto cazado por el paso de auto-falsación del orquestador antes del in-review: el comentario del bloque DELEGATION_OBLIGATIONS afirmaba 'Every half is written in both directions' con el patrón 4 de CR2 unidireccional; corregido por el implementador vivo ensanchando el patrón (nunca debilitando la frase), con mutante de reword verde y delete rojo. Presupuestos medidos tras el cierre: cápsula review 448/1250 tokens, base.review 977/2500, base.implement 2343/2500. Cifras de la Investigation corregidas por el delegado: base.review era 866 (no 860) y base.implement 2294 (no 2288) en el baseline.
- **2026-07-30T17:27:39Z** `[note]` Mandato del review, declarado antes de delegar (estrena la obligación de este change): auditoría completa — primera review del change, sin review previa que acote. Puntos de escrutinio que recibirá el revisor: las 8 decisiones no especificadas que reportó el implementador (la sustantiva: la frase de inspección acotada vive en la cápsula Y en review.md, dos audiencias) y la corrección pre-review del orquestador descrita en la nota anterior.
- **2026-07-30T17:29:04Z** `[status]` in-progress → in-review
- **2026-07-30T17:43:47Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T17:43:47Z** `[note]` Review PASS con mandato de auditoría completa. Corrección a la nota de implementación (F3 del revisor): la razón 'las 3 tareas comparten review.md y context.test.mjs' era inexacta — la tarea 1 (cápsula + agent-prompt.test.mjs) no comparte esos ficheros; la selección única se sostiene por el acoplamiento de las tareas 2-3 y el techo de coordinación, no por ese solape. Hallazgos no bloqueantes del review, con sede: F1 (medium, follow-up) agent-contexts/review.md sigue mandando checklist de auditoría completa incondicional — el ahorro 62k/106k del mandato no se realiza hasta tocar esa sede, fuera del alcance autorizado de este change; F2 (low) la frase de inspección acotada de la cápsula no tiene guard propio (drift seam del arreglo de dos sedes); F4 (informational) las cifras 860/2288 del cuerpo de la Investigation quedan como estaban — la corrección vive en la nota de implementación y el documento es autoconsistente.
- **2026-07-30T17:58:48Z** `[validation]` in-validation → in-progress (human rejected via conversation): F2 del review se corrige dentro del change: la frase de inspección acotada de la cápsula quedó sin guard propio — decisión de Roberto de corregir aquí lo pendiente antes de aceptar
- **2026-07-30T18:01:51Z** `[status]` in-progress → in-review
- **2026-07-30T18:01:51Z** `[note]` Mandato del review de confirmación, declarado antes de delegar: spot check del diff nombrado — la corrección de F2 (un test nuevo en test/agent-prompt.test.mjs; la prosa de la cápsula debe estar byte-idéntica a 46294fda). Revisor fresco, modelo medio por alcance acotado.
- **2026-07-30T18:08:36Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T18:09:04Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T18:10:41Z** `[graduation]` spec: `lifecycle.md`
