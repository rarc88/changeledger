---
id: "20261002-113435"
title: Fase de semilla de graduación configurable por tipo
type: feature
status: approved
created: 2026-10-02T11:34:35Z
depends_on: ["20261002-113320"]
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

- [ ] `scaffoldSpec` usa `types.<tipo>.seed_stage` si está declarada; si no,
  conserva el orden actual
  - **Target:** `src/commands/graduate.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Validación de `seed_stage` contra las fases activas del tipo
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR3
- [ ] `seed_stage: investigation` en el tipo `documentation` de la plantilla
  - **Target:** `templates/config.yml`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR4
- [ ] Recorrido de extremo a extremo de la graduación de un change
  `documentation`
  - **Target:** `test/graduate.test.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR5
- [ ] Origen de la semilla en el paso `--new` del overlay de cierre, con su
  concept guard
  - **Target:** `templates/contract/close.md`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR6
- [ ] Gate completo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-02T13:03:23Z** `[status]` draft → approved (human via conversation)
