---
id: "20260731-161655"
title: Configurar el formato de las ramas de change
type: feature
status: in-validation
created: 2026-07-31T16:16:55Z
depends_on: []
related_to: ["20260711-103757", "20260711-210115", "20260711-225637"]
owner: Roberto Ruiz
release_impact: minor
---

## Request

Los repositorios pueden declarar la rama de integración, pero no una convención
ejecutable para las ramas que implementan cada change. Agentes y humanos deben
inventar el nombre y pueden terminar trabajando en una rama que no se relaciona
de forma determinista con el id. Se necesita un formato configurable que derive
el nombre desde campos inmutables del change, lo publique en el contexto y lo
verifique al comenzar la implementación.

## Investigation

`git.integration_branch` ya define de dónde parten y a dónde vuelven las ramas;
`context` publica esa base y `check --commits` la usa por defecto. No existe una
función que renderice el nombre esperado ni una validación del branch actual en
`approved → in-progress`. La rama histórica `codex/global-state-branch`
implementó `{type}/{id}`, validación de placeholders y `git check-ref-format`,
pero mezcló el campo con una migración de schema que también activaba el almacén
global. La migración del formato sí debe recuperarse de forma aislada; el almacén
global no forma parte de este change.

`20260711-210115` y `20260711-225637` son la base terminada de configuración,
migración y edición de `integration_branch`; `20260711-103757` define el lint y
helper de commits sobre los que se apoya la trazabilidad Git. No son
prerrequisitos pendientes.

## Proposal

Añadir la clave `git.change_branch_format`. Los repos nuevos y los repos legacy
que ejecuten `changeledger config migrate` reciben el formato `{type}/{id}`; una ausencia o `null`
explícitos siguen desactivando la convención en runtime. Cuando se declara, solo
admite `{type}` y `{id}`, exige `{id}` exactamente una vez y permite texto literal,
por ejemplo `changes/{type}/{id}`. No admite `owner`, `title` ni otros campos
mutables que obligarían a renombrar una rama.

El nombre renderizado debe pasar la validación nativa de refs de Git. El contexto
de un change publica `change_branch=<nombre>` y el contrato ordena usarlo. La
transición `approved → in-progress` verifica que el branch actual tenga ese
nombre y descienda de `git.integration_branch` cuando ambas claves estén
declaradas. No se crea ni cambia de rama automáticamente: esa mutación permanece
explícita y bajo control del operador.

La migración incrementa el schema y añade únicamente este formato dentro de
`git`, preservando el resto de la configuración y sin crear campos del almacén
global. La actualización es explícita mediante `changeledger config migrate`, por lo que
el operador puede coordinar el cambio de convención antes de iniciar otro change.

## Specification

### CR1 — Render determinista opt-in
- **Given** un change feature con id `20260731-161655` y `git.change_branch_format: changes/{type}/{id}`
- **When** se calcula su rama de implementación
- **Then** devuelve exactamente `changes/feature/20260731-161655`
- **And** repetir el cálculo con la misma config y change devuelve el mismo resultado

### CR2 — Repos nuevos y legacy reciben la convención
- **Given** un repositorio nuevo o una config legacy en cualquier schema soportado
- **When** se ejecuta `init` o `changeledger config migrate`
- **Then** la config vigente declara `git.change_branch_format: "{type}/{id}"`
- **And** la migración incrementa el schema, preserva las demás claves Git y no añade configuración de estado global

### CR7 — Ausencia explícita conserva el opt-out de runtime
- **Given** una config vigente sin `git.change_branch_format` o con el valor YAML `null`
- **When** se resuelve la convención de rama
- **Then** no se exige ni publica un nombre de rama de change
- **And** la config no se modifica implícitamente fuera de `init` o `changeledger config migrate`

### CR3 — Formatos ambiguos o inválidos fallan cerrados
- **Given** cada formato `{type}`, `{id}/{id}`, `{owner}/{id}`, `{type/{id}` o `bad..{id}`
- **When** se valida o renderiza para un change
- **Then** se rechaza respectivamente por ausencia o duplicación de `{id}`, placeholder desconocido, placeholder malformado o resultado inválido para Git
- **And** `changeledger check` reporta el mismo defecto sin lanzar una excepción

### CR4 — El contexto publica la rama esperada
- **Given** un change resoluble y una config con `git.change_branch_format: work/{id}`
- **When** se ejecuta `changeledger context <id>`
- **Then** la política efectiva incluye `change_branch=work/<id>`
- **And** conserva `integration_branch=<rama>` cuando también está declarada

### CR5 — Inicio de implementación verifica nombre y baseline
- **Given** un change `approved`, `git.integration_branch: dev` y `git.change_branch_format: work/{id}`
- **When** se intenta `approved → in-progress`
- **Then** solo se permite desde el branch exacto `work/<id>` cuyo historial desciende de `dev`
- **And** cualquier nombre distinto falla antes de modificar el change con un diagnóstico que nombra la rama esperada y la actual

### CR6 — El viewer edita sin destruir claves Git
- **Given** una config con `integration_branch`, `change_branch_format` y una clave Git desconocida
- **When** el formulario del viewer cambia o limpia únicamente `change_branch_format`
- **Then** persiste el valor solicitado o elimina la clave
- **And** conserva sin cambios `integration_branch`, comentarios y claves Git desconocidas

## Plan

- [x] Escribir primero la matriz del formato y añadir resolución/renderizado con validación de Git
  - **Target:** `src/config.mjs`, `src/git.mjs`, `test/config.test.mjs`, `test/git.test.mjs`
  - **Verify:** `node --test test/config.test.mjs test/git.test.mjs`
  - **Criteria:** CR1, CR3, CR7
  - **Resolved:** `2026-07-31T17:43:25Z`
- [x] Validar la clave opcional desde `check` y publicar el nombre renderizado en el contexto del change
  - **Target:** `src/check.mjs`, `src/commands/context.mjs`, `test/check.test.mjs`, `test/context.test.mjs`
  - **Verify:** `node --test test/check.test.mjs test/context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-31T17:43:26Z`
- [x] Escribir primero regresiones de rama/nombre/baseline y verificar el inicio de implementación antes de mutar lifecycle
  - **Target:** `src/commands/agent.mjs`, `src/git.mjs`, `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-31T17:43:26Z`
- [x] Extender la plantilla, el contrato y el editor del viewer preservando YAML ajeno
  - **Target:** `templates/config.yml`, `templates/contract/implement.md`, `src/viewer/domain.mjs`, `src/viewer/public/app.js`, `test/view.test.mjs`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-07-31T17:47:43Z`
- [x] Escribir primero regresiones de migración y añadir el schema que publica `{type}/{id}` sin estado global
  - **Target:** `src/config-migration.mjs`, `templates/config.yml`, `.changeledger/config.yml`, `test/config-migration.test.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Criteria:** CR2, CR7
  - **Resolved:** `2026-07-31T20:35:22Z`
- [x] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-31T17:49:04Z`
- [x] Repetir el gate completo sobre la corrección solicitada en validación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-31T20:45:40Z`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T17:32:02Z** `[status]` approved → in-progress
- **2026-07-31T17:43:26Z** `[note]` CR1–CR5 red→green: exports y validaciones ausentes fallaron primero; núcleo final pasó 367/367. Mutantes de id duplicado, nombre exacto, ancestry, publicación en contexto y opt-out fallaron por la razón esperada y fueron restaurados por edición.
- **2026-07-31T17:47:48Z** `[note]` CR6 red→green: la plantilla y el formulario no exponían el formato; la suite del viewer pasó 188/188. Los mutantes que retiraban la persistencia en dominio o la recolección del control en UI fallaron por la razón esperada y se restauraron por edición. La aserción de init se actualizó para comprobar también la nueva clave opt-in y pasó 35/35.
- **2026-07-31T17:49:07Z** `[note]` Gate completo del candidato: Biome limpio, 1068/1068 tests y changeledger check válido.
- **2026-07-31T17:49:24Z** `[status]` in-progress → in-review
- **2026-07-31T17:50:24Z** `[note]` Mandato de revisión: auditoría completa del rango baseline..HEAD y de toda la superficie gobernada por CR1–CR6.
- **2026-07-31T18:00:06Z** `[review]` in-review → in-progress (retry): El renderer reinterpreta valores opacos de {type} al usar replaceAll secuencial: bug{id} y bug$& producen ramas distintas de la inserción literal; corregir con sustitución de una sola pasada y añadir ambas regresiones.
- **2026-07-31T18:04:30Z** `[note]` Corrección del hallazgo: los casos bug{id} y bug$& fallaron con la sustitución secuencial y pasaron tras cambiar a una sustitución única con callback. Suite config/git 35/35; gate completo Biome limpio, 1070/1070 tests y check válido.
- **2026-07-31T18:04:34Z** `[note]` Mandato de revisión de confirmación: spot check de la sustitución opaca señalada, sus dos regresiones y cualquier regresión introducida por esa corrección.
- **2026-07-31T18:04:44Z** `[status]` in-progress → in-review
- **2026-07-31T18:07:25Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-31T20:27:24Z** `[validation]` in-validation → in-progress (human rejected via conversation): Los repos legacy deben poder actualizar su config mediante migrate para recibir git.change_branch_format: '{type}/{id}'; sin esa migración el cambio está incompleto.
- **2026-07-31T20:35:22Z** `[note]` CR2/CR7 red→green: init seguía en schema 4, schema 4 no migraba y schema 1 terminaba sin formato; la migración aislada v4→v5 publica {type}/{id}, preserva claves Git y no añade estado global. Suite de migración 38/38; mutante que conservaba null falló y fue restaurado.
- **2026-07-31T20:45:40Z** `[note]` Gate completo de la corrección: Biome limpio, 1073/1073 tests y changeledger check válido; la config dogfood migró 4→5 y ya declara {type}/{id}.
- **2026-07-31T20:45:41Z** `[status]` in-progress → in-review
- **2026-07-31T20:45:48Z** `[note]` Mandato de revisión de la corrección: auditar CR2/CR7, migración v4→v5 y cadena legacy, default {type}/{id} en init/template, preservación de Git/YAML, ausencia de estado global y aislamiento semántico de fixtures afectados.
- **2026-07-31T20:52:11Z** `[review]` in-review → in-progress (retry): El contrato nombra changeledger migrate en vez de changeledger config migrate y tres tests de opt-out conservan la etiqueta CR2 en vez de CR7.
- **2026-07-31T20:52:49Z** `[status]` in-progress → in-review
- **2026-07-31T20:52:56Z** `[note]` Mandato de revisión de confirmación: comprobar únicamente el comando ejecutable en Proposal/CR2/CR7, las etiquetas CR7 de los tres tests de opt-out y regresiones introducidas por esas correcciones de trazabilidad.
- **2026-07-31T20:55:08Z** `[review]` in-review → in-validation (delegated subagent, clean context)
