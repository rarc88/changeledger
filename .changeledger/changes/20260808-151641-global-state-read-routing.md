---
id: "20260808-151641"
title: Lectura del ledger enrutada al snapshot del store
type: feature
status: draft
created: 2026-08-08T15:16:41Z
depends_on: ["20260808-151640"]
related_to: ["20260808-142200"]
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
- **El viewer no tiene camino de lectura propio**: `router.mjs` llama
  `loadRepoAsync` por proyecto (`resolveProjects` en `domain.mjs` decide qué
  directorio), y las escrituras del viewer re-entran en las funciones del CLI
  (`applyStatusCmd`/`applyValidation`/`applyReopen` importadas de
  `src/commands/agent.mjs`). No hay segunda verdad que reconciliar.
- **El descubrimiento sigue anclado al worktree**: `findChangeledgerDir`
  (`src/config.mjs`) localiza el repo por la existencia de
  `.changeledger/config.yml` como archivo. Ese ancla no cambia en la etapa 1:
  la activación se consulta después de descubrir el repo, con
  `readActivation` de `20260808-151640` (que es `null` sin coste apreciable
  en repos no activados y en directorios que no son repos git — ausencia
  definitiva, no fallo).
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
    disco, mismo objeto resultado, sin ejecutar ningún subproceso git.
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

## Plan

- [ ] Test primero: fixture activado/no activado sobre el helper de
      `20260808-151640`, y enrutado en `loadRepoWithConfig` con `state:
      { revision }` en el resultado
  - **Target:** `src/repo.mjs`
  - **Verify:** `node --test test/repo.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Test de integración del viewer sobre el router (misma verdad, mismo
      resolver)
  - **Target:** `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
- [ ] Test de integración CLI (`list`, `search`) sobre repo activado
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR6
- [ ] Documentar el resolver único y la frontera de config en
      `.changeledger/specs/architecture.md` (graduación al cierre)
  - **Target:** `.changeledger/specs/architecture.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Support:**
- [ ] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**

## Log

- **2026-08-08T15:16:41Z** `[note]` Draft creado sobre el mapa verificado de
  la superficie de lectura: `loadRepo`/`loadRepoAsync`/`loadRepoWithConfig`
  es el único camino de lectura de CLI y viewer, así que el "mismo resolver"
  de la spec se implementa en un solo punto. La frontera de config (callers
  pre-load siguen en worktree hasta el cutover de etapa 2) queda declarada en
  Investigation a propósito.
