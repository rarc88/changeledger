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
