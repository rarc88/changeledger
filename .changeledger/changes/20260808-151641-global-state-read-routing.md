---
id: "20260808-151641"
title: Lectura del ledger enrutada al snapshot del store
type: feature
status: done
created: 2026-08-08T15:16:41Z
depends_on: ["20260808-151640"]
reviewed: true
branch: feature/20260808-151641
related_to: ["20260808-142200", "20260808-151643"]
owner: rarc88
---

## Request

Segundo change de la etapa 1 (spec `global-state-scope.md`): cuando el repo
está activado, toda lectura del ledger — CLI y viewer — se sirve del snapshot
de la ref de estado en lugar del working tree, por el mismo resolver. Cuando
no está activado, el comportamiento es idéntico al actual, byte a byte. Un
repo activado cuya ref no puede leerse falla explícito: nunca degrada en
silencio al worktree.

## Investigation

Mapa verificado de la superficie de lectura en `dev`:

- **`loadRepo` es el choke point real.** `loadRepo(start)` en `src/repo.mjs`
  hace `findChangeledgerDir → loadConfig → loadRepoWithConfig`, y
  `loadRepoWithConfig` lee de disco `changes_dir` (cada `*.md` con
  `parseChange`), `specs_dir` (`parseSpec`) y releases (`loadReleases` de
  `src/release.mjs`). Su gemela async `loadRepoAsync` (misma forma, más
  `changeErrors`) sirve al viewer. Callers de la familia: `src/viewer/domain.mjs`
  (`searchProjects`, config previews con `loadRepoWithConfig`),
  `src/viewer/server/router.mjs` (`loadRepoAsync`),
  `src/commands/context.mjs`, `src/commands/fix.mjs`,
  `src/commands/release.mjs`, `src/commands/agent.mjs`,
  `src/commands/commit.mjs`, `src/commands/check.mjs`,
  `src/commands/search.mjs`. Enrutar dentro de la familia `loadRepo*` cubre
  CLI y viewer a la vez — el "mismo resolver" que exige la spec sale gratis
  del diseño actual.
- **Corrección post-review — `resolveChange` es una segunda vía de lectura.**
  La afirmación original "loadRepo es el choke point real" era incompleta:
  `resolveChange` (`src/repo.mjs`) lee `changes_dir` de disco directamente,
  sin pasar por `loadRepo`, y lo consumen `context.mjs`, `agent-context.mjs`,
  `agent.mjs` y `viewer/domain.mjs`. Por decisión humana (2026-08-08) sus
  consumidores de **solo lectura** (context, agent-context) se enrutan en
  este change (CR7); los usos que localizan el archivo a **mutar** pertenecen
  a `20260808-151643` y quedan como frontera declarada, igual que el preview
  de config del viewer (`loadRepoWithConfig` con candidato), que en modo
  activo ignora el candidato y se resuelve en el change de escritura.
- **El viewer no tiene camino de lectura propio**: `router.mjs` llama
  `loadRepoAsync` por proyecto (`resolveProjects` en `domain.mjs` decide qué
  directorio), y las escrituras del viewer re-entran en las funciones del CLI
  (`applyStatusCmd`/`applyValidation`/`applyReopen` importadas de
  `src/commands/agent.mjs`). No hay segunda verdad que reconciliar.
- **El descubrimiento sigue anclado al worktree**: `findChangeledgerDir`
  (`src/config.mjs`) localiza el repo por la existencia de
  `.changeledger/config.yml` como archivo. Ese ancla no cambia en la etapa 1:
  la activación se consulta después de descubrir el repo, con
  `readActivation` de `20260808-151640`. **Corrección post-review**: la
  premisa original de este párrafo era falsa — `readActivation` **lanza** en
  un directorio que no es repo git (fail-closed), no devuelve `null`; y
  `repoRoot` (el directorio que contiene `.changeledger/`) puede vivir por
  debajo del top-level de git, topología ya soportada por `commit()` en
  `src/git.mjs`. La detección de "no hay git" no puede ser una heurística de
  filesystem sobre `repoRoot/.git`: eso oculta activaciones vivas y degrada a
  legacy en silencio.
- **Config dentro del snapshot**: el árbol de estado porta `config.yml`
  (`20260808-151640`). Cuando el repo está activo, el `repo.config` que
  entrega `loadRepo*` debe salir del snapshot — servir documentos de la ref
  con config del worktree sería exactamente la lectura de autoridad cruzada
  que hundió a la v1 de esta capacidad. **Frontera explícita**: los callers
  que cargan config directamente *antes* de cargar el repo
  (`findChangeledgerDir`+`loadConfig` en `new`, `register`, `agent-context`,
  `check` bootstrap) siguen leyendo el worktree en esta etapa; hasta el
  cutover (etapa 2) ambos config nacen idénticos, y la etapa 2 resuelve la
  autoridad final al migrar. Se deja constancia aquí para que la revisión de
  la etapa 2 lo encuentre declarado, no descubierto.
- **Los tests actuales de `loadRepo`** (`test/repo.test.mjs`) construyen
  fixtures con `fs.mkdtempSync` sin `git init`: el camino inactivo debe
  seguir funcionando en directorios que no son repos git — hoy `loadRepo`
  funciona sin git y eso no puede romperse.
- **Degradación silenciosa, la clase a cerrar**: en v2, revertir la autoridad
  local hacía servir verdad vieja del worktree con exit 0 (su change
  `20260722-202057`). El equivalente aquí: activación presente + ref de
  estado ilegible o ausente → error, jamás fallback.

Clasificación: `20260808-151640` es prerequisito de ejecución
(`depends_on`); `20260808-142200` es la spec rectora (`related_to`).

## Proposal

El enrutado vive dentro de la familia `loadRepo*` en `src/repo.mjs`; ningún
caller cambia de firma.

- `loadRepoWithConfig` (y por tanto `loadRepo`/`loadRepoAsync`) consulta
  `readActivation(repoRoot)` tras el descubrimiento:
  - **Sin activación** (`null`): camino actual intacto — mismas lecturas de
    disco, mismo objeto resultado; en un directorio sin repositorio git no se
    ejecuta ningún subproceso (CR1), y en un repo git la consulta de
    activación es la única llamada añadida.
  - **Con activación**: `readSnapshot` de la ref declarada; `changes`,
    `specs`, `releases` y `config` se construyen desde los documentos del
    snapshot (mismos parsers `parseChange`/`parseSpec` actuales); el objeto
    resultado gana `state: { revision }` — la costura que el change de
    escritura de esta etapa usará como `expectedRevision` del CAS. En modo
    inactivo `state` es `null`.
  - **Activación presente pero ref ilegible/ausente**: se propaga el error
    del store (`readStateRef`/`readSnapshot` son fail-closed por
    `20260808-151640`); explícitamente no hay fallback al worktree.
- El viewer no requiere trabajo propio (comparte `loadRepoAsync`); se añade
  un test de integración que lo demuestra en lugar de asumirlo.
- `.changeledger/specs/architecture.md` documenta el resolver único y la
  frontera de config declarada en Investigation (graduación al cierre).

### Alternativas descartadas

- **Enrutar caller por caller** (context, fix, agent, viewer…): multiplica
  los puntos de divergencia y repite la lectura de autoridad cruzada de v1;
  el choke point ya existe.
- **Fallback silencioso al worktree cuando la ref no se puede leer**: es la
  clase de degradación silenciosa pagada en v2; prohibida por la spec
  (fail-closed).
- **Cachear el snapshot entre llamadas**: optimización sin problema observado
  que introduce invalidación; `git-batch` ya acota el coste por lectura.

## Specification

### CR1 — Un repo sin activación se comporta idéntico, sin git
- **Given** un fixture de repo construido con `mkdtemp` y **sin** `git init`,
  con un change y una spec en el worktree
- **When** se ejecuta `loadRepo(fixture)`
- **Then** devuelve los mismos changes, specs, releases y config que hoy, con
  `state: null`
- **And** ningún subproceso git se ejecuta en esa llamada (runner inyectado
  que falla si se invoca)

### CR2 — Un repo activado sirve los documentos del snapshot
- **Given** un repo git con activación escrita
  (`writeActivation`), la ref de estado conteniendo `changes/only-ref.md`, y
  un `changes/only-worktree.md` presente solo en el working tree
- **When** se ejecuta `loadRepo(root)`
- **Then** el resultado contiene el change `only-ref` con el contenido del
  snapshot
- **And** no contiene `only-worktree`
- **And** `state.revision` es el OID del commit de la ref

### CR3 — Activación con ref ilegible falla explícito, sin fallback
- **Given** un repo con activación escrita pero sin la ref de estado (o con
  la ref apuntando a un objeto no-commit)
- **When** se ejecuta `loadRepo(root)`
- **Then** lanza el error fail-closed del store nombrando la causa
- **And** ningún documento del worktree aparece como resultado

### CR4 — El config activo sale del snapshot
- **Given** un repo activado cuyo `config.yml` del snapshot declara
  `language: en` y cuyo `.changeledger/config.yml` del worktree declara
  `language: es`
- **When** se ejecuta `loadRepo(root)`
- **Then** `repo.config.language` es `'en'`

### CR5 — El viewer sirve la misma verdad por el mismo resolver
- **Given** el repo activado de CR2 servido por el router del viewer
- **When** se solicita el listado de changes del proyecto
  (`loadRepoAsync` vía la ruta del router)
- **Then** la respuesta contiene `only-ref` y no contiene `only-worktree`

### CR6 — Los comandos de lectura del CLI atraviesan el mismo enrutado
- **Given** el repo activado de CR2
- **When** se ejecuta `changeledger list` y `changeledger search only-ref`
- **Then** ambos reportan el change `only-ref`
- **And** ninguno reporta `only-worktree`

### CR7 — context y agent-context leen del snapshot en repos activados
- **Given** el repo activado de CR2 (`only-ref` en el snapshot,
  `only-worktree` solo en el working tree)
- **When** se ejecuta `changeledger context <id-de-only-ref>` y
  `changeledger agent-context implementation <id-de-only-ref>`
- **Then** ambos emiten su capsula con el documento del snapshot
- **And** `changeledger context <id-de-only-worktree>` falla nombrando el
  change como desconocido

### CR8 — Un ledger por debajo del top-level de git no degrada en silencio
- **Given** un repo git cuyo `.changeledger/` vive en un subdirectorio del
  top-level, con activación escrita y `changes/only-ref.md` en el snapshot
- **When** se ejecuta `loadRepo(<subdirectorio>)`
- **Then** el resultado sirve `only-ref` desde el snapshot con
  `state.revision` presente
- **And** ningún documento del worktree aparece como resultado

## Plan

- [x] Test primero: fixture activado/no activado sobre el helper de
      `20260808-151640`, y enrutado en `loadRepoWithConfig` con `state:
      { revision }` en el resultado
  - **Target:** `src/repo.mjs`
  - **Verify:** `node --test test/repo.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-08-08T17:27:13Z`
- [x] Test de integración del viewer sobre el router (misma verdad, mismo
      resolver)
  - **Target:** `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-08-08T17:27:13Z`
- [x] Test de integración CLI (`list`, `search`) sobre repo activado
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-08T17:27:13Z`
- [x] Documentar el resolver único y la frontera de config en
      `.changeledger/specs/architecture.md` (graduación al cierre)
  - **Target:** `.changeledger/specs/architecture.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Support:**
  - **Resolved:** `2026-08-08T17:27:13Z`
- [x] Corrección post-review: sustituir la heurística `fs.existsSync(.git)`
      por una detección que no oculte activaciones (git decide, no el
      filesystem) con fixture de ledger bajo subdirectorio
  - **Target:** `src/repo.mjs`
  - **Verify:** `node --test test/repo.test.mjs`
  - **Criteria:** CR1, CR8
  - **Resolved:** `2026-08-08T18:00:50Z`
- [x] Corrección post-review: enrutar los consumidores de solo lectura de
      `resolveChange` (context, agent-context) al snapshot en repos activados
  - **Target:** `src/commands/context.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-08-08T18:00:50Z`
- [x] Corrección post-confirmación (R1): los caminos sin change-id de
      context/agent-context no cargan el repo completo — byte-idénticos al
      comportamiento previo ante documentos malformados
  - **Target:** `src/commands/context.mjs`
  - **Verify:** `node --test test/context.test.mjs test/agent-context.test.mjs`
  - **Support:**
  - **Resolved:** `2026-08-08T18:21:42Z`
- [x] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-08-08T17:27:14Z`

## Log

- **2026-08-08T15:16:41Z** `[note]` Draft creado sobre el mapa verificado de
  la superficie de lectura: `loadRepo`/`loadRepoAsync`/`loadRepoWithConfig`
  es el único camino de lectura de CLI y viewer, así que el "mismo resolver"
  de la spec se implementa en un solo punto. La frontera de config (callers
  pre-load siguen en worktree hasta el cutover de etapa 2) queda declarada en
  Investigation a propósito.
- **2026-08-08T16:03:43Z** `[status]` draft → approved (human via conversation)
- **2026-08-08T17:14:16Z** `[status]` approved → in-progress
- **2026-08-08T17:14:16Z** `[branch]` set: feature/20260808-151641 (auto)
- **2026-08-08T17:27:14Z** `[status]` in-progress → in-review
- **2026-08-08T17:27:54Z** `[note]` Review mandate: auditoría completa del diff del change (baseline..HEAD) contra CR1-CR6 y el Plan, con foco declarado en (1) hasGitDirectory por fs.existsSync — riesgo de reintroducir la heurística de filesystem purgada del store y de degradación silenciosa a legacy si repoRoot no es el top-level de git; (2) que el modo activo no tenga ningún camino de fallback al worktree; (3) las tres decisiones no especificadas del implementador (file:null, config-preview inútil en repos activos, topologías de worktree).
- **2026-08-08T17:35:51Z** `[review]` in-review → blocked: Defecto confirmado corregible: hasGitDirectory (fs.existsSync) degrada en silencio a legacy un repo con .changeledger por debajo del git root — topología ya soportada por commit() en src/git.mjs — reintroduciendo la heurística purgada del store; la premisa de la Investigation (readActivation devuelve null en dirs no-git) es falsa: lanza. Y hallazgo material fuera de mandato que exige decisión humana de alcance: resolveChange (src/repo.mjs) es una segunda vía de lectura no enrutada — context/agent-context sirven fantasmas del worktree en repos activados y mezclan config del snapshot con documento del worktree, la lectura de autoridad cruzada de v1. Decidir si esos consumidores de solo lectura entran en la corrección de este change o quedan como frontera declarada de la etapa/change de escritura.
- **2026-08-08T17:48:50Z** `[status]` blocked → in-progress
- **2026-08-08T17:48:50Z** `[note]` Decisión humana (Roberto, 2026-08-08, conversación): la corrección enruta también los consumidores de solo lectura de resolveChange (context, agent-context) — el Request dice 'toda lectura' y se honra; los usos de resolveChange que localizan archivos para mutar pertenecen a 20260808-151643 y quedan como frontera declarada. Se añaden CR7 y CR8 (estrictamente más fuertes: nuevos requisitos, ninguno debilitado) y se corrige la premisa falsa de la Investigation: readActivation lanza en directorios no-git, no devuelve null.
- **2026-08-08T18:00:50Z** `[status]` in-progress → in-review
- **2026-08-08T18:07:36Z** `[review]` in-review → in-progress (retry): R1: buildContext/buildAgentContext cargan el repo entero incondicionalmente y un change malformado ahora hace fallar los caminos sin change-id (context core/mode, agent-context investigation) que antes salían 0 — rompe el 'byte a byte' del Request y deniega el bootstrap del contrato; solo el camino con change-id necesita repo.changes. R2: architecture.md aún describe la heurística existsSync eliminada, lista agent-context como caller pre-load de config del worktree (ya no) y no documenta resolveChangeInRepo ni la frontera de mutadores — graduaría verdad falsa.
- **2026-08-08T18:14:16Z** `[status]` in-progress → in-review
- **2026-08-08T18:21:42Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-08T18:22:17Z** `[note]` Confirmación (2ª ronda) en pass con byte-identidad probada contra ccbb1148. Bookkeeping post-veredicto del orquestador, disclosed: tarea de Plan añadida para la corrección R1 (el trabajo existía sin tarea), y la enumeración de mutadores de architecture.md completada con graduate.mjs (follow-up 1 del revisor). Follow-ups no bloqueantes que quedan registrados sin acción: diagnóstico menos útil para id desconocido cuando coexiste un doc malformado (ambos exit!=0), y registry.mjs carga config fuera de la familia loadRepo (preexistente, no introducido aquí).
- **2026-08-08T22:12:17Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-08T22:12:17Z** `[graduation]` spec: `architecture.md`
