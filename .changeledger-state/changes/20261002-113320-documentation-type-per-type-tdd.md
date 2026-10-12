---
id: "20261002-113320"
title: Tipo de change documentation y tdd por tipo
type: feature
status: done
created: 2026-10-02T11:33:20Z
depends_on: []
reviewed: true
branch: feature/20261002-113320
related_to: []
owner: Carlos Rodríguez
release_impact: minor
---

## Request

Incorporar al core un tipo de change `documentation`. Su entregable es verdad
persistente sobre un tema (p. ej. autenticación, flujo de compra), contrastada
con lo que el código hace realmente. No toca código de la aplicación.

Lo motiva una prueba real en otro repo (backend-laravel, changes
`#20261001-125417`, `#20261001-140300` y `#20261001-134952`). La prueba
destapó estas fricciones:

1. Con `tdd: true`, `approve` rechaza todo CR que no cubra una tarea del Plan,
   y `review_required: true` exige las fases `specification` y `plan`. Hizo
   falta un Plan cuyas tareas sólo repetían los CR.
2. El humano aceptó el change con las decisiones sobre las divergencias aún
   pendientes, y la graduación dependía de ellas.
3. Buscar con `grep -l` dio un perímetro con falsos positivos (un import sin
   uso) y se dejó llamadores indirectos.
4. Las correcciones de una spec existente se redactaron al cerrar, fuera de
   toda revisión.

El creador de ChangeLedger acuerda que **TDD se ignora en este tipo**.

Se pide:

- `tdd` configurable por tipo (`types.<tipo>.tdd`), que se impone al `tdd`
  global para los changes de ese tipo.
- Con TDD efectivo apagado, `review_required: true` exige sólo la fase
  `specification`.
- El tipo `documentation` en la config que genera `init`.
- Las reglas de autoría del tipo en el contrato.

Fuera de alcance:

- La fase de la que `graduate --new` crea la semilla de la spec. Va en un
  change aparte que depende de este.
- Añadir el tipo a repos ya existentes: no hay migración, y cada repo lo
  declara en su config si lo quiere.
- El color del tipo en el viewer.

## Investigation

Estado actual, verificado en `dev`:

- **`tdd` es sólo global.** `checkCoverage` en `src/check.mjs` termina con
  `if (config?.tdd === false) return;`. `effectiveTdd` en
  `src/commands/context.mjs` lee `config?.tdd ?? DEFAULT_TDD`. Ninguno mira el
  tipo.
- **Línea de política de un change.** La compone `changePolicyBlock`, que llama
  a `transversalPolicy(config, { includeTdd: servesReadiness })`.
  `servesReadiness` vale `typeConfig.stages.includes('specification')`.
  `fragmentsForType` quita `readiness` sólo cuando el tipo no tiene
  `specification`.
- **Contexto de los subagentes.** `buildAgentContext` en
  `src/commands/agent-context.mjs` publica `transversalPolicy(config)`, con el
  `tdd` global aunque haya un change seleccionado. La cápsula
  `templates/contract/agent-contexts/implementation.md` condiciona el
  red-green a `tdd=on`, así que un subagente de un change `documentation`
  recibiría `tdd=on`.
- **Regla de revisión.** `checkConfig` en `src/check.mjs` exige
  `REVIEWABLE_STAGES` (`['specification', 'plan']`) a todo tipo con
  `review_required: true`, sin mirar `tdd`. Error literal:
  `config type "<t>": review_required: true requires active stages: <faltantes>`.
- **Validación de claves de tipo.** `checkConfig` valida que `review_required`
  sea booleano (`config type "<t>": review_required must be a boolean`). No
  rechaza claves desconocidas, así que hoy un `tdd` en el tipo se ignora en
  silencio.
- **Plantilla.** `templates/config.yml` declara los tipos `feature`, `bug`,
  `audit`, `refactor`, `chore` y `quick`, y sus `release.impacts`.
- **Contrato.** `templates/contract/spec.md` (sección `## Stages`) define
  `quick` en un párrafo propio. `templates/contract/readiness.md` define la
  obligación `tdd` global. El pack `spec` ocupa 244 de sus 300 líneas; el techo
  de tokens está en `templates/contract/budgets.yml`.

`changeledger search` no encuentra changes previos sobre `tdd` por tipo ni sobre
el tipo `documentation`.

## Proposal

**Tdd por tipo.** El valor efectivo de un change sale de un único resolutor:
`types.<tipo>.tdd` si es booleano, si no `config.tdd`, y si no `true`. Lo
consumen:

- `checkCoverage`: no hay chequeo de cobertura si es `false`;
- `changePolicyBlock` y `buildAgentContext` (cuando hay change seleccionado):
  la línea de política muestra `tdd=off`;
- `fragmentsForType`: no compone `readiness` si es `false`;
- la regla de `review_required` en `checkConfig`.

**Cómo queda el tipo.** En la plantilla:

```yaml
documentation:
  stages: [request, investigation, specification, log]
  review_required: true
  tdd: false
```

Y `release.impacts.documentation: none`.

**Las reglas del tipo viven en sus propios CR.** El párrafo de `spec.md` dice
cómo se redacta un change `documentation` y qué criterios debe llevar. Las
obligaciones de ejecución quedan en esos CR, así que el implementador las
recibe con el change y no hace falta tocar `implement.md`.

Los criterios que pide el párrafo:

- El perímetro se fija en el draft a partir de quién llama a qué, no de
  coincidencias de texto.
- Cada afirmación cita ruta y símbolo.
- Cada divergencia con una spec previa queda decidida por el humano antes de
  `in-review`; si falta su decisión, el change va a `blocked`.
- Las correcciones de specs existentes se redactan dentro del change, para que
  el revisor las vea.
- No se toca código de la aplicación.

**Alternativas descartadas**

- **Exención fija por nombre de tipo.** Contradice que los tipos se definan en
  la config.
- **Mantener `plan` con tareas `Support`.** Es burocracia, como se vio en la
  prueba.
- **Regla de decisiones en `implement.md`.** Añade texto a todos los tipos por
  un caso particular.

## Specification

### CR1 — tdd: false en el tipo desactiva la cobertura
- **Given** una config con `tdd: true` y `types.documentation: { stages: [request, investigation, specification, log], review_required: true, tdd: false }`
- **And** un change `documentation` en `approved` con `### CR1` y sin `## Plan`
- **When** se ejecuta `changeledger check`
- **Then** no aparece el diagnóstico `CR1 is not covered by any Plan task` para ese change
- **And** un change `feature` del mismo repo en `approved` con un CR sin tarea sigue dando ese diagnóstico como error

### CR2 — tdd: true en el tipo se impone al global apagado
- **Given** una config con `tdd: false` y `types.feature.tdd: true`
- **When** se ejecuta `changeledger check` sobre un change `feature` en `approved` con un CR sin tarea
- **Then** aparece como error `CR1 is not covered by any Plan task`

### CR3 — Valor inválido rechazado
- **Given** `types.documentation.tdd: "no"`
- **When** se ejecuta `changeledger check`
- **Then** aparece el error `config type "documentation": tdd must be a boolean`

### CR4 — Contexto de un change con tdd apagado
- **Given** un change `documentation` con el tipo de CR1
- **When** se ejecuta `changeledger context <id>`
- **Then** la línea `Effective policy:` contiene `tdd=off`
- **And** la captura no contiene el encabezado `# Definition of Ready`

### CR5 — Contexto de subagente con el tdd del change
- **Given** el mismo change y una config con `tdd: true`
- **When** se ejecuta `changeledger agent-context implementation <id>`
- **Then** la línea `Effective policy:` contiene `tdd=off`
- **And** `changeledger agent-context investigation`, sin id (el único rol que lo admite), sigue mostrando `tdd=on`

### CR6 — review_required sin plan cuando tdd está apagado
- **Given** un tipo con `review_required: true`, `tdd: false` y `stages: [request, investigation, specification, log]`
- **When** se ejecuta `changeledger check`
- **Then** no aparece ningún error `requires active stages`
- **And** el mismo tipo con el `tdd` efectivo encendido sigue dando `config type "<t>": review_required: true requires active stages: plan`
- **And** con `tdd: false` y sin `specification` da `config type "<t>": review_required: true requires active stages: specification`

### CR7 — La plantilla trae el tipo documentation
- **Given** un repo vacío
- **When** se ejecuta `changeledger init`
- **Then** `.changeledger/config.yml` declara `types.documentation` con `stages: [request, investigation, specification, log]`, `review_required: true` y `tdd: false`
- **And** declara `release.impacts.documentation: none`
- **And** `changeledger check` termina sin errores

### CR8 — Primer uso de extremo a extremo
- **Given** el repo de CR7
- **When** se crea con `changeledger new documentation` un change con Request, Investigation y Specification con un CR, y sin Plan
- **And** se ejecutan `changeledger approve <id>`, `changeledger status <id> in-progress`, `changeledger status <id> in-review` y `changeledger review <id> pass`
- **Then** cada comando termina con éxito y el change queda en `in-validation`

### CR9 — El contrato define el tipo
- **Given** el pack `spec`
- **When** se ejecuta `changeledger context spec`
- **Then** la captura contiene la definición del tipo `documentation` con estas obligaciones:
  - entregable de verdad persistente sin código de la aplicación;
  - perímetro según quién llama a qué;
  - cita de ruta y símbolo en cada afirmación;
  - decisión humana de cada divergencia antes de `in-review`;
  - correcciones de specs redactadas dentro del change
- **And** el pack contiene también, en `readiness.md`, que `types.<tipo>.tdd` se impone al `tdd` global para los changes de ese tipo
- **And** las comprueba un concept guard con patrones tolerantes a la redacción, no una frase literal

### CR10 — Presupuestos respetados
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** el pack `spec` queda dentro de sus techos de tokens y de líneas, sin quitar prosa normativa

## Plan

- [x] Resolutor único del tdd efectivo por tipo, y validación booleana de
  `types.<tipo>.tdd`
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-02T13:56:50Z`
- [x] Regla de `review_required` condicionada al tdd efectivo del tipo
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-02T13:56:52Z`
- [x] Línea de política y omisión de `readiness` según el tdd del change en
  `changePolicyBlock` y `fragmentsForType`
  - **Target:** `src/commands/context.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-02T13:56:53Z`
- [x] Tdd del change seleccionado en `buildAgentContext`
  - **Target:** `src/commands/agent-context.mjs`
  - **Verify:** `node --test test/agent-context.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-02T13:56:55Z`
- [x] Tipo `documentation` e impacto `none` en la plantilla
  - **Target:** `templates/config.yml`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-02T13:56:56Z`
- [x] Recorrido de extremo a extremo de un change `documentation` sin Plan
  - **Target:** `test/lifecycle.test.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-02T13:56:58Z`
- [x] Párrafo del tipo `documentation` en `## Stages` de `spec.md` y la
  regla del override en `readiness.md`, con su concept guard, dentro de
  presupuesto
  - **Target:** `templates/contract/spec.md`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR9, CR10
  - **Resolved:** `2026-10-02T13:56:59Z`
- [x] Gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T13:57:01Z`

## Log
- **2026-10-02T13:03:15Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T13:33:39Z** `[status]` approved → in-progress
- **2026-10-02T13:33:39Z** `[branch]` set: feature/20261002-113320 (auto)
- **2026-10-02T13:56:12Z** `[note]` CR5 corregido durante la implementación: su segundo paso pedía 'agent-context implementation' sin id, que el CLI rechaza ('role implementation requires a change id'). Se reescribe con 'investigation', el único rol sin id, manteniendo la intención: sin change seleccionado se publica el tdd global.
- **2026-10-02T13:57:16Z** `[status]` in-progress → in-review
- **2026-10-02T13:57:30Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR10 sobre dev..d8b94c9 (src/check.mjs, src/commands/context.mjs, src/commands/agent-context.mjs, templates/config.yml, templates/contract/spec.md, templates/contract/readiness.md y sus tests).
- **2026-10-02T14:04:25Z** `[review]` in-review → in-progress (retry): Revisión 1: el concept guard de CR9 está fuera de la tabla curada CONCEPT_GUARDS (cuyo recuento queda desfasado) y su comentario afirma que tolera reescrituras, lo que es falso (selector anclado al inicio del párrafo; 'blocked' exigido en la misma cláusula). Limpieza: servesReadiness mal nombrado y comentario de transversalPolicy desfasado en context.mjs.
- **2026-10-02T14:12:43Z** `[status]` in-progress → in-review
- **2026-10-02T14:12:49Z** `[note]` Mandato de revisión (confirmación, ronda 2): la corrección sin commitear sobre d8b94c9 — los defectos nombrados en la ronda 1 (guard de CR9 en CONCEPT_GUARDS y tolerante a la redacción, comentario veraz, servesReadiness y comentario de transversalPolicy) y cualquier regresión que introduzca.
- **2026-10-02T14:18:02Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T14:18:09Z** `[note]` Seguimientos de la revisión de confirmación (no bloquean): el mensaje de la primera aserción del guard 16 promete 'contrastada con el código' pero basta 'application code' para satisfacer \bcode\b; la redacción 'A change with an undecided divergence goes blocked' no satisface el guard porque \bdecid no casa dentro de 'undecided'. Residuales fuera de alcance: comentario de src/config-migration.mjs (v3→v4 añade plan sin mirar tdd), applyTypesPatch del viewer no edita types.<t>.tdd, agent-context muestra tdd en tipos sin specification.
- **2026-10-02T14:52:35Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T14:58:14Z** `[graduation]` spec: `readiness.md`
- **2026-10-02T14:58:15Z** `[graduation]` spec: `lifecycle.md`
- **2026-10-02T14:58:17Z** `[graduation]` spec: `contract-discovery.md`
- **2026-10-02T14:58:18Z** `[graduation]` spec: `validation.md`
- **2026-10-02T14:58:19Z** `[graduation]` spec: `architecture.md`
