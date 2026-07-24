---
id: "20260723-170613"
title: Limpiar los hallazgos menores de la doble auditoría
type: chore
status: done
created: 2026-07-23T17:06:13Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193102", "20260721-193104", "20260721-193106", "20260722-190137", "20260722-202100", "20260722-202059", "20260723-170610", "20260723-170611", "20260723-170612"]
release_impact: patch
---

## Request

Batch no bloqueante con los hallazgos LOW confirmados por la doble auditoría del 2026-07-23 (revisión integral en worktree + auditoría read-only de 20260721-193106). Son defectos de diagnóstico, orden y cobertura sin impacto de corrección funcional; agrupados aquí para no generar un change por hallazgo. Los hallazgos mayores tienen sus propios cauces: 20260722-190137 y 20260722-202100 (reabiertos), 20260723-170610/170611/170612.

Hallazgos incluidos, con origen:

- `src/state-store.mjs:413` — `stateReplicaStatus` reporta `conflict` para un pending ya publicado (observed desciende de `pending.head`); `syncStateReplica` lo resolvería benigno como confirm-observed. Cortocircuitar a `pending` con `isAncestor` antes del solape.
- `src/state-store.mjs:402` — el error `state sync cannot continue: invalid-local-state` no incluye los oids base/confirmed/pending que sus ramas hermanas sí emiten.
- `src/state-store.mjs:344` — un fallo git de infraestructura dentro de `replayPending` se etiqueta como `state replica conflict`; distinguir fallo exec/git de conflicto semántico de paths.
- `src/state-capabilities.mjs:53` — evidencia duplicada para la misma capability es last-write-wins: una entrada inválida posterior degrada una trusted válida anterior. Ignorar duplicados ya resueltos o rechazarlos.
- `src/ledger-store.mjs:550` — specs/releases del candidato ordenados con `localeCompare` mientras la carga git usa sort por code-unit; divergen con nombres mixed-case pese al comentario de equivalencia. Coordinar con 20260722-202100 reabierto (misma zona).
- `src/repo.mjs:83` — `loadRepoAsync` en modo state ejecuta `store.load()` síncrono (execFileSync), bloqueando el event loop del viewer por request; hacer async la carga o documentar el bloqueo.
- `src/git.mjs:66` — `defaultRun` descarta stderr en el read path; fallos de `cat-file`/`ls-tree` pierden el diagnóstico real de git. Capturar stderr como ya hacen `mutatingRun`/`runIndexedGit`.
- `test/state-store.test.mjs:304` — ternario muerto `invalidCandidate ? 'specs/A.md' : 'specs/A.md'`; la variación que el nombre del test implica nunca se ejercita.
- `test/` — sin tests dedicados de los failure paths de `src/git-batch.mjs` (objeto ausente, framing malformado, entrada de tree malformada, conteo inesperado, oid no solicitado); el fixture 20260716-124623 referencia un `test/git-batch.test.mjs` que no existe.

## Plan

- [x] Corregir el estado transitorio y los diagnósticos de réplica en `src/state-store.mjs` (líneas 344, 402, 413); verify: `node --test test/state-store.test.mjs`
  - **Resolved:** `2026-07-23T18:13:54Z`
- [x] Proteger `src/state-capabilities.mjs` frente a evidencia duplicada; verify: `node --test test/state-capabilities.test.mjs`
  - **Resolved:** `2026-07-23T18:13:54Z`
- [x] Unificar el orden de specs/releases entre candidato y carga git en `src/ledger-store.mjs`, coordinando con el trabajo reabierto de 20260722-202100; verify: `node --test test/ledger-store.test.mjs`
  - **Resolved:** `2026-07-23T18:13:55Z`
- [x] Resolver o documentar la carga síncrona de `loadRepoAsync` en modo state en `src/repo.mjs`; verify: `node --test test/view.test.mjs`
  - **Resolved:** `2026-07-23T18:13:55Z`
- [x] Capturar stderr en el read path de `src/git.mjs`; verify: `node --test test/ledger-store.test.mjs`
  - **Resolved:** `2026-07-23T18:13:55Z`
- [x] Eliminar el ternario muerto de `test/state-store.test.mjs:304` restaurando la variación pretendida; verify: `node --test test/state-store.test.mjs`
  - **Resolved:** `2026-07-23T18:13:55Z`
- [x] Crear `test/git-batch.test.mjs` cubriendo los failure paths del parser con un `run` stub; verify: `node --test test/git-batch.test.mjs`
  - **Resolved:** `2026-07-23T18:13:55Z`
- [x] Ejecutar la suite completa y el gate al cierre del batch; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T18:17:05Z`

## Log

- **2026-07-23T17:41:39Z** `[status]` draft → approved (human via conversation)
- **2026-07-23T17:41:40Z** `[status]` approved → in-progress
- **2026-07-23T17:41:40Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T17:41:59Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T18:17:05Z** `[note]` Batch implementado por delegado: los 9 LOWs resueltos (réplica status/diagnósticos, capabilities first-wins, orden ordinal candidate=load, doc de bloqueo sync en repo.mjs, stderr capturado en defaultRun, ternario muerto, test/git-batch.test.mjs nuevo con 12 casos). git.test.mjs también tocado (2 tests de stderr). Gate completo en verde.
- **2026-07-23T18:17:05Z** `[status]` in-progress → in-validation
- **2026-07-23T19:31:02Z** `[validation]` in-validation → in-progress (agent rejected): Auditoría integral: isGitProcessError solo inspecciona un nivel de .cause (fallos infra del validador siguen etiquetados como conflict); resolved.add en state-capabilities corre antes del check de validez (una entrada inválida inicial bloquea para siempre una válida posterior — first-seen-wins en vez de no-downgrade); gaps de test: rama conflict de stateReplicaStatus sin cubrir (base-mismatch y overlap no-ancestor) e invalid-first en capabilities.
- **2026-07-23T19:34:38Z** `[note]` Corrección de auditoría (sin commit hasta confirmación humana): isGitProcessError recorre toda la cadena de causes; capabilities pasa a first-valid-wins (una entrada inválida inicial ya no bloquea la resolución válida posterior, sin permitir downgrade); tests nuevos de la rama conflict de stateReplicaStatus (sibling con overlap) e invalid-first. Gate completo verde.
- **2026-07-23T19:34:39Z** `[status]` in-progress → in-validation
- **2026-07-23T19:55:52Z** `[note]` Humano confirma la corrección de auditoría (conversación 2026-07-23); se committea.
- **2026-07-24T16:45:57Z** `[validation]` in-validation → done (human accepted)
