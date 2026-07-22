---
id: "20260722-202100"
title: Una carga de snapshot por operación con caché por OID
type: refactor
status: draft
created: 2026-07-22T20:21:00Z
depends_on: ["20260722-202059"]
related_to: ["20260721-193106"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` midió el coste real de
una mutación: 43–79 s (mediana 62 s) a solo 250 changes y 145 s a 1.000, cuando
una lectura simple cuesta ~3,5/17,7 s. La diferencia (~13×) no viene del volumen
sino de la repetición: cada mutación recarga y revalida el snapshot completo
entre 3 y 5 veces (`prepareMutation`, la propia carga de `mutateState`,
`validateCandidate` y las validaciones de `syncStateReplica`). El hook de
`pre-receive` repite el mismo patrón por cada commit del batch. Incluso con la
lectura batch de `20260722-202059`, el multiplicador seguiría desperdiciando
trabajo y presupuesto del hook.

## Proposal

Reutilizar el snapshot dentro de cada operación en vez de recargarlo:

- `prepareMutation` entrega el snapshot ya cargado a `mutateState`
  (`src/ledger-store.mjs`), que deja de re-resolver y recargar la misma
  revisión.
- El candidato ya validado se reutiliza como resultado de la mutación en lugar
  de revalidarse desde cero.
- Las validaciones de `syncStateReplica` (`validateRevision`/`validateCandidate`
  en `src/state-store.mjs`) aceptan y reutilizan revisiones ya validadas dentro
  de la misma operación, cacheadas por OID.
- `validateReceiveBatch` (`src/state-validation.mjs`) cachea por OID los
  snapshots validados dentro del mismo batch de `pre-receive`, de modo que un
  rango de N commits no recargue N veces los documentos sin cambios.
- La invalidación es trivial y segura: la clave es el OID del commit/árbol —
  inmutable por construcción — y el caché vive solo dentro de la operación o el
  batch, nunca entre procesos.

Objetivo medible: una mutación cuesta aproximadamente una carga de snapshot más
el delta (con `20260722-202059`, del orden de segundos a cualquier volumen
auditado), y el hook valida un batch de N commits en O(carga + deltas), dentro
de su presupuesto de 30 s a 5.000 changes.

No-goals: caché persistente entre procesos u operaciones; cambiar la semántica
de validación (qué se valida no cambia; cuántas veces, sí).

## Plan

- [ ] Añadir tests de conteo de cargas (espía sobre la materialización) que capturen las 3–5 cargas actuales por mutación y fijen el objetivo de una sola, y refactorizar `prepareMutation`/`mutateState` en `src/ledger-store.mjs` para transportar el snapshot cargado; verify: `node --test test/ledger-store.test.mjs test/ledger-mutations.test.mjs` (CR de equivalencia)
- [ ] Reutilizar revisiones validadas por OID dentro de `syncStateReplica` en `src/state-store.mjs`; verify: `node --test test/state-store.test.mjs test/state-command.test.mjs` (CR de equivalencia)
- [ ] Cachear por OID dentro de un batch en `validateReceiveBatch` de `src/state-validation.mjs` conservando los límites operacionales; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR de equivalencia)
- [ ] Re-ejecutar el benchmark de `20260722-202059` midiendo mutación y hook por volumen contra el objetivo; verify: benchmark comparativo en el Log (support)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:21:00Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (mutación 62 s de mediana a 250 changes medida por la ejecución paralela; multiplicador 3–5× de recargas confirmado por ambos auditores). Depende de 20260722-202059; juntos llevan mutación y hook a segundos.
