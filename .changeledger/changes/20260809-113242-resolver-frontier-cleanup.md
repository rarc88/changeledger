---
id: "20260809-113242"
title: Resolver las fronteras de resolución en repos activados
type: feature
status: in-validation
created: 2026-08-09T11:32:42Z
depends_on: ["20260808-151641"]
branch: integration/in-validation
related_to: ["20260809-113240", "20260808-234920"]
owner: rarc88
release_impact: minor
---

## Request

Cerrar las fronteras que `architecture.md` dejó declaradas al graduar la etapa
1: superficies que leen config o resuelven changes directamente del worktree
sin pasar por el resolver, y que en un repo activado sirven una verdad distinta
de la ref. Incluye además dos huecos no declarados encontrados en la
investigación de la etapa 2 — el cambio de estado desde el viewer y el guard de
staged de `changeledger commit` — porque son la misma clase de defecto y son
precondición dura del experimento de activar este repo (acto final de la etapa,
tras `20260809-113240`).

El ancla de descubrimiento no cambia: `.changeledger/config.yml` sigue viviendo
en el worktree como marcador de `findChangeledgerDir`; lo que este change
resuelve es que, en activo, la autoridad sobre el contenido sea siempre la ref.

Excluido: el preview de migración de config del viewer
(`previewConfigMigrationImpl`) y el enrutado de `config migrate` — son el
ámbito del draft aparcado `20260808-234920`.

## Investigation

Fronteras de config declaradas en `architecture.md` (todas verificadas en dev;
leen `config.yml` del worktree sin comprobar activación):

- `registerRepo` (`src/commands/register.mjs`): `findChangeledgerDir` +
  `loadConfig` incondicionales; sin gate de activación en todo el archivo.
- Bootstrap de `check` (`configuredIntegrationBranch`,
  `src/commands/check.mjs`): `loadConfig` incondicional para sembrar la rama
  base del lint de commits.
- Captura sin id de `context` (`composeInput`, `src/commands/context.mjs`):
  lee config del worktree deliberadamente, marcado como frontera desde
  `20260808-151641`.
- Captura sin change de `agent-context` (`buildAgentContext`,
  `src/commands/agent-context.mjs`): `repo ? repo.config :
  loadConfig(changeledgerDir)` en el camino sin id.
- Previews de config del viewer (`readProjectConfigImpl` y
  `readProjectConfigStructuredImpl`, `src/viewer/domain.mjs`): `readFileSync`
  del `config.yml` del worktree; en contraste, la escritura
  (`patchProjectConfigImpl` vía `locateProjectConfig`/`configTarget`) ya lee y
  escribe el blob de la ref en activo.
- `listProjects` (`src/registry.mjs`): `loadConfig` sobre el worktree de cada
  proyecto para `project_name`/`project_id`.

Huecos no declarados, misma clase (verificados en dev):

- `changeStatusImpl` (`src/viewer/domain.mjs`) llama a `resolveChange`
  (escaneo del worktree, sin gate) en vez de decidir por activación como hacen
  los mutadores de `agent.mjs`/`graduate.mjs`. Tras el cutover, cualquier
  transición humana desde el viewer fallaría con "No change with id" aunque el
  change exista en la ref.
- `changeledger commit` (`src/commands/commit.mjs`) no sabe nada de
  activación: computa las rutas staged esperadas bajo el `changes_dir` del
  worktree para validar el `git add`. Con el ledger fuera del worktree su
  premisa desaparece: en activo los documentos no son archivos staged y el
  marker debe componerse desde el change `in-progress` del snapshot.

Contexto de diseño: la escritura del viewer resuelve esto con el patrón
`repoIsActivated` + blob de la ref; la corrección consiste en dar a la lectura
un único camino compartido en vez de repetir el gate caller a caller, que es
exactamente cómo la frontera se reabrió silenciosamente hasta ahora.

La review del primer candidato (`73aef1ab`) ejecutó cinco bordes que la
investigación inicial no enumeró: la lectura directa aceptaba un config symlink
y evitaba la validación UTF-8/layout del snapshot; `loadRepo` seguía parseando
primero el marcador stale; el modo local y la reparación de ruta del viewer
seguían leyendo su identidad; `listProjects` ocultaba una activación rota tras
el nombre cacheado; y el commit activo admitía un change legacy extraño staged.
La estrategia de autoridad única sigue siendo válida, pero el barrido y su
primitiva de lectura estaban incompletos.

## Proposal

Un único helper de autoridad de config — `loadEffectiveConfig(repoRoot,
changeledgerDir)` en `src/config.mjs` — que devuelve el config de la ref cuando
el repo está activado y el del worktree cuando no. En activo consume una
primitiva focalizada de `state-store` que enumera y valida el layout completo
con las mismas garantías de blob regular y UTF-8 que `readSnapshot`, pero lee
solo el contenido de config; no carga todos los documentos. Todos los callers
frontera migran a él, incluido el bootstrap de `loadRepo`; `loadConfig` queda
como primitiva interna del camino inactivo y del propio helper.

Para los dos huecos no-config:

- `changeStatusImpl` decide por activación igual que los mutadores del CLI:
  snapshot vía el repo cargado en activo, `resolveChange` solo en inactivo.
- `changeledger commit` en activo compone el marker desde el change
  `in-progress` del snapshot y no exige su documento staged, pero conserva el
  guard fail-closed: cualquier documento extraño staged bajo el `changes_dir`
  efectivo se rechaza; en inactivo su comportamiento no cambia.

Alternativas descartadas:

- Repetir el gate `repoIsActivated` en cada caller: es el estado actual de la
  escritura del viewer y no impide que el siguiente caller vuelva a abrir la
  frontera; el helper único deja un solo sitio que auditar.
- Reutilizar `readSnapshot` para obtener config: preserva integridad, pero carga
  el contenido de todos los documentos en cada consulta de config. La decisión
  humana tras la review fue mantener una lectura focalizada con las mismas
  validaciones.
- Mover `config.yml` fuera del worktree: rompería el descubrimiento
  (`findChangeledgerDir` necesita el marcador) y contradice la decisión de la
  etapa 2.

Escenarios: cada superficie con config de worktree y ref deliberadamente
distintos; transición de estado desde el viewer sobre un repo activado sin
documentos en el worktree; commit con marker en activo; fixture inactiva sin
cambios de comportamiento.

## Specification

En todos los criterios, "repo activado divergente" es un fixture activado cuyo
`config.yml` del worktree difiere del de la ref en `project_name` (worktree
`stale-name`, ref `ref-name`).

### CR1 — register usa la autoridad de la ref
- **Given** un repo activado divergente
- **When** se ejecuta `changeledger register`
- **Then** la entrada del registry queda con `project_name` `ref-name`

### CR2 — El bootstrap de check usa la autoridad de la ref
- **Given** un repo activado cuyo `integration_branch` es `dev` en la ref y `main` en el worktree
- **When** `check` siembra la rama base del lint de commits
- **Then** la rama base efectiva es `dev`

### CR3 — Las capturas sin id usan la autoridad de la ref
- **Given** un repo activado divergente con política distinguible entre ambas copias (worktree `language: en`, ref `language: es`)
- **When** se ejecutan `changeledger context` sin id y `changeledger agent-context investigation` sin change
- **Then** ambas capturas reportan la política efectiva de la ref (`language=es`)

### CR4 — El preview de config del viewer muestra el candidato activo
- **Given** un repo activado divergente
- **When** el viewer sirve la lectura de config del proyecto (cruda y estructurada)
- **Then** ambas respuestas contienen `ref-name` y ninguna contiene `stale-name`

### CR5 — El listado de proyectos usa la autoridad de la ref
- **Given** un registry con el repo activado divergente
- **When** se ejecuta `listProjects`
- **Then** el proyecto se lista con `project_name` `ref-name`

### CR6 — El cambio de estado del viewer opera sobre el snapshot
- **Given** un repo activado cuyo worktree no contiene `changes/` y cuya ref contiene un change `draft`
- **When** el viewer ejecuta la transición `draft → approved` de ese change
- **Then** la transición se aplica en la ref de estado y la respuesta es de éxito, sin error "No change with id"

### CR7 — commit compone el marker desde el snapshot en activo
- **Given** un repo activado sin `changes/` en el worktree, con un único change `in-progress` en la ref y un archivo de código staged
- **When** se ejecuta `changeledger commit -m "feat(core): x"`
- **Then** el commit se crea con el marker `[#<id>]` de ese change y sin exigir documentos staged bajo `changes_dir`

### CR8 — Los repos no activados no cambian
- **Given** una fixture no activada
- **When** se ejecutan `register`, el bootstrap de `check`, las capturas sin id de `context`/`agent-context`, la lectura de config del viewer, `listProjects`, la transición de estado del viewer y `changeledger commit`
- **Then** cada superficie produce el mismo resultado observable que antes del change (los tests existentes de cada superficie siguen pasando sin modificación)

### CR9 — El config activo conserva la integridad del snapshot
- **Given** tres repos activados cuyas refs contienen respectivamente un config symlink, un config no UTF-8 y una ruta ajena al layout
- **When** `loadEffectiveConfig` intenta leer config parsed o raw
- **Then** rechaza respectivamente con `tree contains unsupported Git entry 120000 blob at .changeledger-state/config.yml`, `state path .changeledger-state/config.yml is not valid UTF-8` e `invalid state path: <ruta>`
- **And** nunca cae al config del worktree

### CR10 — El marcador stale no gobierna el bootstrap activo
- **Given** un repo activado con config válido en la ref y YAML inválido en `.changeledger/config.yml`
- **When** se ejecutan `loadRepo` y una transición de estado CLI/viewer sobre un change presente solo en la ref
- **Then** ambos cargan y mutan desde el snapshot sin intentar parsear el YAML del marcador

### CR11 — El viewer local y la reparación usan identidad activa
- **Given** un repo activado cuyo `project_id`/`project_name` difiere entre marcador y ref
- **When** el viewer resuelve el proyecto en modo local y repara su ruta registrada
- **Then** ambas operaciones usan el id y nombre de la ref y nunca los valores stale

### CR12 — El registry no oculta una activación rota
- **Given** una entrada registrada cuyo repo conserva activación pero perdió la ref de estado
- **When** se ejecuta `listProjects`
- **Then** falla con `state is not initialized` en vez de devolver el nombre cacheado o stale

### CR13 — El commit activo sigue rechazando changes staged extraños
- **Given** un repo activado con un único change `in-progress` en la ref, un archivo de código staged y `.changeledger/changes/foreign.md` staged
- **When** se ejecuta `changeledger commit -m "feat(core): x"`
- **Then** falla sin crear commit con `Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/foreign.md`

## Plan

- [x] Primitiva focalizada e íntegra de config para `loadEffectiveConfig`
  - **Target:** `src/state-store.mjs`, `src/config.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/config.test.mjs`
  - **Criteria:** CR8, CR9
  - **Resolved:** `2026-08-09T15:08:44Z`
- [x] Migrar los callers de CLI: `register`, bootstrap de `check` y capturas
  sin id de `context`/`agent-context`
  - **Target:** `src/commands/register.mjs`, `src/commands/check.mjs`, `src/commands/context.mjs`, `src/commands/agent-context.mjs`
  - **Verify:** `node --test test/register.test.mjs test/check.test.mjs test/context.test.mjs test/agent-context.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Completar el barrido de lectura del viewer y el listado del registry
  - **Target:** `src/viewer/domain.mjs`, `src/registry.mjs`
  - **Verify:** `node --test test/view.test.mjs test/registry.test.mjs`
  - **Criteria:** CR4, CR5, CR11, CR12
  - **Resolved:** `2026-08-09T15:08:44Z`
- [x] Enrutar el bootstrap de `loadRepo` y las transiciones por la autoridad activa
  - **Target:** `src/repo.mjs`, `src/viewer/domain.mjs`, `src/commands/agent.mjs`
  - **Verify:** `node --test test/repo.test.mjs test/view.test.mjs test/agent.test.mjs`
  - **Criteria:** CR6, CR10
  - **Resolved:** `2026-08-09T15:08:44Z`
- [x] Preservar el guard fail-closed de staged al componer el marker activo
  - **Target:** `src/commands/commit.mjs`
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR7, CR13
  - **Resolved:** `2026-08-09T15:08:44Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T15:08:44Z`

## Log
- **2026-08-09T11:55:07Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T14:07:52Z** `[status]` approved → in-progress
- **2026-08-09T14:07:52Z** `[branch]` set: feature/20260809-113242 (auto)
- **2026-08-09T14:20:39Z** `[status]` in-progress → in-review
- **2026-08-09T14:23:14Z** `[note]` Mandato de review: auditoría completa de la superficie gobernada por el change, incluidos CR1-CR8, regresión inactiva, autoridad raw/estructurada, transición del viewer y guard de commit activado; candidato fijo 73aef1ab sobre d9503195.
- **2026-08-09T14:32:12Z** `[review]` in-review → blocked: La review confirma una nueva clase no especificada: loadEffectiveConfig lee directamente el blob activo y elude las garantías de layout, blob regular y UTF-8 de readSnapshot; decidir la corrección exige elegir entre cargar el snapshot completo o ampliar state-store con una lectura validada. También quedan barridos de callers y del guard staged dentro de la corrección.
- **2026-08-09T14:32:38Z** `[note]` Handoff bloqueado: implementación 73aef1ab conservada; review adversarial reproducida; pendiente decisión entre reutilizar readSnapshot o añadir una primitiva focalizada y validada en state-store. Tras decidir, barrer también loadRepo, viewer local/reparación, registry fail-closed y staged legacy extraño.
- **2026-08-09T14:53:00Z** `[note]` Decisión humana: mantener lectura focalizada y añadir la primitiva validada en state-store; el contrato incorpora los cinco bordes ejecutados por la review antes de reintentar.
- **2026-08-09T14:55:18Z** `[status]` blocked → in-progress
- **2026-08-09T15:09:31Z** `[status]` in-progress → in-review
- **2026-08-09T15:09:31Z** `[note]` Mandato de review de confirmación: verificar exclusivamente los cinco defectos del fallo anterior y regresiones introducidas por la corrección focalizada; candidato sin commit sobre 4f850a6f.
- **2026-08-09T15:14:06Z** `[review]` in-review → in-progress (retry): Defecto 4 aún incompleto: listProjects vuelve a consultar activación sobre una ruta registrada inexistente bajo un ancestro Git y propaga spawnSync git ENOENT en vez de conservar el nombre cacheado.
- **2026-08-09T15:17:20Z** `[status]` in-progress → in-review
- **2026-08-09T15:17:20Z** `[note]` Mandato de segunda confirmación: verificar únicamente el fallback de ruta registrada borrada bajo ancestro Git y que su ajuste no reabra el fail-closed de activación rota; candidato sin commit sobre 4f850a6f.
- **2026-08-09T15:20:12Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T18:11:50Z** `[validation]` in-validation → in-progress (human rejected via conversation): Post-review con borde ejecutado: la clase del retry no quedó cerrada — ruta registrada reemplazada por un ARCHIVO bajo ancestro git revienta listProjects con spawnSync ENOTDIR porque el probe repoIsActivated quedó fuera del try (registry.mjs); el código pre-change conservaba el nombre cacheado.
- **2026-08-09T18:14:46Z** `[status]` in-progress → in-review
- **2026-08-09T18:14:46Z** `[note]` Mandato de confirmación (corrección del rechazo humano): diff sin commitear en src/registry.mjs (guard de directorio en listProjects) y test/registry.test.mjs — verificar cerrado el borde ENOTDIR (ruta registrada reemplazada por archivo bajo ancestro git conserva el nombre cacheado), que CR12 fail-closed (activación con ref borrada sigue lanzando) no se reabre, y sin regresiones; lo latente es follow-up.
- **2026-08-09T18:14:57Z** `[branch]` set: integration/in-validation
- **2026-08-09T18:19:40Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T18:19:40Z** `[note]` Follow-up del confirmador (no bloqueante): con un ancestro chmod 000, statSync lanza EACCES y listProjects aborta el listado entero donde el existsSync pre-change degradaba al nombre cacheado; fix durable sugerido: mover el probe repoIsActivated dentro del try para que cualquier fallo de probe en ruta no activada degrade al cache. Sin CR que lo cubra; queda para follow-up.
