---
id: "20260730-183520"
title: "La cápsula del revisor obedece el mandato y el retry nombra la vuelta a in-review"
type: feature
status: done
created: 2026-07-30T18:35:20Z
depends_on: []
reviewed: true
related_to:
  - "20260704-144327"
  - "20260722-124656"
  - "20260729-162015"
  - "20260730-165310"
owner: raruiz-hiberuscom
---

## Request

Fusión autorizada por Roberto (2026-07-30) de los dos huecos que dejó el ciclo
de `20260730-165310`, ambos del mismo flujo de delegación de reviews:

1. **La cápsula de contexto del revisor ignora el mandato** (F1 del review de
   ese change). `agent-contexts/review.md` manda una checklist de auditoría
   completa incondicional, mientras el prompt ya entrega un mandato relleno:
   con mandato estrecho, el delegado recibe el límite en el prompt y la
   checklist completa en la cápsula que se le manda obedecer. El ahorro que
   motivó el mandato (una confirmación acotada costó ~62k frente a ~106k de la
   auditoría completa, y la confirmación acotada de ese mismo ciclo costó 98k
   frente a 107k — casi nada, porque la checklist seguía siendo completa) no se
   realiza hasta que la checklist sea condicional al mandato.
2. **Ningún fragmento nombra la vuelta a `in-review` para confirmar una
   corrección.** Tras `changeledger review <id> fail --retry` el change queda
   `in-progress`; el contrato manda que un revisor fresco confirme la
   corrección, pero `changeledger agent-context review` exige `in-review`
   (`role review requires change status in-review; got in-progress`) y el
   camino del retry no dice que haya que volver. Dos agentes orquestadores
   distintos cayeron en el hueco: el 2026-07-29 (H1 del ciclo de CH-15, el
   revisor cayó al bootstrap general) y el 2026-07-30 (reporte de Roberto: el
   revisor trabajó desde el diff y hubo que devolver el change a `in-review`
   solo para registrar el pass).

## Investigation

Investigación delegada fresca contra HEAD (2026-07-30), tokens con
`gpt-tokenizer/encoding/o200k_base` y líneas con `emittedLines`, ambos los que
pinnea `test/budget-support.mjs`.

- **La checklist incondicional son dos frases** de
  `templates/contract/agent-contexts/review.md` («Inspect the selected change,
  every `CRn`, every Plan task, tests, the actual diff and absence of
  TODO/FIXME, dead code or unrelated residue. Confirm tasks are true rather
  than merely checked off and that implementation did not drift from the
  authorized document.»), sin rama por mandato; la palabra `mandate` no
  aparece en el fichero (grep con cero hits). Ningún assert de
  `test/agent-context.test.mjs` pinnea la frase de la checklist: los que tocan
  la cápsula fijan sentinelas, autocontención, no-mutación, `read-only` y la
  receta de veredicto (`144327 CR7/CR8`, `201703 CR1/CR2`) — la edición no
  rompe ninguno.
- **Presupuesto de la cápsula, medido**: 280 tokens / 28 líneas contra el techo
  `agent` {1250, 125} — 970 tokens de holgura para la prosa condicional.
- **El camino del retry hoy**: `review.md` dice «After `fail --retry`, the
  correction remains uncommitted until another fresh reviewer passes it. After
  the transition, run `changeledger context <id>` before modifying
  implementation» — "the transition" es la que ya ocurrió (→ `in-progress`),
  no la vuelta. `implement.md` (sección *Correction isolation*) salta de «keep
  the candidate correction uncommitted» a «while a fresh clean-context
  reviewer checks it» sin nombrar transición alguna. Un grep de `in-review`
  cerca de `confirm|fresh|correction` sobre `templates/contract/` y
  `.changeledger/specs/` da cero hits: el hueco no está cubierto en ninguna
  sede.
- **El literal `changeledger status <id> in-review` aparece exactamente una
  vez** en el contrato: el paso 3 del gate ordenado de `implement.md`. El
  guard de concepto 8 (`002730 CR2`) lo busca con `indexOf` — primera
  ocurrencia — y exige que preceda al regex del formatter; añadir una segunda
  ocurrencia más abajo no lo altera. El guard 9 exige la cláusula
  «correction … uncommitted … fresh/reviewer» dentro de una frase — la
  inserción debe preservar esa frase intacta.
- **Presupuestos de los packs, verificados**: `base.review` 977/2500,
  `base.implement` **2343/2500 — 157 tokens de margen**. La frase nueva de
  `implement.md` debe ser una y económica; si el contenido correcto no cabe,
  se para y se pregunta.
- **Sede decidida en este draft** (tensión sin precedente que la investigación
  reporta): la frase del retry va en `implement.md`, donde ya vive la
  narración paso a paso del implementador y el único literal del comando;
  `.changeledger/specs/git-traceability.md` atribuye a review.md «qué ocurre
  con una corrección sin commitear según el veredicto» — no se contradice,
  porque la frase nueva no cambia qué ocurre con la corrección, añade el paso
  de status que faltaba. La graduación actualiza
  `.changeledger/specs/lifecycle.md`, cuyo diagrama solo tiene el arco
  `in_review --> in_progress: fail --retry` y no dibuja la vuelta.
- **Las tres formas del mandato, idénticas en las tres sedes** (cápsula de
  prompt, `review.md`, spec `lifecycle.md`): *a spot check of the named diff*,
  *the surface the change governs*, *a full audit*. La spec ya enuncia el
  default: sin mandato declarado, auditoría completa por construcción — la
  prosa condicional de la cápsula reutiliza ese default como regla fail-safe.
- Changes relacionados: `20260704-144327` (nacen las cápsulas),
  `20260722-124656` (el retorno sin veredicto, el otro camino de vuelta),
  `20260729-162015` (contrato de evidencia por rol), `20260730-165310` (el
  mandato; F1 y la segunda ocurrencia del hueco salen de su ciclo). Todos
  cerrados → `related_to`.

## Proposal

**Entregable A — checklist condicional al mandato.** Las dos frases de la
checklist en `agent-contexts/review.md` se reescriben condicionadas: el prompt
declara el mandato (las tres formas, con su redacción ya shipeada); bajo
auditoría completa —o sin mandato declarado, el default fail-safe que la spec
ya enuncia— aplica la checklist completa de hoy; bajo mandato más estrecho, la
inspección es el alcance declarado y lo notado fuera se reporta sin ampliar la
inspección. Se fija con asserts tolerantes nuevos en
`test/agent-context.test.mjs` (la condicionalidad y el default), sin tocar los
asserts existentes.

**Entregable B — el retry nombra la vuelta.** Una frase nueva en la sección
*Correction isolation* de `implement.md`, contigua a la cláusula del guard 9 y
sin editarla: la confirmación exige volver con `changeledger status <id>
in-review` antes de delegar al revisor fresco — la transición re-valida el
candidato y el rol de review solo carga ahí. Guard nuevo en
`DELEGATION_OBLIGATIONS` (doble evidencia fragmento + pack `implement`),
tolerante a redacción, con las dos mitades en ambas direcciones.

Alternativas descartadas:

- **La frase del retry en `review.md`**: tiene 1523 tokens de margen frente a
  157, pero la sede correcta es donde vive la narración del implementador y el
  literal del comando; el presupuesto no manda sobre la sede, y una frase cabe.
- **Arreglarlo en código** (relajar `ALLOWED_STATUSES` para que el rol review
  cargue en `in-progress`): destruiría la garantía que el gate compra — la
  transición a `in-review` re-valida el candidato y el rango del review se
  cierra al delegarlo; el defecto es de prosa, no del gate.
- **Un CR de presupuesto**: redundante con `assertWithinBudget` vivo (misma
  razón que en `20260730-165310`).

Escenarios: (1) confirmación de corrección con mandato *spot check* — el
delegado carga su cápsula (el change ya está en `in-review` porque el contrato
ahora lo nombra) y su checklist es el diff nombrado, no las seis dimensiones;
(2) review sin mandato en el prompt (consumidor que no rellenó el campo) — la
cápsula aplica auditoría completa por construcción; (3) orquestador tras
`fail --retry` — el camino del retry en `implement.md` le nombra la vuelta y
`agent-context review` carga a la primera.

## Specification

### CR1 — La checklist de la cápsula es condicional al mandato
- **Given** la cápsula compuesta por `buildAgentContext('review', <id en in-review>)`
- **When** el delegado la lee como su único contexto
- **Then** la checklist distingue por mandato: auditoría completa aplica la
  inspección completa vigente hoy; un mandato más estrecho inspecciona el
  alcance declarado y reporta lo notado fuera sin ampliar la inspección
- **And** asserts tolerantes nuevos en `test/agent-context.test.mjs` fijan la
  condicionalidad, y los asserts existentes sobre la cápsula (`144327
  CR7/CR8`, `201703 CR1/CR2`) siguen en verde sin editarse

### CR2 — Sin mandato declarado, la cápsula aplica auditoría completa
- **Given** la misma cápsula
- **When** el prompt recibido no declara mandato
- **Then** la cápsula enuncia el default fail-safe: sin mandato declarado, la
  inspección es la auditoría completa
- **And** un assert tolerante lo fija por separado de CR1, de modo que perder
  el default falla nombrándolo

### CR3 — El camino del retry nombra la vuelta a in-review
- **Given** el pack compuesto por `buildContext('implement', root)`
- **When** se lee la sección *Correction isolation*
- **Then** nombra que la confirmación de una corrección exige volver con
  `changeledger status <id> in-review` antes de delegar al revisor fresco
- **And** un guard nuevo en `DELEGATION_OBLIGATIONS` (fragmento
  `implement.md` + pack `implement`) lo fija con mitades bidireccionales, y
  los guards de concepto 8 y 9 siguen en verde: la primera ocurrencia del
  literal y la cláusula «correction … uncommitted … fresh» no se tocan

## Plan

- [x] Reescribir la checklist de la cápsula del revisor condicionada al
  mandato, con el default fail-safe, y fijarla con asserts tolerantes
  - **Target:** `templates/contract/agent-contexts/review.md`
  - **Verify:** `node --test test/agent-context.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-07-30T18:56:31Z`
- [x] Añadir la frase de la vuelta a in-review en Correction isolation y su
  guard de doble evidencia
  - **Target:** `templates/contract/implement.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-07-30T18:56:31Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T18:56:31Z`

## Log
- **2026-07-30T18:42:59Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T18:44:37Z** `[status]` approved → in-progress
- **2026-07-30T18:56:31Z** `[note]` Selección única resuelta. Rojo-verde literal por CR (los cuatro patrones de CR1 ejecutados individualmente contra la cápsula pre-edición: rojos los cuatro); 5 mutantes de uno en uno; la frase del retry costó 38 tokens (base.implement 2375/2500 medido como mide el gate). Decisiones no especificadas del implementador para escrutinio del review: sitio de la frase de CR3 (tras la cláusula del guard 9), la nota de re-validación y el 'loads nowhere else' incluidos (verificado contra ALLOWED_STATUSES), 'with that same rigour' en la rama de mandato estrecho, entrada nueva de DELEGATION_OBLIGATIONS en tercera posición, dos tests con helper compartido. Residual nombrado y no tocado: las tres formas del mandato viven ahora en cuatro sedes (cápsula de prompt, review.md, spec lifecycle, cápsula de contexto) — tensión de sede única para decisión posterior, la reutilización verbatim era instrucción del documento.
- **2026-07-30T18:57:00Z** `[status]` in-progress → in-review
- **2026-07-30T18:57:01Z** `[note]` Mandato del review, declarado antes de delegar: auditoría completa — primera review del change. Puntos de escrutinio: las 5 decisiones no especificadas de la nota anterior y el residual de las cuatro sedes.
- **2026-07-30T19:40:31Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T19:40:31Z** `[note]` Review PASS con mandato de auditoría completa, sin defectos. Deudas nombradas por el revisor, con sede: las tres formas del mandato viven en cuatro sedes sin test que las cruce (deriva independiente posible — candidata a follow-up si muerde); los fixtures nuevos reutilizan ids 120008/120009 de 201703 (convención de un id por fixture rota, inocuo con repos temporales); la mitad de orden del guard de CR3 no discrimina orden (techo de tolerancia inherente a las mitades bidireccionales autorizadas, probado con mutante de inversión); línea de 119 chars en implement.md (cosmética, sin formatter de md). En la graduación: el diagrama de lifecycle.md gana el arco de vuelta del retry.
- **2026-07-30T19:49:15Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T19:50:15Z** `[graduation]` spec: `lifecycle.md`
