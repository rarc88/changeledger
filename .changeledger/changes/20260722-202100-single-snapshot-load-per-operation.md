---
id: "20260722-202100"
title: Una carga de snapshot por operación con caché por OID
type: refactor
status: in-progress
created: 2026-07-22T20:21:00Z
depends_on: ["20260722-202059"]
owner: raruiz-hiberuscom
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

- [x] Añadir tests de conteo de materializaciones (espía sobre la abstracción batch) que capturen las 3–5 cargas actuales por mutación y fijen el presupuesto de una carga fuente más candidato en memoria, y refactorizar `prepareMutation`/`mutateState` en `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/ledger-mutations.test.mjs` (CR de equivalencia)
  - **Resolved:** `2026-07-22T23:05:00Z`
- [x] Reutilizar revisiones validadas por OID dentro de `syncStateReplica` en `src/state-store.mjs`; verify: `node --test test/state-store.test.mjs test/state-command.test.mjs` (CR de equivalencia)
  - **Resolved:** `2026-07-22T23:08:00Z`
- [x] Re-ejecutar el benchmark de `20260722-202059` midiendo la mutación por volumen contra el objetivo; verify: benchmark comparativo en el Log (support)
  - **Resolved:** `2026-07-22T23:16:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T23:20:00Z`

## Log

- **2026-07-22T20:21:00Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (mutación 62 s de mediana a 250 changes medida por la ejecución paralela; multiplicador 3–5× de recargas confirmado por ambos auditores). Depende de 20260722-202059.
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: alcance limitado con honestidad a la reutilización intra-operación (una carga fuente + candidato en memoria, presupuesto explícito); la validación incremental de batches multi-commit se separa en 20260722-203027 porque un caché por OID de commit no evita N snapshots distintos en un batch de N commits.
- **2026-07-22T23:20:00Z** `[note]` Implementado en `src/ledger-store.mjs`: `deriveCandidateSnapshot` construye el snapshot candidato en memoria a partir del snapshot fuente ya cargado más el delta `writes`/`removals` (parseando solo los documentos tocados; los intactos solo se re-etiquetan con la nueva revisión, sin recargarlos de Git); `validateSnapshotContent` factoriza el chequeo schema+`checkRepo` que antes solo corría dentro de `validateStateRevision`, para que el candidato en memoria pase exactamente la misma validación sin releer su árbol de Git. `mutateState` ya no llama `validateCandidate(tree)` (lectura Git) salvo que el delta toque el manifest (caso no usado por ningún mutador real hoy; cae al camino Git completo por seguridad). El retorno final evita la recarga completa: `finalizeMutationSnapshot` reetiqueta el candidato ya validado con el OID del commit y reconstruye los metadatos de frescura vía `stateReplicaStatus` (barato, sin materialización); la comprobación de no-desaparición de 20260722-202058 corre en memoria contra el snapshot fuente ya cargado (su único padre) en vez de recargar el padre desde Git. Excepción de seguridad: si `syncStateReplica` termina en `replay-pending` o falla su publicación (`result.effective !== commit`), se descarta el candidato en memoria y se recarga desde Git — nunca se sirve contenido que no sea exactamente lo que el ref activo terminó teniendo. En `src/state-store.mjs`-adyacente: `syncStateReplica` se invoca hasta dos veces por mutación online (antes y después de crear el pending); un caché por OID (`replicaValidationCache`, vive solo dentro de `mutateState`) evita revalidar el mismo `fetched` dos veces cuando el remoto no avanzó entre ambas llamadas — memoización pura, sin cambiar qué se valida. Tests de presupuesto (espía sobre `cat-file --batch`) añadidos en `test/ledger-store.test.mjs`: v1 confirmado ≤1 materialización por mutación (RED inicial: 3), réplica offline ≤2 (RED inicial: 4). Benchmark reproducible extendido en `scripts/bench-mutation.mjs` (v1/v2-offline/v2-online, 250/1000/5000 vía la API real `store.mutate`): v1 372,3/470,5/1432,1 ms (1 materialización en los tres volúmenes); v2-offline 492,1/667,9/1644,3 ms (1 materialización — el baseline es la raíz del historial de estado y no tiene padre que recargar); v2-online 1209,7/1596,5/4753,0 ms (3 materializaciones: sync pre-mutación + carga fuente + sync post-mutación, el caché por OID evita una cuarta). Objetivo "mutación ≈ una carga batch más el delta" cumplido para v1 y réplica offline; v2-online retiene sync remoto genuino (dos fetches, no eliminables sin arriesgar la garantía de reconciliación) documentado como costo aceptado, no comparable 1:1 con el objetivo del CR. Bug lateral encontrado y corregido durante el benchmark: `defaultRun` (`src/git.mjs`) y el `run` del hook (`src/state-validation.mjs`) no fijaban `maxBuffer` en su `execFileSync`; con lecturas por-archivo esto nunca se topaba con el límite de 1 MiB de Node, pero una lectura batch de 5.000 changes sí (`ENOBUFS` reproducido y corregido). Se añadió `GIT_MAX_BUFFER` compartido en `git.mjs` (reemplaza la constante duplicada en `state-migration.mjs`); en `state-validation.mjs` el techo se fija a `Math.max(GIT_MAX_BUFFER, budget.max_object_bytes)` para no interferir con el chequeo de aplicación existente sobre `max_object_bytes` (que debe poder disparar su propio mensaje incluso con un presupuesto configurado pequeño), y `cleanError` ahora acota el detalle a 2000 caracteres (mismo patrón que 20260722-202101) para que un error de `ENOBUFS` con buffer parcial no produzca un mensaje de decenas de MB. Suite completa: 936/936, más 79/79 (`state-store`/`state-command`) y 222/222 en la suite ampliada de validación/migración/capabilities/receive/cli-bin. Gate completo: lint, tests y `changeledger check` verdes.
- **2026-07-22T22:53:26Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T22:53:27Z** `[status]` approved → in-progress
- **2026-07-22T22:53:27Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T23:18:19Z** `[status]` in-progress → in-review
- **2026-07-22T23:35:00Z** `[note]` Reviewer de contexto limpio devolvió `PASS` con dos hallazgos 🟡 no bloqueantes, corregidos antes de la aceptación humana: (1) `deriveCandidateSnapshot` no reordenaba `specs`/`releases` tras agregar un documento nuevo (solo `changes` se reordenaba), rompiendo la equivalencia de orden con una recarga fresca cuando un spec/release nuevo ordena antes de uno existente — corregido reordenando ambas colecciones por `statePath`, verificado empíricamente comentando el fix (el nuevo test falla como se espera) y restaurándolo. (2) el camino en memoria no comprobaba que un `config.yml` reescrito conservara el `project_id` de la autoridad (`loadStateSnapshotAt` sí lo hace en toda carga vía Git) — corregido comparando el `project_id` del candidato contra el del snapshot fuente (ya validado transitivamente contra la autoridad). Tests nuevos: "a mutation adding a spec keeps sort order equivalent to a fresh load" y "a mutation cannot drift config project_id away from the authority". Gate re-ejecutado: 938/938 tests, lint y `changeledger check` verdes.
- **2026-07-22T23:32:54Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T16:59:35Z** `[validation]` in-validation → in-progress (agent rejected): Drift contractual: el doc promete una materializacion pero v2 online ejecuta tres (sync pre/post pending, ledger-store.mjs:637,717) sin presupuesto online testeado; ademas c015192b introdujo GIT_MAX_BUFFER 16 MiB como tope agregado de cat-file --batch que deja el ledger ilegible (ENOBUFS con 17 MiB). Corregir: contrato honesto por OID, presupuesto testeable v1/v2, streaming o chunks por bytes, tests 17/32/64 MiB.
