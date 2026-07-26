---
id: "20260726-141121"
title: Componer el contexto según el tipo, no solo el status
type: bug
status: done
created: 2026-07-26T14:11:21Z
depends_on: ["20260726-141119"]
reviewed: true
related_to: ["20260726-141120"]
owner: raruiz-hiberuscom
---

## Request

`changeledger context <change-id>` compone los fragmentos del contrato
únicamente a partir del `status` del cambio. El `type` nunca participa en esa
decisión. Como consecuencia, un cambio recibe reglas normativas que su tipo no
puede satisfacer estructuralmente: por ejemplo, un `chore` o un `quick` en
`draft` recibe el fragmento `readiness` (`# Definition of Ready`), que exige
bloques `CRn` bajo `## Specification` y tareas de Plan que los citen — pero
`chore` y `quick` no activan la stage `specification` en absoluto
(`.changeledger/config.yml`). Un agente que obedece el fragmento recibido
produce un documento que `changeledger check` rechaza.

## Investigation

Cadena de evidencia (todas las líneas verificadas de nuevo sobre el código
actual):

- `src/commands/context.mjs:17-26` — `STATUS_CONTEXT` mapea cada `status` a un
  modo y a una lista fija de fragmentos; `draft` siempre resuelve a
  `MODE_CONTEXT.spec`, es decir `['spec', 'delegation', 'readiness']` (línea
  14). La resolución no consulta `type` en ningún punto.
- `src/commands/context.mjs:184-201` (`composeInput`) — sí lee `type` del
  frontmatter y lo usa para `changePolicyBlock` (la línea
  `Active stages(<type>)=...`), pero no lo usa para filtrar qué fragmentos se
  incluyen. `selected.fragments` viaja intacto desde `STATUS_CONTEXT`.
- `templates/contract/readiness.md:11-23` — la Definición de Ready ("Definition
  of Ready") exige que "every behavioral requirement is a `CRn`" y que "every
  implementation task cites at least one CR", es decir, presupone que el
  cambio tiene stages `specification` y `plan` con ese contenido.
- `.changeledger/config.yml:65-83` — la matriz de stages activas por tipo
  confirma que `audit` (`request, investigation, log`), `chore` (`request,
  plan`) y `quick` (`request, log`) no activan `specification`.

  Corrección fechada el 2026-07-26, posterior a la aprobación de este
  documento: `20260726-141119` activó `specification` para `refactor`, que pasó
  a `request, proposal, specification, plan, log`. La evidencia original
  contaba `refactor` entre los tipos sin la stage y ya no lo está, así que CR2,
  CR3 y la primera tarea del Plan se reescribieron para repartir los tipos
  según la config real. La regla a implementar no cambia: se deriva de la
  config, nunca de una lista de tipos escrita a mano.
- `src/check.mjs:503` (`checkCoverage`) — `if (!active?.includes('specification'))
  return;` corta toda la validación de cobertura/readiness para esos tres
  tipos: las reglas del fragmento no solo quedan sin cumplir, son
  estructuralmente inaplicables.
- `src/check.mjs:83-85` — si, pese a eso, el documento adopta una `##
  Specification` (por seguir el fragmento), `check` la rechaza con `stage "##
  specification" is not active for type <t>`.

Consecuencia observada reproducida directamente contra este repo
(`buildContext(id, root)` con un cambio `draft` de cada tipo): el bloque de
política imprime, por ejemplo, `Active stages(chore)=request, plan` o
`Active stages(quick)=request, log` — sin `specification` — mientras el cuerpo
compuesto contiene íntegro el fragmento `# Definition of Ready`. Ambas
afirmaciones se contradicen dentro de la misma captura.

Se verificó cuáles de los tres fragmentos del modo `spec`
(`spec`, `delegation`, `readiness`) dependen de que el tipo active
`specification`:

- `templates/contract/spec.md` (fragmento `spec`) describe la matriz de
  activación completa y dice explícitamente "only when activated for the type
  in `config.yml`" — es genérico y correcto para cualquier tipo.
- `templates/contract/delegation.md` (fragmento `delegation`) menciona
  "Proposal and Specification may use stronger reasoning..." solo como
  observación descriptiva de estrategia de delegación, no como obligación de
  que el cambio actual tenga esas stages.
- `templates/contract/readiness.md` (fragmento `readiness`) es el único de los
  tres cuyo contenido íntegro presupone `specification`/`plan`.

Por tanto solo `readiness` está mal condicionado; `spec` y `delegation` no
necesitan filtrado.

Raíz compartida con `#20260726-141119`: en ambos defectos, `specification`
resulta "load-bearing" para la verificación (`src/check.mjs:503`) sin que la
composición de contexto ni el schema lo reflejen. `#20260726-141119` cubre el
acoplamiento `review_required`/schema; este cambio cubre exclusivamente la
composición de `changeledger context`. No se duplica su alcance.

## Specification

### CR1 — El fragmento `readiness` se mantiene para tipos que activan `specification`
- **Given** un cambio en `draft` de tipo `bug` (activa `specification` según `.changeledger/config.yml`)
- **When** se ejecuta `changeledger context <id>`
- **Then** la salida contiene los encabezados `# Authoring a Change`, `# Economical Delegation` y `# Definition of Ready`
- **And** la línea de política contiene exactamente `Active stages(bug)=request, investigation, specification, plan, log`

### CR2 — El fragmento `readiness` se omite para tipos que no activan `specification`
- **Given** tres cambios en `draft`, uno por cada tipo `audit`, `chore` y `quick` (ninguno activa `specification`)
- **When** se ejecuta `changeledger context <id>` sobre cada uno
- **Then** ninguna de las tres salidas contiene el encabezado `# Definition of Ready`
- **And** las tres siguen conteniendo `# Authoring a Change` y `# Economical Delegation`
- **And** la línea `Active stages(<type>)=` de cada salida nunca contiene la palabra `specification`, de modo que política y fragmentos presentes dejan de contradecirse

### CR3 — La composición de los tipos que activan `specification` no cambia
- **Given** cambios en `draft` de tipo `feature`, de tipo `bug` y de tipo `refactor`, los tres con `specification` entre sus stages activas
- **When** se ejecuta `changeledger context <id>` sobre cada uno antes y después del fix
- **Then** el conjunto y el orden de encabezados de fragmento compuestos es idéntico en los tres: `# Authoring a Change`, `# Economical Delegation`, `# Definition of Ready`

### CR4 — El presupuesto de contexto del modo `spec` sin cambio sigue vigente
- **Given** ninguna invocación con id de cambio (modo `spec` desnudo)
- **When** se ejecuta `changeledger context spec`
- **Then** la salida permanece dentro de los límites `target`/`hard` de `templates/contract/budgets.yml` (`base.spec`: 280/12000 líneas objetivo, 310/13500 líneas máximas), sin verse afectada por el filtrado por tipo (esa invocación no resuelve ningún `type`)

## Plan

- [x] Añadir en `test/context.test.mjs` los tests (fallando) del CR2 contra la composición actual de `src/commands/context.mjs`: un `draft` de cada tipo `audit`, `chore` y `quick` compuesto vía `buildContext` no debe contener `# Definition of Ready`, debe seguir conteniendo `# Authoring a Change` y `# Economical Delegation`, y su línea `Active stages(<type>)=` no debe contener `specification`; verify: `node --test test/context.test.mjs` (CR2)
  - **Resolved:** `2026-07-26T23:10:50Z`
- [x] En `src/commands/context.mjs`, dentro de `composeInput`, excluir el fragmento `readiness` del conjunto compuesto cuando `config.types[type].stages` no incluya `'specification'`, dejando sin cambios la composición de todo tipo que sí la active; verify: `node --test test/context.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-26T23:10:50Z`
- [x] Añadir en `test/context.test.mjs` los tests de regresión sobre `src/commands/context.mjs` del CR3: un `draft` de tipo `feature`, otro de tipo `bug` y otro de tipo `refactor` siguen componiendo los tres encabezados de fragmento sin cambios; verify: `node --test test/context.test.mjs` (CR3)
  - **Resolved:** `2026-07-26T23:10:50Z`
- [x] Añadir en `test/context.test.mjs` el test de regresión del CR4: la composición desnuda `changeledger context spec` (sin id de cambio) sigue dentro de los límites de `templates/contract/budgets.yml` `base.spec`; verify: `node --test test/context.test.mjs` (CR4)
  - **Resolved:** `2026-07-26T23:10:51Z`
- [x] Ejecutar la suite completa y el gate de calidad; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-26T23:10:51Z`

## Log
- **2026-07-26T15:05:06Z** `[status]` draft → approved
- **2026-07-26T23:04:22Z** `[status]` approved → in-progress
- **2026-07-26T23:10:58Z** `[note]` composeInput filtra readiness derivando las stages activas del tipo desde config; sin lista de tipos hardcodeada. CR2 rojo primero; CR3 y CR4 son guardas de regresion verificadas con mutantes aislados. Ningun presupuesto de budgets.yml cubre composiciones con id en draft, asi que no cambia ninguno.
- **2026-07-26T23:12:56Z** `[note]` Las cuatro tareas de test comparten test/context.test.mjs y la tarea 1 es roja hasta que aterriza la 2, asi que las cinco van en un commit combinado con este registro, segun el criterio acordado de que tareas relacionadas pueden compartir commit
- **2026-07-26T23:13:24Z** `[status]` in-progress → in-review
- **2026-07-26T23:25:14Z** `[note]` Mandato de review dimensionado como revision completa del diff mas la superficie que gobierna (todos los caminos de composicion de fragmentos), no auditoria repo-wide, con disciplina de alcance como condicion de pass/fail
- **2026-07-26T23:25:14Z** `[review]` in-review → in-progress (retry): La realineacion de tipos dejo sin corregir la tarea 2 del Plan, que sigue diciendo 'dejando feature y bug sin cambios' cuando refactor tambien queda sin cambios: es la misma enumeracion caduca que el primer commit existia para eliminar
- **2026-07-26T23:25:29Z** `[status]` in-progress → in-review
- **2026-07-26T23:27:06Z** `[note]` Mandato de la ronda de confirmacion: minimo, acotado al diff de prosa sin commitear del propio documento, con barrido del resto del documento en busca de la misma clase de enumeracion caduca
- **2026-07-26T23:27:06Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T23:30:27Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T23:31:32Z** `[graduation]` spec: `contract-discovery.md`
