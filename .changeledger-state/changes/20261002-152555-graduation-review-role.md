---
id: "20261002-152555"
title: Revisión independiente de la reconciliación de specs al cerrar
type: feature
status: done
created: 2026-10-02T15:25:55Z
depends_on: []
reviewed: true
branch: feature/20261002-152555
related_to: ["20261002-113320", "20261002-113435"]
owner: Carlos Rodríguez
release_impact: minor
---

## Request

Al cerrar un change aceptado, el agente reconcilia la verdad persistente: corrige
specs existentes o refina la semilla de una nueva y la enlaza con `--into`. Esa
redacción ocurre después de la revisión independiente y de la aceptación humana,
así que nadie la contrasta con el código antes de que pase a ser verdad
persistente.

Ha pasado en los tres últimos cierres:

- `#20261002-113320`: cinco specs reconciliadas (`readiness`, `lifecycle`,
  `contract-discovery`, `validation`, `architecture`).
- `#20261002-113435`: la spec `lifecycle`.
- `backend-laravel:20261001-134952`: 54 líneas cambiadas en
  `pooling-routine-pause.md`.

El humano ha elegido cerrar el hueco con una revisión al cerrar, no cambiando
cómo se redacta un change. En los tipos con `review_required`, después de
redactar la reconciliación y antes del primer `--into`, un revisor de solo
lectura con contexto limpio contrasta con el código y con el change el diff de
cada spec afectada.

Fuera de alcance:

- Que `check` o `graduate` impongan la revisión mecánicamente: queda en el
  contrato, como el resto de delegaciones.
- Los tipos sin `review_required` y el cierre con `--skip`, que no redacta
  specs.
- Cambiar el rol `post-review`, que sigue limitado a `in-validation`.

## Investigation

Estado actual, verificado en `dev`:

- **Roles de subagente.** `src/commands/agent-context.mjs` declara
  `AGENT_ROLES = ['investigation', 'implementation', 'review', 'post-review']`
  y limita cada rol a ciertos estados con `ALLOWED_STATUSES`. Por ejemplo,
  `'post-review': ['in-validation']`. Si el estado no encaja, `selectedChange`
  lanza `role <rol> requires change status <estados>; got <estado>`.
  `src/commands/agent-prompt.mjs` valida el rol contra el mismo `AGENT_ROLES`.
- **Plantillas por rol.** Cada rol tiene una cápsula en
  `templates/contract/agent-contexts/<rol>.md` (la carga `capsule(role)`) y un
  esqueleto de prompt en `templates/contract/agent-prompts/<rol>.md`.
- **Core.** `templates/contract/core.md` (sección «Protect the orchestrator's
  context») enumera los roles de `changeledger agent-prompt <role>` y explica
  `post-review`.
- **Overlay de cierre.** `templates/contract/close.md` ordena reconciliar las
  specs afectadas y enlazar cada una con `--into`, pero no exige ninguna revisión
  de esa redacción. El overlay `done` va por 1150 de sus 1250 tokens y 95 de sus
  125 líneas (`templates/contract/budgets.yml`). El core también tiene techo
  propio.
- **Tests que conocen la lista de roles.** `test/agent-context.test.mjs`,
  `test/agent-prompt.test.mjs`, `test/cli-bin.test.mjs`, `test/context.test.mjs`,
  `test/repo.test.mjs` y `test/state-store.test.mjs` mencionan `post-review`.

`changeledger search` no encuentra changes previos sobre revisar la graduación.

## Proposal

- **Rol nuevo `graduation-review`** en `AGENT_ROLES`, limitado al estado `done`.
  - Tiene su cápsula: es de solo lectura y contrasta el diff de cada spec
    afectada con el código citado y con el change aceptado. Sigue las reglas de
    spec: verdad actual y concisa, sin cronología ni CR como estructura, y los
    cuantificadores universales comprobados. Informa de lo que encuentra y
    recomienda «aplicar» o «corregir», sin mover el change.
  - Tiene su esqueleto de prompt, con un hueco para indicar de dónde sale el
    diff de las specs (el journal en un repo activado, el worktree en uno
    inactivo).
- **`close.md`.** En un tipo con `review_required`, cuando el cierre crea o
  corrige specs, el orquestador delega `graduation-review` antes del primer
  `--into`. Si hay hallazgos, corrige y vuelve a delegar a un revisor nuevo.
  Deja el resultado en el Log con `changeledger log`. `--skip` no necesita
  revisión.
- **`core.md`.** Añade el rol a la lista de `agent-prompt <role>`.

**Alternativas descartadas**

- **Ampliar `post-review` a `done`.** Su semántica es la de una inspección
  mientras el humano decide en `in-validation`.
- **Bloquear `--into` sin revisión registrada.** Sería una regla mecánica nueva;
  el humano eligió la vía contractual.
- **Redactar las correcciones de specs antes de `in-review` en todos los
  tipos.** El humano la descartó por su coste.

## Specification

### CR1 — Contexto del rol sobre un change done
- **Given** un change en `done`
- **When** se ejecuta `changeledger agent-context graduation-review <id>`
- **Then** la salida abre con el sentinel `AGENT CONTEXT` con `role: graduation-review`, la línea `Effective policy:`, la cápsula del rol y el change seleccionado, y cierra con el sentinel `END`

### CR2 — El rol exige done
- **Given** un change en `in-validation`
- **When** se ejecuta `changeledger agent-context graduation-review <id>`
- **Then** el comando falla con `role graduation-review requires change status done; got in-validation`
- **And** `changeledger agent-context graduation-review` sin id falla con `role graduation-review requires a change id`

### CR3 — Esqueleto de prompt
- **Given** cualquier repo ChangeLedger
- **When** se ejecuta `changeledger agent-prompt graduation-review`
- **Then** la salida es el esqueleto del rol entre sus sentinels y contiene un hueco `{{...}}` para el origen del diff de las specs
- **And** un rol desconocido sigue fallando con `Unknown role` y la lista de roles válidos incluye `graduation-review`

### CR4 — La cápsula define un rol de solo lectura
- **Given** la cápsula `templates/contract/agent-contexts/graduation-review.md`
- **When** se compone con `changeledger agent-context graduation-review <id>`
- **Then** contiene estas obligaciones:
  - no modifica ficheros, Git ni el ledger, y no mueve el change;
  - contrasta el diff de cada spec afectada con el código y con el change;
  - comprueba las reglas de spec (verdad actual, sin CR como estructura, cuantificadores comprobados);
  - informa de los hallazgos con su evidencia y recomienda aplicar o corregir
- **And** las comprueba una entrada nueva de `CONCEPT_GUARDS` en `test/context.test.mjs`, tolerante a la redacción

### CR5 — El cierre exige la revisión antes de --into
- **Given** el overlay de cierre
- **When** se ejecuta `changeledger context <id>` sobre un change `done` de un tipo con `review_required`
- **Then** la captura contiene estas obligaciones:
  - cuando el cierre crea o corrige specs, se delega `graduation-review` antes del primer `--into`;
  - si hay hallazgos, se corrige y se vuelve a delegar a un revisor nuevo;
  - el resultado queda en el Log;
  - `--skip` no la requiere
- **And** las comprueba una entrada nueva de `CONCEPT_GUARDS`, tolerante a la redacción

### CR6 — El core anuncia el rol
- **Given** el pack `core`
- **When** se ejecuta `changeledger context`
- **Then** la lista de roles de `changeledger agent-prompt <role>` incluye `graduation-review`

### CR7 — Presupuestos respetados
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** el core, el overlay `done` y la cápsula del rol quedan dentro de sus techos de tokens y líneas, sin quitar prosa normativa

### CR8 — Primer uso de extremo a extremo
- **Given** un repo con un change `feature` que llega a `done` y una spec existente corregida en su cuerpo
- **When** se ejecutan `changeledger agent-prompt graduation-review`, `changeledger agent-context graduation-review <id>`, `changeledger log <id> "<resultado de la revisión>"` y `changeledger graduate <id> <spec> --into`
- **Then** cada comando termina con éxito
- **And** el Log del change contiene la nota de la revisión antes del evento de graduación

## Plan

- [x] Rol `graduation-review` en `AGENT_ROLES`, limitado a `done`
  - **Target:** `src/commands/agent-context.mjs`
  - **Verify:** `node --test test/agent-context.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-02T16:12:48Z`
- [x] Esqueleto de prompt del rol
  - **Target:** `templates/contract/agent-prompts/graduation-review.md`
  - **Verify:** `node --test test/agent-prompt.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-02T16:12:49Z`
- [x] Cápsula del rol con su concept guard
  - **Target:** `templates/contract/agent-contexts/graduation-review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-02T16:12:50Z`
- [x] Obligación de revisar la reconciliación en el overlay de cierre, con su
  concept guard
  - **Target:** `templates/contract/close.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-02T16:12:51Z`
- [x] Rol en la lista de `agent-prompt <role>` del core y presupuestos
  - **Target:** `templates/contract/core.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR6, CR7
  - **Resolved:** `2026-10-02T16:12:52Z`
- [x] Recorrido de extremo a extremo del cierre con revisión de la reconciliación
  - **Target:** `test/lifecycle.test.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-02T16:12:53Z`
- [x] Gate completo: `biome check`, `node --test` y `changeledger check`
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T16:12:54Z`

## Log
- **2026-10-02T15:33:40Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T15:53:14Z** `[status]` approved → in-progress
- **2026-10-02T15:53:14Z** `[branch]` set: feature/20261002-152555 (auto)
- **2026-10-02T16:12:46Z** `[note]` La tarea 7 (pnpm verify) se cumple con sus tres gates equivalentes —biome check, node --test (1542/1542) y changeledger check— porque el pnpm instalado (v11.13.0) no cumple el >=12.6.0 del proyecto. Durante la mutación, el implementador corrompió y restauró editando la cápsula y close.md; la revisión debe comprobar su integridad. Residual: los ejemplos de ayuda de bin/changeledger.mjs siguen listando cuatro roles de agent-prompt.
- **2026-10-02T16:13:02Z** `[status]` in-progress → in-review
- **2026-10-02T16:13:08Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR8 sobre dev..473b445 (src/commands/agent-context.mjs, la cápsula y el esqueleto de graduation-review, templates/contract/close.md, templates/contract/core.md y sus tests).
- **2026-10-02T16:17:23Z** `[review]` in-review → in-progress (retry): Revisión 1: el comentario del bucle de presupuestos de cápsulas en test/agent-context.test.mjs sigue diciendo «four … all four» aunque el bucle ya mide cinco roles.
- **2026-10-02T16:20:10Z** `[status]` in-progress → in-review
- **2026-10-02T16:20:16Z** `[note]` Mandato de revisión (confirmación, ronda 2): la corrección sin commitear sobre 473b445 en test/agent-context.test.mjs —el comentario del bucle de presupuestos de prompts— y cualquier regresión que introduzca. La corrección la hizo el orquestador; los cinco prompts miden 434, 479, 449, 415 y 525 tokens con el tokenizador fijado.
- **2026-10-02T16:23:30Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T16:23:31Z** `[note]` Seguimientos de la revisión (fuera del Plan, no bloquean): bin/changeledger.mjs (ayuda de [change-id] y ejemplos de agent-prompt) y README.md siguen listando cuatro roles; el ejemplo de diff para repos inactivos no muestra una spec nueva sin seguimiento ni una edición ya en el índice; close.md exige la revisión cuando el cierre «crea o corrige» specs, así que un cierre que sólo amplía una spec existente queda, leído al pie de la letra, fuera.
- **2026-10-02T16:27:52Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T16:32:15Z** `[note]` graduation-review de la reconciliación (contract-discovery, lifecycle): recomienda aplicar; confirma cada frase cambiada contra el código y ninguna otra spec contradice el change. Nota cosmética: un salto de línea corto en contract-discovery.
- **2026-10-02T16:32:17Z** `[graduation]` spec: `contract-discovery.md`
- **2026-10-02T16:32:18Z** `[graduation]` spec: `lifecycle.md`
