---
id: "20260722-202100"
title: Una carga de snapshot por operación con caché por OID
type: refactor
status: done
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
- La clave de reutilización es el OID de commit (inmutable por construcción). Un
  único caché por-OID con alcance de operación (keyed por revisión, vive solo
  dentro de `mutateState`, nunca entre procesos) lo comparten **todos** los
  caminos de una misma mutación: los syncs de réplica pre y post pending
  (`syncStateReplica` en `src/state-store.mjs`), la carga fuente y su descenso
  al padre para el chequeo de no-desaparición, y la validación del candidato. Así
  ninguna revisión distinta se materializa desde Git más de una vez por
  operación.

Contrato honesto de materializaciones, por OID y testeable (una
materialización = una carga completa del árbol de una revisión;
`test/ledger-store.test.mjs` las cuenta instrumentando `ls-tree --full-tree`):

- **Invariante:** cada OID de commit distinto se materializa **como máximo una
  vez** por operación; el candidato derivado nunca se relee desde Git.
- **v1:** 1 materialización — el snapshot fuente; candidato en memoria.
- **v2 réplica offline, revisión raíz:** 1 — la fuente (la raíz no tiene padre).
- **v2 réplica offline, revisión no-raíz:** 2 — la fuente y su padre (una vez
  cada uno) para el chequeo de no-desaparición.
- **v2 réplica online, revisión raíz:** 2 — el tip confirmado/fetch (compartido
  por los dos syncs y la carga fuente, deduplicado por OID) y el pending recién
  creado.
- **v2 réplica online, revisión no-raíz:** 3 — confirmado, su padre y el pending.

El coste online **incluye explícitamente** las validaciones remotas necesarias:
los syncs pre y post pending no se eliminan —protegen invariantes distintas
(reconciliación del remoto antes de mutar y confirmación de publicación
después)— solo se deduplican por OID. El objetivo medible sigue siendo mutación
≈ una carga batch más el delta (con `20260722-202059`, del orden de segundos a
los volúmenes auditados); online suma sobre eso las validaciones remotas
inevitables.

Lectura acotada por bytes (corrige el techo agregado de 16 MiB): el lector batch
(`src/git-batch.mjs`) agrupa las peticiones de OID en chunks cuya respuesta
`cat-file --batch` no supera el presupuesto por llamada, de modo que un estado
cuyo **total** exceda ese presupuesto sigue siendo legible (antes un total
>16 MiB dejaba el ledger ilegible con `ENOBUFS`). La memoria por llamada queda
acotada al presupuesto del chunk; un único objeto mayor que ese presupuesto se
rechaza fail-closed con un diagnóstico acotado (no puede leerse dentro de una
llamada acotada), en vez de un `ENOBUFS` opaco sobre un buffer parcial.

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
- **2026-07-23T17:41:58Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T18:58:31Z** `[note]` Corrección implementada (sin commit hasta confirmación humana): contrato por OID honesto en Proposal (cada commit OID materializado ≤1 vez por operación, coste online explícito con syncs pre/post deduplicados por caché de operación); chunking en dos fases acotado por bytes en git-batch sustituye el techo agregado de 16 MiB; presupuestos fijados por tests instrumentados (v1=1, v2 offline root=1/no-root=2, online root=2/no-root=3); tests reales 17/32/64 MiB y SHA-256. Nota: test 202101 CR4 retargeteado del ENOBUFS antiguo al nuevo diagnóstico de presupuesto — superficie compartida con 20260722-202101, pendiente de visto bueno humano. Gate 1038/1038.
- **2026-07-23T18:58:32Z** `[status]` in-progress → in-review
- **2026-07-23T19:05:13Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T19:05:13Z** `[note]` Review de contexto limpio: pass. Riesgo 🟡 aceptado como no bloqueante y documentado en código: el cap de lectura por objeto (16 MiB por chunk) contradice max_object_bytes default (64 MiB); un objeto único entre ambos límites pasa el check de bytes pero se rechaza fail-closed al materializar. Reconciliación de límites = decisión de producto pendiente del humano. Comentario obsoleto en state-validation.mjs corregido tras el veredicto (solo prosa).
- **2026-07-23T19:19:55Z** `[note]` Humano confirma contrato reescrito y fix de chunking (conversación 2026-07-23); se committea.
- **2026-07-23T19:39:58Z** `[validation]` in-validation → in-progress (agent rejected): Auditoría integral: la asimetría del guard de desaparición viene de c015192b — assertNoDisappearance corre solo en la rama in-memory (ledger-store.mjs:744), no en la git-backed (:746); una mutación v2 que toca MANIFEST y elimina una identidad publica y rompe todas las lecturas posteriores en vez de fallar en el write. Además, decisión humana: bajar DEFAULT_STATE_LIMITS.max_object_bytes de 64 a 16 MiB para reconciliar con el cap real por chunk.
- **2026-07-23T19:52:25Z** `[note]` Corrección 2 (sin commit hasta confirmación humana): assertNoDisappearance aplicado también en la rama git-backed (manifest-touching) antes de commit-tree/pending — test endurecido prueba fail-fast real (sin pending publicado, snapshot legible tras el rechazo; rojo verificado sin el guard). max_object_bytes default reconciliado a 16 MiB (decisión humana), comentarios actualizados. Gate completo verde.
- **2026-07-23T19:52:25Z** `[status]` in-progress → in-review
- **2026-07-23T19:54:52Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T19:55:52Z** `[note]` Humano confirma la corrección de auditoría (conversación 2026-07-23); se committea.
- **2026-07-23T20:25:39Z** `[validation]` in-validation → in-progress (agent rejected): Auditoría externa + decisión humana: blob de exactamente el presupuesto se rechaza porque el framing de cat-file consume parte del buffer, con diagnóstico engañoso. Subir GIT_MAX_BUFFER y max_object_bytes default a 32 MiB (decisión humana 2026-07-23) y dar margen de framing al chunk para que un objeto exactamente en el límite pase; test del caso frontera exacto.
- **2026-07-23T20:34:09Z** `[note]` Corrección 3 (sin commit hasta confirmación humana): GIT_MAX_BUFFER y max_object_bytes default a 32 MiB (decisión humana); chunkBySize compara bytes de CONTENIDO contra el presupuesto mientras readChunk pide el tamaño enmarcado exacto — objeto de exactamente 32 MiB pasa, presupuesto+1 se rechaza con diagnóstico veraz; fixtures over-budget subidos (33 MiB). 115/115 en suites objetivo, gate completo 1049/1049.
- **2026-07-23T20:34:10Z** `[status]` in-progress → in-review
- **2026-07-23T20:38:16Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T20:38:16Z** `[note]` Review de contexto limpio: pass en los 5 puntos (aritmética framed-vs-content sin path a ENOBUFS, aislamiento del objeto exacto en su propio chunk, diagnóstico veraz). Follow-up del reviewer aplicado en alcance: test sha256 subido a 6x6 MiB (>32) para restaurar cobertura multi-chunk y label corregido.
- **2026-07-23T20:45:40Z** `[note]` Humano confirma la corrección (conversación 2026-07-23); se committea.
- **2026-07-24T16:45:24Z** `[validation]` in-validation → done (human accepted)
