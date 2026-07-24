---
id: "20260722-203029"
title: Receipts del CLI con procedencia de proyecto y repositorio
type: bug
status: in-progress
created: 2026-07-22T20:30:29Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260722-190137"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (fila ISO-1.2) encontró
que ningún receipt del CLI — humano ni `--json` — identifica el proyecto ni el
repositorio sobre el que operó: solo un `ledger_revision` opaco con
freshness/confirmación. Un receipt copiado fuera de su terminal no puede
atribuirse a un proyecto sin cruzarlo con el registry. `20260722-190137` cubre
la procedencia de los payloads del viewer; esta es la superficie CLI,
pendiente. Hallazgo medio: sin riesgo de escritura cruzada (el aislamiento se
verificó), pero la atribución inequívoca que exige el audit no se cumple.

## Investigation

`printLedgerRevision` (`bin/changeledger.mjs:211`) y `ledgerReceipt`
(`src/ledger-store.mjs:44`) emiten `ledger_revision`, `ledger_freshness` y
`ledger_confirmation`, sin `project_id` ni path del repositorio. Verificado en
vivo: `approve` imprimió solo `Ledger revision: bb80fd…`; `list --json` solo
`ledger_revision`. El `project_id` está disponible en la config/authority del
repo resuelto al construir el receipt; añadirlo es barato. Contraste: el viewer
ya expone `id`+`path`+`ledger_revision` en `/api/projects` y `/api/repo`.

La superficie no termina en esos dos helpers: los comandos de réplica tienen
acciones y receipts propios, incluido `stateFailureReceipt`, y los resultados
de status/sync/abort, migrate, activate, doctor y export no pasan todos por
`ledgerReceipt`. Modificar solo el receipt común dejaría errores y operaciones
de estado sin procedencia, contradiciendo «todo receipt».

## Specification

### CR1 — Todo receipt identifica su procedencia
- **Given** cualquier comando del CLI que emita un receipt de ledger o de estado
  —lectura, mutación, status, sync, abort, migrate, activate, doctor o export—
  en formato humano o `--json`
- **When** se imprime el receipt
- **Then** incluye `project_id` y `repository_path` canónico junto a la revisión
  o resultado
- **And** el formato humano lo muestra sin romper los consumidores existentes
  del formato JSON (campos aditivos)

### CR2 — Los fallos conservan procedencia
- **Given** cualquiera de esos comandos termina con un receipt de error,
  incluido `stateFailureReceipt`
- **When** el CLI serializa o imprime el fallo
- **Then** incluye el mismo `repository_path` y el `project_id` resuelto desde
  config, authority, plan o baseline
- **And** si el error consiste precisamente en que la identidad falta o es
  inválida, `project_id` es `null` y `repository_path` sigue identificando el
  repositorio sin ocultar la causa original

### CR3 — La procedencia refleja el repo resuelto, no una selección externa
- **Given** un CLI cuyo cwd pertenece al proyecto B mientras cualquier otra
  superficie tiene seleccionado A
- **When** se emite el receipt
- **Then** la procedencia nombra B (el repo realmente resuelto por cwd)

## Plan

- [x] Inventariar los productores de receipts y añadir un helper común de procedencia para el root canónico y project_id en `src/ledger-store.mjs`/`bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs test/ledger-mutations.test.mjs` cubriendo lectura y mutación humana/JSON (CR1)
  - **Resolved:** `2026-07-23T14:47:56Z`
- [x] Extender en `bin/changeledger.mjs` los receipts de éxito y `stateFailureReceipt` para status/sync/abort, migrate, activate, doctor y export; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` cubriendo éxito, fallo, identidad ausente y campos JSON aditivos (CR1, CR2)
  - **Resolved:** `2026-07-23T14:47:56Z`
- [x] Añadir en `bin/changeledger.mjs` la regresión concurrente cwd B mientras el viewer mantiene A; verify: `node --test test/cli-bin.test.mjs` exige project_id/repository_path de B en éxito y error (CR3)
  - **Resolved:** `2026-07-23T14:47:57Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T14:52:37Z`
- [x] Añadir tests rojos y procedencia en los productores que el inventario de la reapertura encontró sin ella: `check` (humano y `--json`, incluido `--commits` y el fallo de carga) en `src/commands/check.mjs`, receipt de `fix` en `src/commands/fix.mjs`, receipt de `config migrate` en `src/commands/config.mjs` y `release plan` en `src/commands/release.mjs`; verify: `node --test test/cli-bin.test.mjs test/state-command.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-24T16:16:13Z`
- [x] Añadir tests rojos y procedencia en los receipts de éxito de `state validate-update` y `state validate-receive` en `bin/changeledger.mjs`, reutilizando el helper de procedencia de receipts de estado; verify: `node --test test/state-receive.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-24T16:16:14Z`
- [x] Ejecutar el gate completo tras la corrección; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-24T16:16:14Z`
- [ ] Añadir tests rojos y enrutar los fallos de `state status/sync/abort` por la maquinaria de receipts (`stateAction`/`stateFailureReceipt` en `bin/changeledger.mjs`): receipt con procedencia en fallo humano y JSON estructurado bajo `--json`; verify: `node --test test/state-command.test.mjs` (CR1, CR2)
- [ ] Añadir tests rojos y sufijo de procedencia en los fallos de carga humanos de `check` y `fix`, promoviendo `safeProvenance`/`provenanceSuffix` a `src/ledger-store.mjs` y usándolos en `src/commands/check.mjs` y `src/commands/fix.mjs`; verify: `node --test test/cli-bin.test.mjs` (CR2)
- [ ] Ejecutar el gate completo tras la segunda reapertura; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:29Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106 (fila ISO-1.2 de la ejecución paralela): 20260722-190137 cubre los payloads del viewer; esta es la superficie CLI.
- **2026-07-22T20:41:30Z** `[note]` Alcance completado tras revisar los productores reales: incluye receipts comunes, comandos de réplica y stateFailureReceipt en éxito/error humano y JSON.
- **2026-07-23T09:28:25Z** `[status]` draft → approved
- **2026-07-23T14:31:25Z** `[status]` approved → in-progress
- **2026-07-23T14:31:25Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T14:52:38Z** `[note]` Implementado: repoProvenance(cwd) en ledger-store.mjs (cheap, cwd-derived, degrada a project_id:null en fallos manteniendo repository_path per CR2/CR3). Wired en list/show/search (agent.mjs, search.mjs), printLedgerRevision y stateFailureReceipt/stateReceiptDetails (bin/changeledger.mjs), y las acciones humanas de state status/sync/abort/migrate/activate/doctor/export. JSON existente solo recibe campos aditivos (list/show/search wrapper cuando hay ledger_revision; bare array sin ledger_revision se deja intacto para no romper consumidores). Tests CR1-CR3 en cli-bin.test.mjs y state-command.test.mjs. pnpm verify verde (976 tests).
- **2026-07-23T14:52:38Z** `[status]` in-progress → in-review
- **2026-07-23T15:03:14Z** `[review]` in-review → in-progress (retry): CR2: falta test de la degradación project_id:null/repository_path-presente cuando la identidad realmente no se puede resolver (ej. state doctor --json fuera de un repo inicializado); la implementación es correcta pero no está cubierta
- **2026-07-23T15:05:41Z** `[note]` Corrección tras fail-retry: agregado test que ejercita la rama de degradación real (state doctor --json fuera de cualquier repo inicializado) y confirma project_id: null con repository_path presente. node --test + pnpm verify verdes (977 tests).
- **2026-07-23T15:05:41Z** `[status]` in-progress → in-review
- **2026-07-23T15:11:50Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T22:57:48Z** `[validation]` in-validation → in-progress (agent rejected): La reauditoría be058658 confirma receipts sin procedencia autocontenida: viewer sync/mutations omiten project_id y repository_path, y varios productores CLI aún no llaman repoProvenance. El criterio de todos los receipts no se cumple.
- **2026-07-24T16:00:07Z** `[note]` Reapertura acotada: la mitad viewer del rechazo (sync/mutations sin project_id/repository_path) pertenece a 20260722-190137 y quedó cerrada por su rework sistémico ya en in-validation. Inventario CLI completo de esta reapertura: faltan check (humano/JSON/--commits/fallo de carga), fix, config migrate, release plan y los éxitos de state validate-update/validate-receive. Outputs sin receipt (init, register, context, agent-prompt, agent-context, view) quedan fuera del criterio: no atribuyen una operación de ledger.
- **2026-07-24T16:16:14Z** `[note]` Corrección de la reapertura: procedencia en check (humano/JSON, --commits y fallos de carga vía safeProvenance que degrada sin ocultar la causa), fix y config migrate (repoProvenance desde snapshot.repoRoot), release plan (JSON aditivo y línea humana vía formatLedgerReceipt), y éxitos de state validate-update/validate-receive (helper renombrado a stateReceiptProvenance, receipts por update y a nivel de comando). 5 regresiones rojas primero; 4 asserts de formato humano exacto actualizados al formato con procedencia. Gate 1.138/1.138 y 241 changes válidos.
- **2026-07-24T16:16:15Z** `[status]` in-progress → in-review
- **2026-07-24T16:27:08Z** `[review]` in-review → in-progress (retry): check --commits tiene procedencia implementada pero sin ningún test que la asercione (check.mjs:70/95/107); y el scoping de context/agent-context es factualmente erróneo: ledgerSnapshotPolicy imprime la tupla completa de receipt (revision/freshness/confirmation/observed_at) sin procedencia. Cablear procedencia en la línea Ledger snapshot y cubrir --commits con tests rojos.
- **2026-07-24T16:31:47Z** `[note]` Corrección del retry: check --commits cubierto con regresiones (JSON éxito/fallo fuera de un ledger con project_id null, y humano/JSON en repo de estado con project-1); adjudicado el residuo de scoping — la línea Ledger snapshot de context/agent-context sí es un receipt de lectura, así que ledgerSnapshotPolicy incorpora project y repo desde repoProvenance(repo.repoRoot), con los tests pinned actualizados a formato con procedencia. Gate 1.139/1.139 y 241 changes válidos.
- **2026-07-24T16:31:48Z** `[status]` in-progress → in-review
- **2026-07-24T16:40:32Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:45:41Z** `[validation]` in-validation → done (human accepted)
- **2026-07-24T21:38:48Z** `[status]` done → in-progress (agent reopened): La tercera ejecución del audit (RECEIPT-04/05) encontró scope original sin completar: los fallos de state status/sync/abort pasan por el wrapper action() en vez de la maquinaria de receipts (Error pelado, sin procedencia y salida no-JSON bajo --json), y los fallos de carga humanos de check/fix no llevan el sufijo de procedencia que sus gemelos JSON sí degradan. CR1 enumera status/sync/abort y CR2 exige procedencia en todo fallo.
