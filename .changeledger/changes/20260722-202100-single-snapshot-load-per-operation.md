---
id: "20260722-202100"
title: Una carga de snapshot por operación con caché por OID
type: refactor
status: draft
created: 2026-07-22T20:21:00Z
depends_on: ["20260722-202059"]
related_to: ["20260721-193106", "20260722-203027"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` midió el coste real de
una mutación: 43–79 s (mediana 62 s) a solo 250 changes y 145 s a 1.000, cuando
una lectura simple cuesta ~3,5/17,7 s. La diferencia (~13×) no viene del volumen
sino de la repetición: cada mutación recarga y revalida el snapshot completo
entre 3 y 5 veces (`prepareMutation`, la propia carga de `mutateState`,
`validateCandidate` y las validaciones de `syncStateReplica`). Incluso con la
lectura batch de `20260722-202059`, el multiplicador seguiría desperdiciando
trabajo.

Alcance honesto: este refactor elimina recargas **dentro de una operación de
cliente**. La validación de batches de N commits en `pre-receive` es un
problema distinto (cada commit tiene un snapshot diferente; un caché por OID de
commit no lo resuelve) y pertenece a `20260722-203027`.

## Proposal

Reutilizar lo ya materializado y validado dentro de cada operación:

- `prepareMutation` entrega el snapshot ya cargado a `mutateState`
  (`src/ledger-store.mjs`), que deja de re-resolver y recargar la misma
  revisión.
- El candidato de la mutación se construye y valida **en memoria** a partir del
  snapshot fuente más el delta; el resultado validado se reutiliza como
  resultado de la operación sin recargarlo desde Git.
- Las validaciones de `syncStateReplica` (`validateRevision`/`validateCandidate`
  en `src/state-store.mjs`) reutilizan por OID de commit las revisiones ya
  validadas dentro de la misma operación.
- La clave de reutilización es el OID (inmutable por construcción) y el caché
  vive solo dentro de la operación, nunca entre procesos.

Presupuesto de materializaciones por mutación, explícito: **una** carga del
snapshot fuente (la revisión confirmada) más la validación en memoria del
candidato derivado — sin ninguna recarga completa adicional. El objetivo
medible: mutación ≈ una carga batch más el delta (con `20260722-202059`, del
orden de segundos a los volúmenes auditados).

No-goals: caché persistente entre procesos u operaciones; validación
incremental de batches multi-commit (`20260722-203027`); cambiar qué se valida
(solo cuántas veces).

## Plan

- [ ] Añadir tests de conteo de materializaciones (espía sobre la abstracción batch) que capturen las 3–5 cargas actuales por mutación y fijen el presupuesto de una carga fuente más candidato en memoria, y refactorizar `prepareMutation`/`mutateState` en `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/ledger-mutations.test.mjs` (CR de equivalencia)
- [ ] Reutilizar revisiones validadas por OID dentro de `syncStateReplica` en `src/state-store.mjs`; verify: `node --test test/state-store.test.mjs test/state-command.test.mjs` (CR de equivalencia)
- [ ] Re-ejecutar el benchmark de `20260722-202059` midiendo la mutación por volumen contra el objetivo; verify: benchmark comparativo en el Log (support)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:21:00Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (mutación 62 s de mediana a 250 changes medida por la ejecución paralela; multiplicador 3–5× de recargas confirmado por ambos auditores). Depende de 20260722-202059.
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: alcance limitado con honestidad a la reutilización intra-operación (una carga fuente + candidato en memoria, presupuesto explícito); la validación incremental de batches multi-commit se separa en 20260722-203027 porque un caché por OID de commit no evita N snapshots distintos en un batch de N commits.
