---
id: "20260722-202059"
title: Materializar snapshots e inventarios Git en lote
type: refactor
status: draft
created: 2026-07-22T20:20:59Z
depends_on: []
related_to: ["20260721-193106", "20260721-193101", "20260721-193103", "20260722-202100"]
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

- `loadStateSnapshotAt`/`statePaths`/`readStateFile` en `src/ledger-store.mjs`:
  sustituir el `git show` por documento por enumeración `ls-tree` + un
  `cat-file --batch` único, conservando la validación y los errores actuales
  (blob inexistente, path inválido, UTF-8 estricto).
- El inventario de migración/activación en `src/state-migration.mjs`
  (`inventorySource`, `candidateSnapshot` y la materialización de activación):
  mismo patrón batch.
- Compatibilidad explícita con SHA-1/SHA-256, quarantine de `pre-receive`
  (`receiveGitEnv`) y los presupuestos del hook (`timeout_ms`).
- Sin cambio de contrato observable: mismos receipts, mismos errores, mismos
  OIDs; la suite existente debe pasar sin reescrituras semánticas.

No-goals: caché entre operaciones y reutilización del snapshot dentro de una
operación (van en `20260722-202100`); aumentar timeouts para tapar el síntoma.

## Plan

- [ ] Añadir un benchmark reproducible (fixture sintética 250/1000/5000) que capture la latencia de carga antes del cambio como base de comparación en `test/` o script versionado; verify: ejecución del benchmark sobre el baseline con resultados registrados en el Log (support)
- [ ] Implementar la materialización batch en `src/ledger-store.mjs` conservando validación y errores, con tests de equivalencia (mismo snapshot, mismos errores ante blob/path/UTF-8 inválidos) en SHA-1/SHA-256; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs test/state-command.test.mjs` (CR de equivalencia)
- [ ] Aplicar el mismo patrón al inventario de migración/activación en `src/state-migration.mjs` incluida la ruta con quarantine; verify: `node --test test/state-migration.test.mjs test/state-receive.test.mjs` (CR de equivalencia)
- [ ] Re-ejecutar el benchmark y registrar p50/p95 por volumen contra el objetivo (carga ≤2 s y hook dentro de 30 s a 5.000); verify: benchmark comparativo en el Log (support)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:20:59Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (hallazgos de performance convergentes de ambos auditores; PoC batch del auditor principal: 87,2 s → 0,851 s a 5.000). Primero de dos refactors de performance; `20260722-202100` depende de este.
