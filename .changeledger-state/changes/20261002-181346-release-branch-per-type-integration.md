---
id: "20261002-181346"
title: Rama de release y rama de integración por tipo
type: feature
status: done
created: 2026-10-02T18:13:46Z
depends_on: []
reviewed: true
branch: feature/20261002-181346
related_to: ["20260711-210115", "20260731-161655", "20261002-113320"]
owner: Carlos Rodríguez
release_impact: minor
---

## Request

El humano quiere un tipo de change `hotfix` que se integre en la rama de release
del proyecto en lugar de en la de integración. Eso lo cubre un change posterior.
Hoy ChangeLedger sólo conoce una rama de integración por repo
(`git.integration_branch`), y todos los changes salen de ella y vuelven a ella.

Se pide la mecánica general:

- **`git.release_branch`.** Cada proyecto declara su rama de release o de
  producción, igual que declara la de integración.
- **`types.<tipo>.integrates_into`.** Cada tipo dice a qué rama se integra, por
  su papel: `integration` (por defecto) o `release`.
- **Comportamiento:** los changes de un tipo con `integrates_into: release`
  salen de `git.release_branch` y se integran en ella.

Fuera de alcance:

- El tipo `hotfix`, la pregunta al humano entre `bug` y `hotfix`, y la regla de
  llevar el resultado también a la rama de integración. Van en un change que
  depende de este.
- Que `changeledger check --commits` sin base deduzca la base del change de la
  rama actual. El contrato pedirá pasar la rama de integración del change.
- El formulario del viewer.
- Migrar repos existentes: si no declaran `git.release_branch`, nada cambia
  mientras ningún tipo use `integrates_into: release`.
- `cutover`, que sigue usando la rama de integración del repo.

## Investigation

Estado actual, verificado en `dev`:

- **Resolución.** `integrationBranch(config)` en `src/config.mjs` lee
  `git.integration_branch`. Ausente o `null`, devuelve `undefined`. Si el valor
  no es un texto no vacío, lanza
  `config "git.integration_branch" must be a non-empty string`.
- **Arranque de un change.** En `src/commands/agent.mjs`, la guarda de
  `status <id> in-progress` exige que la rama actual sea la publicada por
  `change_branch_format` y que descienda de `integrationBranch(config)`. Si no,
  da `branch "<rama>" must descend from integration branch "<base>"`.
- **Contexto.** `transversalPolicy(config, { type })` en
  `src/commands/context.mjs` añade `integration_branch=<rama>` a la línea
  `Effective policy:` cuando está declarada. La usan `changePolicyBlock` (contexto
  de un change) y `buildAgentContext` (`src/commands/agent-context.mjs`).
- **Lint de commits.** `changeledger check --commits` sin base usa
  `configuredIntegrationBranch` (`src/commands/check.mjs`), que es la rama del
  repo.
- **Validación de config.** `checkConfig` en `src/check.mjs` llama a
  `integrationBranch` para validar `git`. Ya valida claves por tipo
  (`review_required`, `tdd`, `seed_stage`).
- **Plantilla.** `templates/config.yml` declara `git.integration_branch:` vacío
  y `git.change_branch_format: "{type}/{id}"`.
- **Contrato.** La sección «Git protects traceability» de
  `templates/contract/implement.md` dice: «Never implement approved changes on
  `main`, `master`, or `dev`»; «When the config declares
  `git.integration_branch`, create change branches from it and integrate the
  finished result into it; `main` stays reserved for releases».

`changeledger search` encuentra la introducción de `git.integration_branch`
(`#20260711-210115`) y del formato de rama (`#20260731-161655`). Ningún change
previo trata la rama de release ni la integración por tipo.

## Proposal

- **Resolutor nuevo en `src/config.mjs`.** `releaseBranch(config)`, con el mismo
  contrato que `integrationBranch`, y `changeIntegrationBranch(config, type)`:
  - devuelve `releaseBranch(config)` si el tipo declara
    `integrates_into: release`;
  - si no, devuelve `integrationBranch(config)`;
  - si el tipo necesita la rama de release y no está declarada, lanza
    `type "<t>" integrates into git.release_branch, which is not declared`.
- **Consumidores:**
  - la guarda de `status in-progress`;
  - `transversalPolicy` con un tipo, es decir, los contextos de un change y de
    subagente con change seleccionado.

  Los contextos de modo siguen publicando la rama del repo.
- **Validación en `checkConfig`.** `git.release_branch` debe ser un texto no
  vacío, y `integrates_into` debe valer `integration` o `release`. Que falte
  `git.release_branch` no es un error de config: se informa al arrancar el
  change.
- **Plantilla.** Añade `git.release_branch:` vacío, junto a
  `integration_branch`.
- **Contrato (`implement.md`).**
  - Nunca se implementa sobre la rama de integración ni sobre la de release.
  - Las ramas de change salen de la `integration_branch` que publica el contexto
    del change y se integran en ella.
  - La rama de release (`git.release_branch`) queda reservada a releases y a
    los tipos que se integran en ella.
  - `check --commits` recibe como base la rama de integración del change.

**Alternativas descartadas**

- **`types.<t>.integration_branch` con un nombre literal.** Ata cada tipo al
  nombre de rama de un repo; el humano quiere que cada proyecto declare su rama
  de release.
- **Deducir la rama de release (`main`/`master`).** Repite el autodetect frágil
  que `git.integration_branch` vino a sustituir.

## Specification

### CR1 — Validación de git.release_branch
- **Given** `git.release_branch: ""`
- **When** se ejecuta `changeledger check`
- **Then** aparece el error `config "git.release_branch" must be a non-empty string`

### CR2 — Validación de integrates_into
- **Given** `types.bug.integrates_into: "prod"`
- **When** se ejecuta `changeledger check`
- **Then** aparece el error `config type "bug": integrates_into must be "integration" or "release"`

### CR3 — Un tipo de release arranca desde la rama de release
- **Given** `git.integration_branch: dev`, `git.release_branch: main` y un tipo `fix` con `integrates_into: release`, y un change `fix` aprobado en la rama `fix/<id>`
- **When** se ejecuta `changeledger status <id> in-progress` con `fix/<id>` creada desde `dev` sin descender de `main`
- **Then** falla con `branch "fix/<id>" must descend from integration branch "main"` y el documento no cambia
- **And** con `fix/<id>` creada desde `main` el comando termina con éxito

### CR4 — Rama de release no declarada
- **Given** el repo de CR3 sin `git.release_branch`
- **When** se ejecuta `changeledger status <id> in-progress` sobre el change `fix`
- **Then** falla con `type "fix" integrates into git.release_branch, which is not declared` y el documento no cambia

### CR5 — Los tipos sin integrates_into no cambian
- **Given** el repo de CR3 y un change `feature` aprobado sin `integrates_into` en su tipo
- **When** se ejecuta `changeledger status <id> in-progress` con su rama creada desde `dev`
- **Then** termina con éxito, como hoy

### CR6 — El contexto publica la rama del change
- **Given** el repo de CR3
- **When** se ejecuta `changeledger context <id>` sobre el change `fix` y sobre el `feature`
- **Then** la línea `Effective policy:` contiene `integration_branch=main` para el `fix` e `integration_branch=dev` para el `feature`
- **And** `changeledger agent-context implementation <id>` muestra la misma rama que `context <id>` para cada uno
- **And** `changeledger context` sin id sigue mostrando `integration_branch=dev`

### CR7 — La plantilla declara la clave
- **Given** un repo vacío
- **When** se ejecuta `changeledger init`
- **Then** `.changeledger/config.yml` contiene `git.release_branch` vacío junto a `git.integration_branch`
- **And** `changeledger check` termina sin errores

### CR8 — El contrato usa la rama del change
- **Given** el pack `implement`
- **When** se ejecuta `changeledger context implement`
- **Then** la captura contiene estas obligaciones:
  - nunca se implementa sobre la rama de integración ni sobre la de release;
  - las ramas de change salen de la `integration_branch` que publica el contexto del change y se integran en ella;
  - la rama de release queda reservada a releases y a los tipos que se integran en ella;
  - `check --commits` recibe como base la rama de integración del change
- **And** las comprueba una entrada nueva de `CONCEPT_GUARDS`, tolerante a la redacción

### CR9 — Presupuestos respetados
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** el pack `implement` queda dentro de sus techos de tokens y líneas, sin quitar prosa normativa

### CR10 — Primer uso de extremo a extremo
- **Given** un repo creado con `changeledger init`, con `git.integration_branch: dev`, `git.release_branch: main` y un tipo `fix` con `integrates_into: release`
- **When** se crea un change `fix`, se aprueba, se crea `fix/<id>` desde `main`, se ejecuta `changeledger status <id> in-progress` y después `changeledger context <id>`
- **Then** cada comando termina con éxito y el contexto publica `integration_branch=main`

## Plan

- [x] `releaseBranch` y `changeIntegrationBranch` en el resolutor de config
  - **Target:** `src/config.mjs`
  - **Verify:** `node --test test/config.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-02T18:46:14Z`
- [x] Validación de `git.release_branch` e `integrates_into`
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-02T18:46:15Z`
- [x] Guarda de `status in-progress` con la rama de integración del change
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR3, CR4, CR5
  - **Resolved:** `2026-10-02T18:46:16Z`
- [x] Línea de política con la rama del change en `context` y `agent-context`
  - **Target:** `src/commands/context.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-02T18:46:17Z`
- [x] `git.release_branch` vacío en la plantilla
  - **Target:** `templates/config.yml`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-02T18:46:18Z`
- [x] Reglas de rama en «Git protects traceability», con su concept guard y
  dentro de presupuesto
  - **Target:** `templates/contract/implement.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR8, CR9
  - **Resolved:** `2026-10-02T18:46:19Z`
- [x] Recorrido de extremo a extremo de un change de un tipo de release
  - **Target:** `test/lifecycle.test.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR10
  - **Resolved:** `2026-10-02T18:46:20Z`
- [x] Gate completo: `biome check`, `node --test` y `changeledger check`
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T18:46:21Z`

## Log
- **2026-10-02T18:13:46Z** `[version]` 0.18.0-dev
- **2026-10-02T18:20:47Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T18:20:51Z** `[status]` approved → in-progress
- **2026-10-02T18:20:51Z** `[branch]` set: feature/20261002-181346 (auto)
- **2026-10-02T18:46:13Z** `[note]` Decisiones de implementación: (1) CR8 se cumple sin el literal 'check --commits' en implement.md, porque el test 124837 CR3 lo reserva al core; el pack dice usar la rama de integración del change como <base> al comprobar sus commits, y el guard 20 comprueba la obligación. (2) context <id> y agent-context de un tipo de release sin git.release_branch fallan con el mismo error que status, sin publicar la rama de integración en silencio. (3) Se ajustaron test/config-migration.test.mjs (113219 CR1) y test/view.test.mjs (161655 CR6), autorizados por el orquestador, porque fijaban el bloque git: literal de la plantilla. Gates: biome check limpio; node --test 1699/1700 —el único fallo es 20261001-155612 CR9, preexistente en origin/dev por /var frente a /private/var en macOS—; changeledger check limpio. pnpm verify no se puede ejecutar (pnpm v11.13.0 < 12.6.0). registry 194234 CR3 falló una vez de forma intermitente y no se reprodujo.
- **2026-10-02T18:46:29Z** `[status]` in-progress → in-review
- **2026-10-02T18:46:39Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR10 sobre dev..784e473 (src/config.mjs, src/check.mjs, src/commands/agent.mjs, src/commands/context.mjs, templates/config.yml, templates/contract/implement.md y sus tests).
- **2026-10-02T18:54:53Z** `[review]` in-review → in-progress (retry): Revisión 1: el comentario de templates/config.yml sobre git: («change branches start from and merge into this branch») es falso con este change, porque los tipos con integrates_into: release salen de git.release_branch y se integran en ella.
- **2026-10-02T19:03:03Z** `[status]` in-progress → in-review
- **2026-10-02T19:03:06Z** `[note]` Mandato de revisión (confirmación, ronda 2): la corrección sin commitear sobre 784e473 —el comentario gestionado de git: en templates/config.yml y su copia en setBlankGitSection de src/config-migration.mjs (autorizada por el orquestador para cerrar el defecto en ambos sitios), más los tres pins de test/config-migration.test.mjs— y cualquier regresión que introduzca.
- **2026-10-02T19:08:58Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T19:08:59Z** `[note]` Seguimientos de la revisión (no bloquean): la guarda de status in-progress sólo comprueba ascendencia, así que en el esquema habitual (dev por delante de main) una rama de un tipo de release creada desde dev también la pasa y arrastraría trabajo sin publicar; con change_branch_format nulo, un tipo de release arranca sin git.release_branch y luego context <id> falla; el comentario de la migración nombra release_branch aunque la migración no lo añade; los recuentos «twelve/eleven» de test/context.test.mjs son previos y están desfasados.
- **2026-10-02T19:14:19Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T19:19:33Z** `[note]` graduation-review ronda 1 de la reconciliación de git-traceability: recomienda corregir — «git.integration_branch en cualquier otro caso» era falso para un rol inválido (el resolutor lanza integrationRoleError). Acotado al rol integration o ausente, añadiendo que un rol inválido lanza el mismo mensaje que check. Se delega a un revisor nuevo.
- **2026-10-02T19:20:13Z** `[note]` graduation-review ronda 2 de git-traceability: recomienda aplicar; la frase acotada es cierta para todos los roles. Matiz opcional no aplicado: el resolutor también lanza si git o la clave están mal formados, algo que la spec ya cubre en su descripción de la validación.
- **2026-10-02T19:20:14Z** `[graduation]` spec: `git-traceability.md`
