---
id: "20261012-174340"
title: "La validación y la migración de la config no cubren seed_stage, release_branch ni el tdd por tipo"
type: bug
status: approved
created: 2026-10-12T17:43:40Z
depends_on: []
related_to: ["20261002-113320", "20261002-113435", "20261002-181346", "20261002-204623", "20260726-141119"]
owner: rarc88
---

## Request

Tres huecos de la superficie «config: validación (`checkConfig`) y reparación
(`config migrate`)» que dejó el PR #8 (#20261002-113320, #20261002-113435,
#20261002-181346). Cada uno deja pasar en silencio una config que no hace lo que
dice o repara una config con algo que el tipo no pidió:

1. `types.<tipo>.seed_stage: request` (o `log`, o `plan`) pasa `changeledger
   check` sin error. La semilla de `graduate --new` sería la petición, el Log o
   la lista de tareas, que no son verdad persistente.
2. `git.release_branch` igual a `git.integration_branch` pasa `check` sin error.
   Un tipo `integrates_into: release` (como `hotfix`, que la plantilla trae)
   queda entonces sin `back_merge_branch` y sin la guarda de arranque de
   #20261002-204623, sin que nada avise.
3. `config migrate` (3 → 4) inserta `plan` en todo tipo con `review_required:
   true`, aunque su `tdd` efectivo esté apagado, donde `checkConfig` ya sólo
   exige `specification`. El repo migrado queda con una fase que el tipo no
   pidió.

Fuera de alcance, y por qué:

- Que `graduate --new` rechace en ejecución un `seed_stage` inválido: la puerta
  es `check`, igual que para el resto de la config; `graduate` no revalida la
  config hoy.
- El resto de residuales de la revisión de #20261002-113320 (el editor de
  config del visor no edita `types.<t>.tdd`; `agent-context` publica `tdd` en
  tipos sin `specification`): son otras superficies.
- Migrar configs que ya declaran un `seed_stage` o ramas iguales: el cambio
  endurece `check`, no reescribe nada (lo dice este Request).

## Investigation

**Una sola preocupación.** Los tres huecos son la misma clase de defecto: la
regla de la config que introdujo el PR #8 está en un sitio y los demás
consumidores de esa regla (`check`, `config migrate`) no la aplican con el mismo
criterio. Dos viven en `checkConfig` y el tercero en la reparación que debe
coincidir con `checkConfig`. Se queda en un solo change; si el revisor prefiere
partirlo, el tercero (`src/config-migration.mjs`) tiene un conjunto de escritura
disjunto de los otros dos (`src/check.mjs`), pero comparten los tests de
`src/check.mjs` y la reconciliación de specs. No hay changes abiertos
sobre esta superficie (`changeledger search seed_stage`, `release_branch`,
`activateReviewableStages`, `config migrate tdd plan`): solo changes `done`, que
van en `related_to`.

**1. `seed_stage`.** `checkConfig` (`src/check.mjs`) exige que sea texto y una de
las `stages` activas del tipo (CR3 de #20261002-113435; mensaje `config type
"<t>": seed_stage "<s>" is not an active stage`). `scaffoldSpec`
(`src/commands/graduate.mjs`) toma el cuerpo de la fase con esa clave, sea cual
sea, y no valida nada. El Request de #20261002-113435 define la semilla como
verdad observada («comportamiento observado, que vive en `## Investigation`») y
su único uso real es `investigation`; la Proposal habla de «una fase canónica» y
el único valor que probó como inválido es una fase *inactiva* (`plan` en un tipo
sin Plan). Medido en `dev` con `checkRepo` sobre un tipo con las fases `request,
investigation, proposal, plan, specification, log`: `request`, `plan` y `log`
dan 0 errores, igual que `investigation`, `proposal` y `specification`. Las fases
con verdad persistente candidata a spec son esas tres, que coinciden con el
orden de reserva actual (`specification`, luego `proposal`) más `investigation`.
`request` es la petición, `log` son eventos y `plan` son tareas con marcadores
de estado: ninguna es una spec. La inclusión de `plan` va más allá de lo que
pidió el humano para este change (sólo `request` y `log`); se razona arriba y
queda a su decisión en la revisión.

**2. `release_branch == integration_branch`.** `changeIntegrationBranch`
(`src/config.mjs`) resuelve la rama de un tipo `release` a `releaseBranch(config)`.
Si es igual a `integrationBranch(config)`: `transversalPolicy`
(`src/commands/context.mjs`) calcula `back_merge_branch` sólo cuando
`repoBranch !== branch` y no lo publica; `assertImplementationBranch`
(`src/commands/agent.mjs`) sólo comprueba la ascendencia de la rama de
integración cuando `integration !== baseline` y se la salta. Reproducido en un
repo temporal creado con `changeledger init` y con ambas ramas a `dev`:
`changeledger check` termina en `✓ 0 change(s) valid` y `changeledger context`
publica `release_types=hotfix — integration_branch=dev` sin `back_merge_branch`.
No basta con rechazarlo sólo cuando hay tipos de release declarados: la
plantilla trae `hotfix` con `integrates_into: release`, así que el estado
«ningún tipo de release» no existe en un repo creado con `init`. El valor
comparado es el que devuelven `integrationBranch` y `releaseBranch` (con `trim`),
no el literal del YAML.

**3. Migración.** `checkConfig` exige, con `review_required: true`, las fases de
`REVIEWABLE_STAGES` si `effectiveTdd(config, type)`, y sólo `specification` si
no. `activateReviewableStages` (`src/config-migration.mjs`) itera siempre
`REVIEWABLE_STAGES`. Reproducido con `buildMigration` sobre un schema 3
(`refactor: { stages: [request, proposal, log], review_required: true }`) en tres
variantes: `tdd: false` global, `tdd: false` en el tipo con global `true`, y
`tdd: true`. En las tres el resultado es `stages: [request, proposal,
specification, plan, log]` con `added stage plan to types.refactor.stages`;
sólo la tercera es correcta. El comentario sobre `REVIEWABLE_STAGES` dice que
«with tdd off `checkConfig` requires only `specification`», y el residual ya
figuraba como nota no bloqueante de la revisión de #20261002-113320 (Log:
«v3→v4 añade plan sin mirar tdd»). La spec `architecture` documenta hoy el
comportamiento defectuoso a propósito: «No mira el `tdd` del tipo: inserta
también `plan` en un tipo con `tdd` efectivo apagado», de modo que la
reconciliación de specs al cerrar este change debe reescribir ese párrafo, y
añadir a `lifecycle` (párrafo de `seed_stage`) y a `git-traceability`
(validación Git) los rechazos de CR1 y CR4 con sus mensajes literales. Las migraciones se encadenan:
`migrateToV1` puede haber añadido `tdd: true` y `review_required`, así que el
`tdd` efectivo se lee del documento vivo, no de la instantánea previa.

**Raíz común.** La regla «qué fases exige `review_required`» existe duplicada:
la expresión de `checkConfig` y el bucle de la migración. La corrección la deja
en una sola función exportada por `src/check.mjs` que consumen ambos, como ya
hace `effectiveTdd`.

**Interfaces externas.** Los mensajes de `changeledger check` y los resúmenes de
`config migrate` (`added stage <s> to types.<t>.stages`) son literales estables
para consumo automático: los tests existentes los afirman. Los mensajes nuevos de
los CR1 y CR4 pasan a ser parte de ese contrato. No cambia ningún formato.

## Specification

### CR1 — seed_stage en una fase que no puede ser semilla
- **Given** un `.changeledger/config.yml` con `types.documentation: { stages: [request, investigation, plan, specification, log], review_required: true, tdd: false, seed_stage: <s> }`
- **When** se ejecuta `changeledger check` una vez por cada `<s>` de `request`, `plan` y `log`
- **Then** cada ejecución da exactamente un error, `config type "documentation": seed_stage "<s>" cannot seed a spec; use one of: investigation, proposal, specification`
- **And** no da ningún otro error de `seed_stage`

### CR2 — seed_stage en una fase válida
- **Given** el tipo de CR1 con `stages: [request, investigation, proposal, specification, log]`
- **When** se ejecuta `changeledger check` una vez por cada `seed_stage` de `investigation`, `proposal` y `specification`
- **Then** ninguna ejecución da un error que contenga `seed_stage`
- **And** el `changeledger init` sobre un repo vacío da una config que declara `types.documentation.seed_stage: investigation` y `changeledger check` termina sin errores

### CR3 — Los errores previos de seed_stage no cambian
- **Given** el tipo de CR1 con `stages: [request, investigation, specification, log]` y `seed_stage: plan`
- **When** se ejecuta `changeledger check`
- **Then** el único error de `seed_stage` es `config type "documentation": seed_stage "plan" is not an active stage` (la fase inactiva se informa antes que la no semilla, y una sola vez)
- **And** con `seed_stage` igual a `3`, `null` o `[investigation]` el único error es `config type "documentation": seed_stage must be a string`

### CR4 — release_branch igual a integration_branch
- **Given** `git: { integration_branch: dev, release_branch: dev }`
- **When** se ejecuta `changeledger check`
- **Then** aparece el error `config "git.release_branch" must differ from "git.integration_branch" (both are "dev")`
- **And** con `release_branch: " dev "` y `integration_branch: dev` aparece el mismo error, con el valor ya recortado

### CR5 — Ramas distintas o no declaradas
- **Given** cuatro configs: `integration_branch: dev` con `release_branch: main`; sólo `integration_branch: dev`; sólo `release_branch: main`; y `git` sin ninguna de las dos
- **When** se ejecuta `changeledger check` sobre cada una
- **Then** ninguna da un error que contenga `must differ`
- **And** con `integration_branch: dev` y `release_branch: ""` el único error es `config "git.release_branch" must be a non-empty string` (el error previo no se duplica ni se acompaña del nuevo)
- **And** con `git: main` el único error es `config "git" must be a mapping`

### CR6 — La migración no añade plan con tdd global apagado
- **Given** un schema 3 con `tdd: false`, la lista canónica `[request, investigation, proposal, specification, plan, log]` y `types.refactor: { stages: [request, proposal, log], review_required: true }`
- **When** se ejecuta `changeledger config migrate`
- **Then** `types.refactor.stages` queda `[request, proposal, specification, log]`
- **And** el resumen contiene `added stage specification to types.refactor.stages` y no contiene `added stage plan`

### CR7 — El tdd del tipo manda sobre el global en la migración
- **Given** el schema 3 de CR6 con `tdd: true` y `types.refactor.tdd: false`
- **When** se ejecuta `changeledger config migrate`
- **Then** `types.refactor.stages` queda `[request, proposal, specification, log]`
- **And** con `tdd: false` global y `types.refactor.tdd: true` queda `[request, proposal, specification, plan, log]`
- **And** un tipo con `review_required: true` y `tdd: false` que ya declara `specification` y no `plan` conserva sus `stages` byte a byte

### CR8 — Con tdd efectivo encendido la migración no cambia
- **Given** el schema 3 de CR6 con `tdd: true` y sin `tdd` en el tipo
- **When** se ejecuta `changeledger config migrate`
- **Then** `types.refactor.stages` queda `[request, proposal, specification, plan, log]`
- **And** el resumen contiene `added stage specification to types.refactor.stages` y `added stage plan to types.refactor.stages`
- **And** tras migrar cualquiera de los casos de CR6, CR7 y CR8, `changeledger check` no da ningún error `requires active stages` y repetir la migración es un no-op

### CR9 — Primer uso de extremo a extremo
- **Given** un repo con un `.changeledger/config.yml` schema 3 con `tdd: false`, `types.refactor: { stages: [request, proposal, log], review_required: true }`, `git: { integration_branch: dev }` y la plantilla del resto de campos
- **When** se ejecuta `changeledger config migrate`, después `changeledger check`, y luego se edita la config a `types.documentation.seed_stage: log` y `git.release_branch: dev` y se vuelve a ejecutar `changeledger check`
- **Then** tras migrar, `types.refactor.stages` no contiene `plan` y `check` termina sin errores
- **And** tras la edición, `check` da exactamente los errores `config type "documentation": seed_stage "log" cannot seed a spec; use one of: investigation, proposal, specification` y `config "git.release_branch" must differ from "git.integration_branch" (both are "dev")`
- **And** con `seed_stage: investigation` y `release_branch: main`, `check` vuelve a terminar sin errores

## Plan

- [ ] Tests en rojo de CR1–CR5 en `checkConfig`, y regresión de los errores de
  #20261002-113435 y #20261002-181346
  - **Target:** `test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
- [ ] `checkConfig` rechaza un `seed_stage` que no sea `investigation`,
  `proposal` ni `specification`, después de los errores de tipo y de fase
  inactiva, con el mensaje literal de CR1
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] `checkConfig` rechaza `git.release_branch` igual a
  `git.integration_branch` (valores ya resueltos y recortados) sólo cuando
  ambos se resuelven sin error
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR4, CR5
- [ ] Tests en rojo de la migración con `tdd` global y por tipo apagado o
  encendido (CR6–CR8), construidos como los de `141119 CR6` con un schema 3
  - **Target:** `test/config-migration.test.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Criteria:** CR6, CR7, CR8
- [ ] Una única función exportada por `src/check.mjs` que devuelve las fases
  que exige `review_required` según `effectiveTdd`; la usan `checkConfig` y
  `activateReviewableStages`, leyendo la config del documento vivo
  - **Target:** `src/check.mjs`, `src/config-migration.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs test/check.test.mjs`
  - **Criteria:** CR6, CR7, CR8
- [ ] Comentarios de `templates/config.yml` sobre `seed_stage` (valores
  legítimos) y sobre `git.release_branch` (distinta de `integration_branch`);
  `init` sigue dando una config sin errores
  - **Target:** `templates/config.yml`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR2
- [ ] Test de extremo a extremo de CR9 sobre la CLI (`config migrate`, `check`,
  edición, `check`)
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR9
- [ ] Gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-12T17:43:40Z** `[version]` 0.18.0-dev
- **2026-10-12T17:58:08Z** `[status]` draft → approved (human via conversation)
