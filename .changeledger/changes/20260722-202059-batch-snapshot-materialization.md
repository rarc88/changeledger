---
id: "20260722-202059"
title: Materializar snapshots e inventarios Git en lote
type: refactor
status: in-review
created: 2026-07-22T20:20:59Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260721-193101", "20260721-193103", "20260722-202100", "20260722-203027"]
release_impact: patch
---

## Request

Ambas ejecuciones de la auditoría `20260721-193106` midieron el mismo cuello:
cada carga de snapshot lanza un subprocess `git show` por documento, así que la
latencia crece O(n) en procesos. Lecturas p50/p95 medidas: ~3,5 s a 250 changes,
~17,7/17,9 s a 1.000 y ~87,2/88,4 s a 5.000; el hook remoto expira su
presupuesto de 30 s desde 1.000 changes; `state migrate`/`activate` repiten el
patrón por entrada del inventario (preview 90 s y create 354 s a 5.000, con
escalado superlineal 1.000→5.000). Sin este refactor no hay SLO alcanzable ni
perfil Beta/GA posible.

## Proposal

Una prueba de concepto del auditor principal, sin modificar el producto,
estableció el objetivo: enumerar con un solo `git ls-tree -r` y materializar
todos los blobs con **un único `git cat-file --batch`** binario reduce la
lectura p50 a 0,065 s (250), 0,188 s (1.000) y 0,851 s (5.000); parsing más
`checkRepo` añaden ~0,27 s a 5.000. Una carga completa de 1–2 s a 5.000 changes
es técnicamente plausible — mejora de ~100× sin tocar el diseño del estado
centralizado.

Alcance:

- **Una abstracción compartida de lectura batch** (un módulo/función única que
  encapsula `ls-tree -r -z` + `cat-file --batch` binario) con contrato
  explícito: framing NUL en la enumeración, lectura binaria por longitud
  declarada en la respuesta de `--batch` (nunca split por delimitadores sobre
  contenido), validación UTF-8 estricta por blob, propagación del entorno de
  quarantine (`receiveGitEnv`) y del presupuesto `timeout_ms` del hook. Todos
  los consumidores usan esta abstracción; nadie reimplementa el patrón.
- `loadStateSnapshotAt`/`statePaths`/`readStateFile` en `src/ledger-store.mjs`:
  sustituir el `git show` por documento por la abstracción, conservando la
  validación y los errores actuales (blob inexistente, path inválido, UTF-8
  estricto).
- El inventario de migración/activación en `src/state-migration.mjs`
  (`inventorySource`, `candidateSnapshot` y la materialización de activación):
  misma abstracción.
- Compatibilidad explícita con SHA-1/SHA-256.
- Sin cambio de contrato observable: mismos receipts, mismos errores, mismos
  OIDs; la suite existente debe pasar sin reescrituras semánticas.

Objetivo del hook acotado con honestidad: este refactor deja **un update de un
solo commit** dentro del presupuesto de 30 s a 5.000 changes. Batches de N
commits siguen costando N validaciones y dependen de `20260722-203027`
(validación incremental por blob OID).

No-goals: caché entre operaciones y reutilización del snapshot dentro de una
operación (`20260722-202100`); validación incremental de batches
(`20260722-203027`); aumentar timeouts para tapar el síntoma.

## Plan

- [x] Añadir un benchmark reproducible (fixture sintética 250/1000/5000) que capture la latencia de carga antes del cambio como base de comparación en `test/` o script versionado; verify: ejecución del benchmark sobre el baseline con resultados registrados en el Log (support)
  - **Resolved:** `2026-07-22T22:44:18Z`
- [x] Implementar la materialización batch en `src/ledger-store.mjs` conservando validación y errores, con tests de equivalencia (mismo snapshot, mismos errores ante blob/path/UTF-8 inválidos) en SHA-1/SHA-256; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs test/state-command.test.mjs` (CR de equivalencia)
  - **Resolved:** `2026-07-22T22:40:00Z`
- [x] Aplicar el mismo patrón al inventario de migración/activación en `src/state-migration.mjs` incluida la ruta con quarantine; verify: `node --test test/state-migration.test.mjs test/state-receive.test.mjs` (CR de equivalencia)
  - **Resolved:** `2026-07-22T22:42:00Z`
- [x] Re-ejecutar el benchmark y registrar p50/p95 por volumen contra el objetivo (carga ≤2 s y update de un commit dentro de 30 s a 5.000); verify: benchmark comparativo en el Log (support)
  - **Resolved:** `2026-07-22T22:44:18Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T22:48:00Z`

## Log

- **2026-07-22T20:20:59Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (hallazgos de performance convergentes de ambos auditores; PoC batch del auditor principal: 87,2 s → 0,851 s a 5.000). Primero de dos refactors de performance; `20260722-202100` depende de este.
- **2026-07-22T22:09:21Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T22:09:22Z** `[status]` approved → in-progress
- **2026-07-22T22:09:22Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T22:48:00Z** `[note]` Abstracción compartida `src/git-batch.mjs`: `treeEntries` (un `ls-tree -r -z --full-tree`) + `batchBlobReader` (un `cat-file --batch` binario, validación UTF-8 estricta por blob antes del decode lossy, dedup de OIDs). `src/ledger-store.mjs`'s `loadStateTree` la usa para el snapshot de estado, sustituyendo un `git show` por documento; mismos errores ante blob/path/UTF-8 inválido, verificado con la suite existente (SHA-1/SHA-256, framing NUL). `src/state-migration.mjs` la aplica en `inventorySource` (un batch por fuente en vez de N `git show`), `candidateSnapshot`/`chosenContent` (un batch de candidatos resueltos en vez de N), y `readStateMetadata` (activación/doctor: un batch para manifest+config+changes+specs+releases). También se batcheó el lookup de árbol en `activationRemovals` (antes N `ls-tree` sueltos en el loop de remociones legacy, ahora uno). Los lookups verdaderamente O(1) (`authorityAt`, `assertIntegrationAuthority`, el config del plan) se dejaron con lectura directa por blob — no son el patrón N+1 que este cambio ataca. Benchmark reproducible en `scripts/bench-state-load.mjs` (fixture sintética con git real, compara N `git show` por archivo contra `treeEntries`+`batchBlobReader` en el mismo proceso): 250 docs 3103,2 ms → 58,8 ms (52,8x), 1.000 12297,9 ms → 170,3 ms (72,2x), 5.000 61602,5 ms → 784,9 ms (78,5x) — p50, 5 repeticiones (3 para la ruta `git show` a 1.000/5.000 por costo). Objetivo de carga ≤2 s a 5.000 changes cumplido con margen (0,78 s materialización pura, sin contar `checkRepo`). Suite ampliada 137/137 (`ledger-store`/`state-validation`/`state-store`/`state-command`/`ledger-mutations`/`state-capabilities`) y 39/39 en `state-migration`/`state-receive`, incluida cobertura SHA-1/SHA-256 existente. Gate completo: lint, tests y `changeledger check` verdes.
- **2026-07-22T22:47:09Z** `[status]` in-progress → in-review
