---
id: "20260809-113242"
title: Resolver las fronteras de resolución en repos activados
type: feature
status: in-review
created: 2026-08-09T11:32:42Z
depends_on: ["20260808-151641"]
branch: feature/20260809-113242
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

## Proposal

Un único helper de autoridad de config — `loadEffectiveConfig(repoRoot,
changeledgerDir)` en `src/config.mjs` — que devuelve el config de la ref cuando
el repo está activado y el del worktree cuando no, sin cargar el repo completo
(lectura del blob `config.yml` del snapshot, patrón ya existente en
`configTarget` del viewer). Todos los callers frontera migran a él; `loadConfig`
queda como primitiva interna del camino inactivo y del propio helper.

Para los dos huecos no-config:

- `changeStatusImpl` decide por activación igual que los mutadores del CLI:
  snapshot vía el repo cargado en activo, `resolveChange` solo en inactivo.
- `changeledger commit` en activo omite la expectativa de staged bajo
  `changes_dir` y compone el marker desde el change `in-progress` del snapshot;
  en inactivo su comportamiento no cambia.

Alternativas descartadas:

- Repetir el gate `repoIsActivated` en cada caller: es el estado actual de la
  escritura del viewer y no impide que el siguiente caller vuelva a abrir la
  frontera; el helper único deja un solo sitio que auditar.
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

## Plan

- [x] Helper único de autoridad de config (`loadEffectiveConfig`) leyendo el
  blob del snapshot en activo y el worktree en inactivo
  - **Target:** `src/config.mjs`
  - **Verify:** `node --test test/config.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Migrar los callers de CLI: `register`, bootstrap de `check` y capturas
  sin id de `context`/`agent-context`
  - **Target:** `src/commands/register.mjs`, `src/commands/check.mjs`, `src/commands/context.mjs`, `src/commands/agent-context.mjs`
  - **Verify:** `node --test test/register.test.mjs test/check.test.mjs test/context.test.mjs test/agent-context.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Migrar la lectura de config del viewer y el listado del registry
  - **Target:** `src/viewer/domain.mjs`, `src/registry.mjs`
  - **Verify:** `node --test test/view.test.mjs test/registry.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Enrutar `changeStatusImpl` por activación como los mutadores del CLI
  - **Target:** `src/viewer/domain.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Adaptar el guard de staged y la composición del marker de `commit` al
  repo activado
  - **Target:** `src/commands/commit.mjs`
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-08-09T14:19:47Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T14:19:47Z`

## Log
- **2026-08-09T11:55:07Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T14:07:52Z** `[status]` approved → in-progress
- **2026-08-09T14:07:52Z** `[branch]` set: feature/20260809-113242 (auto)
- **2026-08-09T14:20:39Z** `[status]` in-progress → in-review
