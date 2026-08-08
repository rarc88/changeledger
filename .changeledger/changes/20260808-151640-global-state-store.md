---
id: "20260808-151640"
title: "Store local del estado global: ref fija, snapshot y CAS"
type: feature
status: draft
created: 2026-08-08T15:16:40Z
depends_on: []
related_to: ["20260808-142200"]
owner: rarc88
---

## Request

Primer change de la etapa 1 del estado global
(spec `global-state-scope.md`): el módulo puro del store, sin integración con
CLI ni viewer. Debe entregar la ref fija que contiene el ledger completo como
árbol exclusivo, lectura de snapshot sin checkout, mutación por
compare-and-swap, la primitiva de activación de bajo nivel, y la integridad
client-side fail-closed — con el catálogo de defectos pagado por la v2 como
tests desde el día uno. Nada de red, sync, migración ni validación server-side.

## Investigation

Inventario del núcleo rescatable en `codex/state-replica-v2` (leído con
`git show`, la rama se conserva como fuente):

- **`src/git-batch.mjs` (v2) es reutilizable tal cual**: `treeEntries` (un solo
  `ls-tree -r -z --full-tree`), `batchBlobReader` (tamaños por
  `cat-file --batch-check`, lecturas por lotes acotadas por `GIT_MAX_BUFFER`,
  validación UTF-8 estricta con `isUtf8` antes de decodificar) y
  `assertRegularBlobEntry`. Su único acople es `GIT_MAX_BUFFER` de
  `src/git.mjs`. Es la primitiva de "leer el árbol sin checkout".
- **Del `state-store.mjs` de v2 no sobrevive ningún export tal cual** — todos
  hablan el modelo confirmed/observed/pending o tocan remotos, ambos fuera del
  techo. Lo rescatable son internos: `transaction()` (CAS multi-ref vía
  `git update-ref --stdin`), el patrón `classifiedTip`/assert-por-tipo, y los
  helpers de subproceso.
- **Del `ledger-store.mjs` de v2, la rama no-replica es el molde**: carga de
  snapshot (`loadStateTree`/`loadStateSnapshotAt` sobre git-batch),
  `statePathIsValid` (layout exclusivo del árbol), construcción del candidato
  con índice temporal (`read-tree`/`update-index`/`write-tree`/`commit-tree`
  vía `runIndexedGit`), commit por `update-ref` con revisión esperada,
  `LedgerConflictError`, y la integridad `snapshotIdentities`/
  `assertNoDisappearance`. El walk completo de rangos
  (`assertIdentityContinuity`) fue construido para confirmación multi-writer
  del modelo replica: en un store lineal de un solo CAS se simplifica a
  comparar padre contra candidato en cada mutación.
- **Layout del árbol probado en v2** (validado por `statePathIsValid`):
  `.changeledger-state/{manifest.yml, config.yml, changes/*.md, specs/*.md,
  releases/*.yml}`. El manifest de v2 traía `inventory_digest` y
  `minimum_client_version` — ambos conceptos de enforcement/migración,
  excluidos por la spec; queda `format_version` y `project_id`.
- **Activación (lección de v2, su change `20260723-202646`)**: la autoridad no
  puede vivir en un archivo del working tree — cambiar de rama o borrarlo
  degradaba a modo legacy en silencio. El mecanismo checkout-independiente de
  v2: `refs/changeledger/activation` (ref fuera de `refs/heads`, compartida
  entre worktrees) apuntando a un commit cuyo árbol porta la autoridad. La
  primitiva mínima para la etapa 1 — sin UX de adopción, que es etapa 2 — es
  ese par lectura/escritura de la ref de activación; los modos
  prepare/install/deactivate de v2 son capa de adopción y quedan fuera.
- **Catálogo de defectos de v2 aplicable al núcleo local** (cada clase entra
  como test de día uno; los ids citados son de la rama v2): refs que resuelven
  a objetos no-commit aceptadas por peel silencioso (`20260725-104052`,
  `20260724-212722`, `20260723-235910` — cierre de clase:
  `assertCommitObject`, que **no existe hoy en dev** y se porta); fidelidad
  UTF-8 — leer un blob no-UTF-8 como texto lo transcodifica a U+FFFD y cambia
  su OID al re-hashear (`20260722-163405`); entradas de árbol no regulares
  (symlink/gitlink) aceptadas asimétricamente entre crear y validar
  (`20260723-170612`); fallo de lectura de ref confundido con ausencia de ref
  (`20260723-235906`); desaparición silenciosa de un documento entre fotos
  (`20260722-202058`); autoridad dependiente del checkout (`20260723-202646`).
- **Ya cerrado en dev, se reutiliza**: `sanitizedEnv()` en `src/git.mjs` fija
  `LC_ALL=C` y elimina las variables `GIT_*` de ubicación (la clase de locale
  de v2 no necesita trabajo nuevo aquí); `defaultRun` ignora stderr — para
  lecturas fail-closed que deben distinguir fallo de ausencia, el store
  necesita la variante que captura stderr (existe en el mismo módulo para
  comandos mutadores) o su equivalente.
- **Patrón de fixtures probado en v2**: `test/helpers/state-repo.mjs` crea un
  repo git temporal real (con `--object-format=sha256` opcional), rama
  huérfana con el árbol `.changeledger-state/*` y builders de config/changes
  válidos. Se porta adaptado (sin `authority.yml` de worktree, que era el
  modelo previo a la activación checkout-independiente). Los tests actuales
  del repo no usan git en fixtures salvo `test/git.test.mjs` y
  `test/commit.test.mjs` (vía `execFileSync('git', ...)`): el precedente de
  "tests con git real" ya existe.

Clasificación de relaciones: `20260808-142200` (la spec del techo) es contexto
rector, no prerequisito de ejecución — `related_to`. Los ids `2026072x-*`
citados arriba viven solo en la rama v2, no en este ledger: se citan como
texto, no como relación.

## Proposal

Dos módulos nuevos y un helper de tests; ningún cambio de comportamiento
observable fuera de ellos (CLI, viewer y `loadRepo` intactos hasta los
changes de lectura y escritura que completan la etapa 1, que dependen de
este).

- **`src/git-batch.mjs`**: port del de v2 (treeEntries, batchBlobReader,
  assertRegularBlobEntry) con sus tests de lotes, tamaño y UTF-8.
- **`src/state-store.mjs`** (nuevo, el núcleo local):
  - Constantes: `STATE_REF = 'refs/heads/changeledger/state'`,
    `ACTIVATION_REF = 'refs/changeledger/activation'`,
    `STATE_ROOT = '.changeledger-state'`, `STATE_SCHEMA_VERSION = 1`.
  - `assertCommitObject(repoRoot, ref)` — portado a `src/git.mjs` como cierre
    de clase: resuelve y **verifica el tipo con `cat-file -t`**, nunca peel
    (`^{commit}`) silencioso; error `"<ref> resolves to a <type>, not a
    commit"`.
  - `readStateRef(repoRoot)` — fail-closed: devuelve `null` solo cuando la ref
    **no existe** (o el directorio no es un repo git, ausencia definitiva);
    cualquier otro fallo del subproceso lanza con el stderr de git en el
    mensaje. Distinguir ausencia de fallo es una clase del catálogo.
  - `initState(repoRoot, { projectId, config })` — crea el commit raíz
    (manifest + config) y la ref por CAS desde cero; falla si la ref ya
    existe. No toca el working tree.
  - `readSnapshot(repoRoot, { revision })` — carga el árbol completo vía
    git-batch, valida layout (`statePathIsValid`) y modos regulares, devuelve
    `{ revision, manifest, config, documents }` con contenido byte-idéntico;
    blob no-UTF-8 → error con la ruta, nunca U+FFFD.
  - `mutateState(repoRoot, { expectedRevision, message }, (stage) => …)` —
    `stage.write(relPath, text)` / `stage.remove(relPath)`; construye el árbol
    candidato con índice temporal, aplica la integridad (toda identidad del
    padre ausente en el candidato debe corresponder a un `remove` explícito),
    commit con parent `expectedRevision` y avance de ref por CAS
    (`update-ref` con old-value). Conflicto →
    `LedgerConflictError("state ref moved: expected <oid>, found <oid> —
    reload and retry")` sin dejar la ref movida. Una mutación sin diff no crea
    commit.
  - `readActivation(repoRoot)` / `writeActivation(repoRoot, { stateRef })` —
    la primitiva de bajo nivel: la ref de activación apunta a un commit cuyo
    árbol porta `authority.yml` con `format_version` y `state_ref`; la lectura
    aplica `assertCommitObject` y es fail-closed. Sin comando CLI en este
    change: la etapa 2 le pone la UX de adopción encima.
- **`test/helpers/state-repo.mjs`**: port adaptado del fixture de v2 (repo git
  temporal real, SHA-1 y SHA-256, árbol de estado sembrado).

### Alternativas descartadas

- **Rescatar también la fachada con receipts (`ledgerReceipt` de v2)**: sin
  sync ni frescura divergente en la etapa 1, el receipt colapsa a constantes;
  lo necesita la etapa 3 y se decide allí.
- **Guardar la activación en `config.yml`**: huevo y gallina — el
  descubrimiento del repo (`findChangeledgerDir`, `src/config.mjs`) depende de
  la existencia de ese archivo en el worktree, y la autoridad volvería a
  depender del checkout: la clase exacta que v2 pagó por descubrir.
- **Walk de continuidad por rango de commits** (v2): maquinaria de
  confirmación multi-writer del modelo replica; en un store lineal basta
  padre-contra-candidato por mutación.

## Specification

### CR1 — Inicializar el store crea la ref con el layout completo
- **Given** un repo git temporal sin `refs/heads/changeledger/state`
- **When** se ejecuta `initState(root, { projectId: 'demo' })`
- **Then** `git rev-parse refs/heads/changeledger/state` resuelve a un commit
  cuyo árbol contiene `.changeledger-state/manifest.yml` con
  `format_version: 1` y `project_id: demo`
- **And** `git status --porcelain` del working tree queda vacío
- **And** un segundo `initState` sobre el mismo repo lanza error sin mover la
  ref

### CR2 — El snapshot se lee sin checkout y byte-idéntico
- **Given** la ref de estado con un change, una spec y un release sembrados
  con contenido conocido que incluye caracteres multibyte
- **When** se ejecuta `readSnapshot(root)`
- **Then** devuelve los tres documentos con contenido byte-idéntico al
  sembrado y `revision` igual al OID del commit de la ref
- **And** el working tree no contiene ninguno de esos archivos

### CR3 — La mutación CAS avanza la ref con parent correcto
- **Given** un snapshot leído en la revisión `S1`
- **When** se ejecuta `mutateState(root, { expectedRevision: S1, message },
  (stage) => stage.write('changes/x.md', texto))`
- **Then** la ref avanza a un commit `S2` cuyo único parent es `S1`
- **And** `readSnapshot` en `S2` devuelve `changes/x.md` con el texto escrito
- **And** el working tree sigue sin tocarse

### CR4 — El conflicto CAS falla explícito y sin mover la ref
- **Given** una revisión leída `S1` y la ref ya avanzada a `S2` por otra
  escritura
- **When** se ejecuta `mutateState` con `expectedRevision: S1`
- **Then** lanza `LedgerConflictError` cuyo mensaje contiene los OIDs `S1` y
  el tip actual
- **And** la ref sigue apuntando a `S2`

### CR5 — Un objeto no-commit nunca se acepta por peel
- **Given** `refs/heads/changeledger/state` apuntando a un tag anotado, y
  `refs/changeledger/activation` apuntando a un blob
- **When** se ejecuta `readSnapshot` y `readActivation` respectivamente
- **Then** cada llamada lanza un error que nombra el tipo real del objeto
  (`tag`, `blob`)
- **And** ninguna devuelve datos

### CR6 — Ausencia de ref y fallo de lectura son estados distintos
- **Given** un repo git sin ref de activación
- **When** se ejecuta `readActivation(root)`
- **Then** devuelve `null`
- **And** **Given** un runner inyectado cuyo subproceso falla con stderr
  `'fatal: boom'`, **When** se ejecuta `readActivation`, **Then** lanza un
  error cuyo mensaje contiene `'fatal: boom'` en lugar de devolver `null`

### CR7 — Un blob no-UTF-8 se rechaza, nunca se transcodifica
- **Given** la ref de estado con un blob `changes/legacy.md` que contiene
  bytes inválidos en UTF-8 (p. ej. `0xFF 0xFE`)
- **When** se ejecuta `readSnapshot(root)`
- **Then** lanza un error cuyo mensaje contiene la ruta `changes/legacy.md`
- **And** ningún documento devuelto contiene U+FFFD

### CR8 — Entradas no regulares y rutas fuera de layout se rechazan en ambas direcciones
- **Given** un árbol de estado que contiene una entrada symlink (modo
  `120000`)
- **When** se ejecuta `readSnapshot`
- **Then** lanza un error que nombra la entrada y su modo
- **And** **When** un `mutateState` intenta `stage.write('../fuera.md', …)` o
  `stage.write('code/x.js', …)`, **Then** el error nombra la ruta inválida y
  la ref no avanza

### CR9 — Ninguna identidad desaparece sin remove explícito
- **Given** un snapshot cuyo padre contiene `changes/x.md`
- **When** una mutación construye un candidato donde `changes/x.md` no existe
  sin haber llamado a `stage.remove('changes/x.md')`
- **Then** lanza un error que nombra `changes/x.md` como identidad
  desaparecida y la ref no avanza
- **And** la misma mutación con `stage.remove('changes/x.md')` explícito
  avanza la ref y el snapshot resultante ya no contiene el documento

### CR10 — La activación de bajo nivel es checkout-independiente
- **Given** `writeActivation(root, { stateRef:
  'refs/heads/changeledger/state' })` ejecutado una vez
- **When** se cambia el checkout a otra rama cualquiera del repo y se ejecuta
  `readActivation(root)`
- **Then** devuelve `state_ref: refs/heads/changeledger/state`
- **And** el working tree no contiene ningún archivo de autoridad

### CR11 — El núcleo funciona en repos SHA-256
- **Given** un repo git creado con `--object-format=sha256`
- **When** se ejecutan los escenarios de CR1, CR2, CR3 y CR4 sobre él
- **Then** todos pasan con OIDs de 64 caracteres

## Plan

- [ ] Portar `git-batch.mjs` desde `codex/state-replica-v2` con sus tests de
      lotes, tamaño límite y UTF-8 estricto
  - **Target:** `src/git-batch.mjs`
  - **Verify:** `node --test test/git-batch.test.mjs`
  - **Criteria:** CR2, CR7
- [ ] Portar `assertCommitObject` a `src/git.mjs` (tipo por `cat-file -t`,
      nunca peel) con tests de tag, blob y tree
  - **Target:** `src/git.mjs`
  - **Verify:** `node --test test/git.test.mjs`
  - **Criteria:** CR5
- [ ] Crear `test/helpers/state-repo.mjs` (fixture git real, SHA-1 y SHA-256,
      árbol de estado sembrado) adaptado del de v2
  - **Target:** `test/helpers/state-repo.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Support:**
- [ ] `state-store.mjs`: `initState`, `readStateRef` y `readSnapshot` con
      validación de layout, modos y UTF-8
  - **Target:** `src/state-store.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR1, CR2, CR5, CR6, CR7, CR8
- [ ] `state-store.mjs`: `mutateState` con CAS, `LedgerConflictError`, no-op
      sin commit e integridad padre-contra-candidato
  - **Target:** `src/state-store.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR3, CR4, CR8, CR9
- [ ] `state-store.mjs`: `readActivation`/`writeActivation`
      checkout-independientes y fail-closed
  - **Target:** `src/state-store.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR5, CR6, CR10
- [ ] Matriz SHA-256 sobre CR1-CR4
  - **Target:** `test/state-store.test.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR11
- [ ] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**

## Log

- **2026-08-08T15:16:40Z** `[note]` Draft creado como primer change de la
  etapa 1 (spec `global-state-scope.md`), sobre dos investigaciones delegadas:
  inventario del núcleo rescatable en `codex/state-replica-v2` (git-batch
  reutilizable tal cual; del state-store solo internos; layout y fixtures
  probados) y verificación en dev (`sanitizedEnv` ya cierra la clase de
  locale; `assertCommitObject` no existe y se porta). El catálogo de defectos
  de v2 entra como CRs, no como recuerdos.
