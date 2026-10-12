---
id: "20261002-113435"
title: Fase de semilla de graduación configurable por tipo
type: feature
status: done
created: 2026-10-02T11:34:35Z
depends_on: ["20261002-113320"]
archived: true
reviewed: true
branch: feature/20261002-113435
related_to: []
owner: Carlos Rodríguez
release_impact: minor
---

## Request

`changeledger graduate <id> <slug> --new` crea siempre la semilla de la spec a
partir de `## Specification`, o de `## Proposal` si no hay Specification. En un
change `documentation` (#20261002-113320) la Specification sólo tiene criterios
sobre el propio change. El texto que debe convertirse en spec es el
comportamiento observado, que vive en `## Investigation` y que el revisor
independiente ya comprobó. Lo destapó la prueba en backend-laravel
(`#20261001-134952`): la semilla salió inservible y hubo que redactar la spec
desde cero al cerrar, fuera de la revisión.

Se pide que cada tipo pueda declarar de qué fase sale la semilla
(`types.<tipo>.seed_stage`), y que el tipo `documentation` de la plantilla la
fije en `investigation`.

Fuera de alcance:

- Seleccionar una subsección dentro de la fase: la semilla sigue siendo la fase
  entera, y el agente la refina antes de `--into`, como hoy.
- Cambiar el recorrido `--new` → refinar → `--into`.
- Migrar repos existentes.

## Investigation

Estado actual, verificado en `dev`:

- **De dónde sale la semilla.** `scaffoldSpec` en `src/commands/graduate.mjs`
  toma `change.stages.find((stage) => stage.key === 'specification') ??
  change.stages.find((stage) => stage.key === 'proposal')`. Si no encuentra
  ninguna, la semilla queda vacía. No consulta la config del tipo.
- **Validación de la config.** `checkConfig` en `src/check.mjs` valida, por
  tipo, `stages` y `review_required`. No conoce ninguna clave `seed_stage`.
- **Contrato.** `templates/contract/close.md` (paso 1 del recorrido para una
  spec nueva) dice que `--new` crea la semilla a partir de la Specification o de
  la Proposal del change.
- **Tests.** `test/graduate.test.mjs` cubre el recorrido `--new`/`--into` con
  changes que tienen `## Specification`.

`changeledger search` no encuentra changes previos sobre la semilla de
graduación.

## Proposal

- **Clave opcional `seed_stage`**, el nombre de una fase canónica. Si un tipo la
  declara, `scaffoldSpec` toma la semilla de esa fase. Si no la declara, se
  mantiene el orden actual (Specification y luego Proposal), así que ningún tipo
  existente cambia de comportamiento.
- **Validación en `checkConfig`.** `seed_stage` debe ser una de las `stages`
  activas del propio tipo; si no, es un error.
- **Plantilla.** El tipo `documentation` declara `seed_stage: investigation`.
- **Contrato.** `close.md` dice de dónde sale la semilla: de la fase declarada
  por el tipo, o si no, de la Specification o la Proposal.

**Alternativas descartadas**

- **Seleccionar la fase según el tipo, en código.** Contradice que los tipos se
  definan en la config.
- **Elegir una subsección (`### Comportamiento observado`).** Ata el código a un
  encabezado en el idioma del repo.

## Specification

### CR1 — La semilla sale de la fase declarada
- **Given** un tipo con `seed_stage: investigation` y un change `done` de ese tipo cuyo `## Investigation` contiene `Texto observado` y cuyo `## Specification` contiene `### CR1`
- **When** se ejecuta `changeledger graduate <id> mi-spec --new`
- **Then** la spec creada contiene `Texto observado`
- **And** no contiene `### CR1`

### CR2 — Sin seed_stage se mantiene el comportamiento actual
- **Given** un tipo sin `seed_stage` y un change `done` con `## Proposal` y `## Specification`
- **When** se ejecuta `changeledger graduate <id> mi-spec --new`
- **Then** la semilla es el cuerpo de `## Specification`
- **And** si el tipo no tiene Specification, la semilla es el cuerpo de `## Proposal`

### CR3 — seed_stage fuera de las fases del tipo
- **Given** `types.documentation: { stages: [request, investigation, specification, log], seed_stage: plan }`
- **When** se ejecuta `changeledger check`
- **Then** aparece el error `config type "documentation": seed_stage "plan" is not an active stage`

### CR4 — La plantilla fija la semilla del tipo documentation
- **Given** un repo vacío
- **When** se ejecuta `changeledger init`
- **Then** `types.documentation.seed_stage` vale `investigation`
- **And** `changeledger check` termina sin errores

### CR5 — Primer uso de extremo a extremo
- **Given** el repo de CR4 y un change `documentation` que llega a `done` con `## Investigation` y `## Specification`
- **When** se ejecutan `changeledger graduate <id> mi-spec --new`, se refina la semilla quitando el marcador de scaffold y se ejecuta `changeledger graduate <id> mi-spec --into`
- **Then** `--into` termina con éxito
- **And** la spec final contiene el texto refinado de la Investigation, y `graduated_from` contiene el id del change

### CR6 — El contrato describe el origen de la semilla
- **Given** el overlay de cierre
- **When** se ejecuta `changeledger context <id>` sobre un change `done`
- **Then** el paso de `--new` dice que la semilla sale de la fase que declara `seed_stage` el tipo y, si no la declara, de la Specification o la Proposal
- **And** lo comprueba un concept guard tolerante a la redacción, no una frase literal

## Plan

- [x] `scaffoldSpec` usa `types.<tipo>.seed_stage` si está declarada; si no,
  conserva el orden actual
  - **Target:** `src/commands/graduate.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-02T15:13:00Z`
- [x] Validación de `seed_stage` contra las fases activas del tipo
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-02T15:13:01Z`
- [x] `seed_stage: investigation` en el tipo `documentation` de la plantilla
  - **Target:** `templates/config.yml`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-02T15:13:02Z`
- [x] Recorrido de extremo a extremo de la graduación de un change
  `documentation`
  - **Target:** `test/graduate.test.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-02T15:13:03Z`
- [x] Origen de la semilla en el paso `--new` del overlay de cierre, con su
  concept guard
  - **Target:** `templates/contract/close.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-02T15:13:04Z`
- [x] Gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T15:13:05Z`

## Log
- **2026-10-02T13:03:23Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T15:01:13Z** `[status]` approved → in-progress
- **2026-10-02T15:01:13Z** `[branch]` set: feature/20261002-113435 (auto)
- **2026-10-02T15:12:59Z** `[note]` Verify de la tarea 5 corregido a test/context.test.mjs: los concept guards viven en la tabla curada CONCEPT_GUARDS de ese fichero (lo exige AGENTS.md), no en test/contract.test.mjs. La tarea 6 (pnpm verify) se cumple con sus tres gates equivalentes —biome check, node --test y changeledger check— porque el pnpm instalado (v11.13.0) no cumple el >=12.6.0 que exige el proyecto.
- **2026-10-02T15:13:23Z** `[status]` in-progress → in-review
- **2026-10-02T15:13:35Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR6 sobre dev..d0d94fc (src/commands/graduate.mjs, src/check.mjs, templates/config.yml, templates/contract/close.md y sus tests).
- **2026-10-02T15:19:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T15:20:08Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T15:20:40Z** `[graduation]` spec: `lifecycle.md`
- **2026-10-12T21:17:02Z** `[version]` 0.18.0-dev
- **2026-10-12T21:17:02Z** `[archive]` archived
