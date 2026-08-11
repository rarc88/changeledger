---
id: "20260810-181802"
title: Abaratar y simplificar la verificación del undo
type: refactor
status: done
created: 2026-08-10T18:18:02Z
depends_on: []
branch: refactor/20260810-181802
related_to: ["20260809-194233", "20260809-131004"]
owner: claude
---

## Request

Dos residuos anotados en los Logs de `20260809-131004` y `20260809-194233`,
misma superficie (`assertRevertRestoresSnapshot`, la puerta de
contenido+modo del undo del cutover):

- La verificación ejecuta un `ls-tree` por entrada del snapshot — O(N)
  subprocesos. Con este repo ya activado (319 documentos publicados) cada
  undo paga la N completa; `git-batch.mjs` ya existe para leer por lotes.
- Nit KISS anotado en review: simplificación local de la misma función sin
  cambio de comportamiento.

Mismo comportamiento observable, menos coste: ninguna aserción de la puerta
se debilita — los tests de `194233` (decoys, modo cambiado, round-trip
`100755`) deben pasar intactos.

## Proposal

Una sola enumeración por lotes del árbol publicado en
`assertRevertRestoresSnapshot` (`src/commands/cutover.mjs`): construir una
vez el mapa nombre→{modo, oid} con `treeEntries` (`src/git-batch.mjs`, la
misma primitiva que ya usa `readSnapshot`) y comparar contra él dentro del
bucle, en lugar del `run(['ls-tree', tip, '--', ...])` por entrada. La
semántica de rechazo no cambia: mismas comparaciones de oid y modo, mismos
mensajes de `refuse`. De paso, el nit KISS: la comprobación de modo regular
rechaza directamente desde el catch, sin la bandera intermedia `regular`.

Alternativas descartadas: reutilizar el `readSnapshot` ya leído para los
modos (readSnapshot valida y normaliza contenido, no expone modos crudos por
entrada — la verificación necesita el modo publicado literal); cachear entre
undos (un undo es un evento único, no hay N invocaciones que amortizar).

Escenario: undo del cutover real de este repo (319 documentos) — hoy paga
~319 subprocesos ls-tree; tras el cambio, una enumeración.

## Specification

### CR1 — La enumeración publicada no crece con el número de documentos
- **Given** dos repos de fixture con cutover válido, uno con 2 documentos y otro con 5
- **When** se ejecuta `changeledger cutover --undo` en cada uno contando los procesos git de la verificación (shim de PATH como el de `countGitSpawns` en `test/repo.test.mjs`)
- **Then** el número de invocaciones `ls-tree` de la verificación es el mismo en ambos (una enumeración del árbol publicado), y ambos undos restauran el ledger byte a byte

### CR2 — Ninguna negativa se debilita
- **Given** los fixtures adversariales existentes del undo (`20260809-194233`/`20260809-131004`: decoy forjado, mismo blob con modo cambiado, blob distinto, entrada publicada no restaurada y viceversa)
- **When** se ejecuta la verificación tras el refactor
- **Then** cada caso sigue rechazado con el mismo mensaje de `refuse` que hoy, sin debilitar ninguna aserción existente

## Plan

- [x] Enumeración por lotes en `assertRevertRestoresSnapshot` y comparación
  contra el mapa, retirando el `ls-tree` por entrada y la bandera `regular`
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-10T22:53:50Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T22:53:51Z`

## Log
- **2026-08-10T22:46:37Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T22:46:45Z** `[status]` approved → in-progress
- **2026-08-10T22:46:45Z** `[branch]` set: refactor/20260810-181802 (auto)
- **2026-08-10T22:46:46Z** `[owner]` set: claude
- **2026-08-10T22:53:57Z** `[note]` Unspecified decisions: the wrong-mode/dropped-mode mutant used instead was the wrong-revision variant (treeEntries against cutoverCommit instead of tip), killed by both CR2's existing 'cannot be read from the published snapshot' fixtures and the new CR1 spawn-count test; fixture doc counts for CR1 were 2 vs 5 as specified, built via a new ledgerFilesWithChangeCount helper rather than reusing defaultLedgerFiles.
- **2026-08-10T22:55:39Z** `[status]` in-progress → in-review
- **2026-08-10T22:55:40Z** `[note]` Mandato del review: superficie que gobierna el change — assertRevertRestoresSnapshot y su suite adversarial; escrutinio de que ningún mensaje de refuse ni aserción existente cambió
- **2026-08-10T23:02:13Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-10T23:02:14Z** `[note]` Corrección del review (F3): el mutante de revisión-equivocada lo matan CR1 y todos los tests de undo del camino feliz, no los fixtures de 'cannot be read' — ningún fixture asevera ese mensaje. La nota anterior lo atribuía mal
- **2026-08-11T00:35:20Z** `[validation]` in-validation → done (human accepted via conversation)
