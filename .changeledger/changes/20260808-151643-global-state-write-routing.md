---
id: "20260808-151643"
title: Mutaciones del ledger enrutadas al store por CAS
type: feature
status: approved
created: 2026-08-08T15:16:43Z
depends_on: ["20260808-151641", "20260808-151640"]
related_to: ["20260808-142200"]
owner: rarc88
---

## Request

Tercer y último change de la etapa 1 (spec `global-state-scope.md`): cuando
el repo está activado, toda mutación del ledger — lifecycle, Log, tasks,
owner, branch, graduación, archive, creación de changes, specs y releases —
escribe un commit en la ref de estado por compare-and-swap, dejando el
working tree intacto. Un conflicto CAS se reporta accionable y sin escritura
parcial. Sin activación, el comportamiento actual queda idéntico. Al cerrar
este change, la etapa 1 completa su gate: un repo activado opera entero
contra la ref en local.

## Investigation

Inventario verificado de todos los sitios que escriben `.changeledger/**` en
`dev`:

- **Casi todo converge ya en un choke point**: `src/atomic-write.mjs`
  (`writeFileAtomic`, `mutateFileAtomic`, `withFileLock`). Sitios por comando:
  `status`/`approve`, `review`, `validation`, `reopen`, `owner`, `branch`,
  `discard`, `archive`, `archiveGraduated`, `log`, `task` — todos
  `mutateFileAtomic` dentro de `src/commands/agent.mjs`; `graduate`/
  `skipGraduation` (`src/commands/graduate.mjs`) — `withFileLock` +
  `mutateFileAtomic` sobre la spec, `writeFileAtomic` para scaffold y
  rollback, `mutateFileAtomic` sobre el change; `fix` (`src/commands/fix.mjs`)
  — `writeFileAtomic` sobre changes y specs; `release`
  (`src/commands/release.mjs`) — `withFileLock` + `writeFileAtomic` sobre
  `releases/`.
- **La excepción es `new`**: `newChange` (`src/commands/new.mjs`) escribe con
  `fs.writeFileSync(file, …, { flag: 'wx' })` crudo y un lock propio de
  reserva de id (`acquireIdLock`/`releaseIdLock`), distinto de
  `withFileLock`. En modo activo la unicidad del id la garantiza el propio
  CAS (dos `new` concurrentes: uno avanza la ref, el otro recibe conflicto y
  reintenta con id fresco); en modo inactivo su mecánica actual no se toca.
- **Las escrituras del viewer re-entran en el CLI**: `changeStatusImpl` y
  compañía (`src/viewer/domain.mjs`) llaman a las funciones de
  `src/commands/agent.mjs` — cubiertas por el mismo enrutado sin trabajo
  propio. Las escrituras de config del viewer (`saveProjectConfigImpl`,
  `patchProjectConfigImpl`, `applyConfigMigrationImpl`) mutan
  `config.yml` vía `mutateFileAtomic` inyectable como parámetro — y
  `config.yml` es parte del árbol de estado, así que en modo activo deben ir
  al store o la lectura del snapshot (`20260808-151641`, CR4) divergiría de
  la escritura en el primer save.
- **Fuera de alcance, con razón**: `init` (scaffolding de un repo nuevo,
  siempre inactivo por definición), `register`/`registry` (estado global de
  `~/.changeledger`, no es ledger del repo), `contract.mjs`
  (`ensureReference` mantiene AGENTS.md, no es ledger), y `config migrate`
  sobre repos inactivos.
- **La costura de lectura ya entrega el CAS**: `loadRepo` en modo activo
  expone `state.revision` (`20260808-151641`); cada comando mutador ya carga
  el repo o localiza el documento antes de escribir, así que la revisión
  esperada viaja sin parámetro nuevo en las firmas públicas.
- **Transaccionalidad que el filesystem no daba**: `graduate` hoy escribe
  spec y change en dos operaciones con rollback manual a mano
  (`writeFileAtomic` de reversa en `graduate.mjs`); en el store ambos
  documentos entran en **un** commit CAS — el rollback manual desaparece en
  modo activo en lugar de replicarse.

Clasificación: `20260808-151641` es prerequisito de ejecución (`depends_on`,
y transitivamente `20260808-151640`); `20260808-142200` es la spec rectora
(`related_to`).

## Proposal

Una costura de mutación única y la conversión mecánica de todos los sitios.

- **`src/change-store.mjs`** (nuevo, nombre corto deliberado):
  `mutateLedgerFile(repo, relPath, mutate)` y
  `writeLedgerFiles(repo, entries, { message })` — deciden por
  `repo.state`: inactivo → `mutateFileAtomic`/`writeFileAtomic` actuales;
  activo → `mutateState` del store con `expectedRevision:
  repo.state.revision`, mapeando la ruta del worktree a la ruta del árbol
  (`changes/…`, `specs/…`, `releases/…`, `config.yml`).
- **Conversión de sitios**: los once mutadores de `agent.mjs`, `graduate.mjs`
  (spec+change en un solo commit en modo activo, rollback manual solo en modo
  inactivo), `fix.mjs` (una invocación = un commit), `release.mjs`, las tres
  escrituras de config del viewer, y `new.mjs` (en activo: documento nuevo
  vía `writeLedgerFiles`, unicidad de id por CAS con un reintento de id
  fresco ante conflicto; en inactivo: mecánica actual intacta).
- **Conflicto CAS en el CLI**: `LedgerConflictError` se presenta como error
  accionable — `"state changed since load — re-run the command"` — con exit
  distinto de cero y sin escritura parcial (garantía del store, no del
  caller).
- **Mensaje de commit del store**: `<comando>: <id-o-ruta>` (p. ej.
  `status: 20260808-151640 → in-progress`), suficiente para auditar la ref
  con `git log`.
- `.changeledger/specs/architecture.md` gana la sección de la costura de
  escritura (graduación al cierre).

### Alternativas descartadas

- **Retry automático del CAS dentro de la costura**: releer y reintentar en
  silencio puede reaplicar una decisión sobre un documento que cambió
  semánticamente entre lecturas; el conflicto se reporta y el que reintenta
  es el caller humano o agente, con la verdad fresca delante. Excepción
  acotada: el reintento de id fresco en `new`, donde el documento es nuevo
  por construcción y no hay decisión previa que invalidar.
- **Enrutar dentro de `atomic-write.mjs`**: ese módulo es genérico de
  filesystem (lo usa también el registry global); dar semántica de ledger a
  su capa rompería la separación y arrastraría el registry al store.
- **Excluir las escrituras de config del viewer**: divergiría de la lectura
  (`20260808-151641` CR4) en el primer save sobre un repo activo; incluirlas
  es más barato que documentar la incoherencia.

## Specification

### CR1 — Una transición sobre repo activado escribe en la ref, no en el worktree
- **Given** un repo activado cuyo snapshot contiene un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** la ref de estado avanza un commit y el snapshot resultante
  contiene el change en `in-progress` con su evento `[status]`
- **And** `git status --porcelain` del working tree queda vacío

### CR2 — El conflicto CAS es accionable y no deja escritura parcial
- **Given** un comando mutador que cargó el repo en la revisión `S1`, y la
  ref avanzada a `S2` antes de su escritura
- **When** el comando intenta escribir
- **Then** termina con exit distinto de cero y stderr contiene
  `state changed since load — re-run the command`
- **And** la ref sigue en `S2` y su snapshot no contiene rastro de la
  escritura fallida

### CR3 — Sin activación, cada mutador conserva su comportamiento actual
- **Given** un fixture inactivo (sin git) con un change `approved`
- **When** se ejecuta la batería actual de mutadores (`status`, `log`,
  `task`, `owner`, `branch`, `discard`, `archive`, `graduate`, `fix`)
- **Then** los tests existentes de esos comandos pasan sin modificación de
  expectativas (mismos archivos escritos en el worktree)

### CR4 — `new` sobre repo activado crea el documento en la ref
- **Given** un repo activado
- **When** se ejecuta `changeledger new feature x-slug "Título"`
- **Then** el snapshot contiene `changes/<id>-x-slug.md` con el scaffold
- **And** el working tree no contiene el archivo
- **And** dos `new` concurrentes simulados (segundo con revisión rancia)
  terminan ambos con éxito y con ids distintos

### CR5 — `graduate` sobre repo activado es un solo commit atómico
- **Given** un repo activado con un change `done` pendiente de graduación y
  una spec existente
- **When** se ejecuta `changeledger graduate <id> <spec> --into`
- **Then** la ref avanza exactamente un commit cuyo snapshot contiene la spec
  actualizada (frontmatter `graduated_from` incluye el id) y el change con su
  evento `[graduation]`
- **And** no existe ningún estado intermedio con solo una de las dos
  escrituras

### CR6 — El config del viewer escribe donde la lectura lee
- **Given** un repo activado servido por el viewer
- **When** se guarda el config del proyecto por la ruta del viewer
  (`saveProjectConfig`)
- **Then** la ref avanza y el `config.yml` del snapshot contiene el cambio
- **And** el `.changeledger/config.yml` del worktree queda intacto

### CR7 — Ninguna identidad desaparece a través de la costura
- **Given** un repo activado y cualquier comando mutador de la batería de CR3
- **When** la mutación se aplica
- **Then** toda identidad presente en el snapshot padre sigue presente en el
  hijo (la integridad de `20260808-151640` CR9 corre en cada mutación de la
  costura, verificado con un test que intenta un candidato que perdería un
  documento y falla)

## Plan

- [ ] Test primero: `change-store.mjs` con `mutateLedgerFile`/
      `writeLedgerFiles` decidiendo por `repo.state`, y mapeo de rutas
      worktree↔árbol
  - **Target:** `src/change-store.mjs`
  - **Verify:** `node --test test/change-store.test.mjs`
  - **Criteria:** CR1, CR2, CR7
- [ ] Convertir los mutadores de `agent.mjs` a la costura
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] Convertir `graduate.mjs` (un commit atómico en activo; rollback manual
      solo en inactivo) y `fix.mjs` (una invocación, un commit)
  - **Target:** `src/commands/graduate.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR3, CR5, CR7
- [ ] Convertir `new.mjs` (CAS como unicidad de id en activo, reintento de id
      fresco) y `release.mjs`
  - **Target:** `src/commands/new.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR3, CR4
- [ ] Convertir las escrituras de config del viewer
      (`saveProjectConfigImpl`, `patchProjectConfigImpl`,
      `applyConfigMigrationImpl`)
  - **Target:** `src/viewer/domain.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR6
- [ ] Presentación del conflicto CAS en el bin (mensaje accionable, exit ≠ 0)
  - **Target:** `bin/changeledger.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR2
- [ ] Sección de la costura de escritura en
      `.changeledger/specs/architecture.md` (graduación al cierre)
  - **Target:** `.changeledger/specs/architecture.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Support:**
- [ ] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**

## Log

- **2026-08-08T15:16:43Z** `[note]` Draft creado sobre el inventario
  verificado de sitios de escritura: casi todo converge ya en
  `atomic-write.mjs` (la costura se decide una vez), con `new` como única
  excepción de mecánica propia (su lock de id se sustituye por el CAS en modo
  activo) y las escrituras de config del viewer incluidas para no divergir de
  la lectura del snapshot. Cierra el gate de la etapa 1: repo activado
  operando entero contra la ref en local.
- **2026-08-08T16:04:16Z** `[status]` draft → approved (human via conversation)
