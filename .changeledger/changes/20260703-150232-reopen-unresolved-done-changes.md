---
id: "20260703-150232"
title: Reabrir changes aceptados con cierre pendiente
type: feature
status: in-validation
created: 2026-07-03T15:02:32Z
depends_on: [ "20260703-150231" ]
release_impact: minor
owner: Roberto Ruiz
---

## Request

Permitir corregir un change aceptado que todavía no ha resuelto su graduación,
en vez de obligar a crear otro change inmediatamente. Una vez que el cierre se
vuelve durable, el change no debe poder reabrirse.

## Investigation

El lifecycle actual trata `done` y `discarded` como terminales. La aceptación
humana mueve a `done`, y solo después el agente gradúa a una spec o registra un
skip. Entre ambos momentos existe una ventana real en la que puede descubrirse
un problema, pero hoy no puede devolverse el mismo alcance a `in-progress`.

Usar únicamente “graduado a spec” como frontera sería incompleto. `--skip`
también resuelve deliberadamente la pregunta de verdad persistente; archivar
declara cierre operativo; y un manifiesto de release ya publicado referencia el
change como entrega durable. Reabrir cualquiera de esos casos volvería
inconsistentes specs, releases o archivo histórico.

`doneAt()` ya usa la última transición a done, pero métricas y validación de Log
asumen que `done` es terminal. La reapertura requiere modelar explícitamente el
intervalo provisional, conservar el primer evento en el Log y usar la aceptación
final para cycle time y throughput. `discarded` sigue siendo un tombstone y no
participa de esta excepción.

## Proposal

Añadir una acción humana `Reopen` en el viewer para `done` con graduación
pendiente. Exige motivo y escribe `status: done → in-progress (human reopened):
<reason>`. La operación falla cerrada si `reviewed: true`, existe una marca real
de graduación/skip, está archivado o cualquier release registrada contiene el
ID.

El change vuelve al flujo normal: se actualizan Specification/Plan dentro del
alcance autorizado, se agregan o reabren tareas y se repiten review y validación
según el tipo. Una necesidad fuera del objetivo original sigue requiriendo un
change nuevo.

## Specification

### CR1 — Reapertura humana elegible
- **Given** un change `done`, no archivado, con `reviewed !== true`, sin marca de graduación o skip y ausente de releases registradas
- **When** el humano selecciona `Reopen`, escribe un motivo no vacío y confirma
- **Then** el viewer lo mueve a `in-progress`
- **And** el Log registra `status: done → in-progress (human reopened): <reason>` con timestamp UTC

### CR2 — Motivo obligatorio y escritura atómica
- **Given** un change elegible para reapertura
- **When** el humano omite el motivo o la mutación falla
- **Then** el viewer muestra el error y mantiene abierto el detalle
- **And** el archivo permanece byte por byte sin cambios

### CR3 — Fronteras irreversibles
- **Given** un change `done` con `reviewed: true`, una marca real `graduado a spec` o `graduation skipped`, `archived: true` o presencia en un manifiesto de release
- **When** se intenta reabrir por API o interfaz
- **Then** la operación falla con la frontera concreta que lo impide
- **And** no modifica status, Log, spec ni release

### CR4 — Discarded permanece terminal
- **Given** un change `discarded`
- **When** cualquier actor intenta reabrirlo
- **Then** el lifecycle rechaza la transición
- **And** una reconsideración exige un change nuevo que conserve la referencia histórica

### CR5 — Repetir los gates normales
- **Given** un change reabierto a `in-progress`
- **When** termina la corrección dentro de su alcance original
- **Then** vuelve a pasar por `in-review` cuando su tipo lo exige y siempre por `in-validation`
- **And** solo una nueva aceptación humana puede devolverlo a `done`

### CR6 — Log y métricas con reapertura
- **Given** un change aceptado, reabierto y aceptado de nuevo
- **When** `changeledger check` y las métricas reconstruyen su historial
- **Then** la secuencia `in-validation → done → in-progress → ... → done` es válida
- **And** cycle time y throughput usan la última transición a `done` mientras los intervalos previos permanecen auditables

### CR7 — Alcance no se expande silenciosamente
- **Given** un problema descubierto después de la aceptación
- **When** corregirlo requiere comportamiento observable fuera del objetivo autorizado
- **Then** el contrato exige un change nuevo en lugar de usar `Reopen`
- **And** la reapertura se reserva para completar o corregir el alcance original aún no cerrado durablemente

## Plan

- [x] Model conditional `done → in-progress` and its Log event in `src/lifecycle.mjs` and `src/commands/agent.mjs`; verify: `node --test test/lifecycle.test.mjs test/agent.test.mjs` (CR1, CR2, CR3, CR4, CR5) — 2026-07-03T21:59:28Z
- [x] Enforce graduation, archive and release boundaries in `src/commands/agent.mjs` using loaded repo truth; verify: `node --test test/agent.test.mjs test/release.test.mjs` (CR1, CR3) — 2026-07-03T21:59:28Z
- [x] Add the human-only reopen API and detail controls in `src/viewer/domain.mjs` and `src/viewer/public/app.js`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR1, CR2, CR3) — 2026-07-03T21:59:28Z
- [x] Update lifecycle sequence validation and metrics in `src/check.mjs` and `src/metrics.mjs`; verify: `node --test test/check.test.mjs test/metrics.test.mjs` (CR5, CR6) — 2026-07-03T21:59:28Z
- [x] Update `templates/contract/core.md`, lifecycle overlays and `.changeledger/specs/lifecycle.md`; verify: `node --test test/context.test.mjs test/cli.test.mjs` and `changeledger check 20260703-150232` (CR3, CR4, CR5, CR7) — 2026-07-03T21:59:28Z
- [x] Run the complete quality gate after implementation; verify: `pnpm verify` (support) — 2026-07-03T21:59:59Z

## Log

- 2026-07-03T15:02:32Z — Se autorizó reabrir solo mientras el cierre siga
  pendiente; skip, archivo y release se clasificaron como fronteras durables
  además de la graduación a spec.
- **2026-07-03T15:12:15Z** — status: draft → approved
- **2026-07-03T17:15:52Z** — status: approved → in-progress
- **2026-07-03T17:15:52Z** — owner → Roberto Ruiz (auto)
- **2026-07-03T21:59:59Z** — Reopen quedó limitado al viewer humano y al intervalo previo al cierre durable; las cuatro fronteras fallan sin escribir y el historial usa la última aceptación. Suite focalizada 318/318 y gate completo 529/529.
- **2026-07-03T21:59:59Z** — status: in-progress → in-review
- **2026-07-03T22:02:22Z** — review → in-progress (retry): CR3 is not fail-closed against concurrent release recording: reopen snapshots repo.releases before acquiring only the change-file lock, while release recording uses a separate history lock, so a manifest can include the done change before reopen writes in-progress. Coordinate/recheck the release boundary under a shared lock and add a race regression test. Also correct lifecycle.md lines 94-95, which still say the viewer allows only approval and validation transitions and contradict the new reopen transition.
- **2026-07-03T22:06:24Z** — Corrección de review: reapertura y registro de release comparten el lock de historial; la comprobación de membresía ocurre dentro del lock antes de mutar el change. Spec de ownership actualizado.
- **2026-07-03T22:06:24Z** — status: in-progress → in-review
- **2026-07-03T22:08:48Z** — review → in-progress (retry): The shared .history lock correction is logically sound and pnpm verify passes 529/529, but e2fe7c0 adds no concurrency regression test despite the prior retry explicitly requiring one. Add a deterministic test that races reopen against release init/record and asserts the impossible state (change in-progress while a manifest contains its id) never occurs, including no-write behavior for the losing reopen path.
- **2026-07-03T22:10:04Z** — Corrección de review: prueba determinista mantiene el lock de historial, demuestra que reopen espera, publica un release y verifica rechazo sin modificar el change. Gate completo 530/530.
- **2026-07-03T22:10:04Z** — status: in-progress → in-review
- **2026-07-03T22:14:18Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-03T23:03:22Z** — validation → in-progress (human rejected): El tamaño del input y del botón parecen invertidos.
- **2026-07-03T23:07:01Z** — Corrección de rechazo: .validation-controls fijaba grid-template-columns: auto minmax(190px,1fr) auto (3 columnas) pero el panel de reopen solo tiene 2 hijos (.rejection-field, button); el input caía en la columna angosta y el botón en la ancha (1fr), invirtiendo el tamaño esperado. Reducido a 2 columnas: minmax(190px,1fr) auto. Verificado en preview: input 731px / botón 117px en desktop (1400px), input y botón full-width apilados en 680px.
- **2026-07-03T23:07:21Z** — pnpm verify: 534 pruebas ok, 157 changes válidos (check global limpio).
- **2026-07-03T23:07:22Z** — status: in-progress → in-review
- **2026-07-03T23:15:24Z** — Review fail --retry: .validation-controls es compartida por validationPanel() (3 hijos: pass/field/fail) y reopenPanel() (2 hijos); mi fix anterior redujo la clase a 2 columnas y rompió el panel accept/reject (el tercer botón caía en fila implícita). Corrección: reopenPanel usa ahora su propia clase .reopen-controls (minmax(190px,1fr) auto); .validation-controls vuelve a su template original de 3 columnas (auto minmax(190px,1fr) auto). Media query móvil actualizada para ambas clases. Añadido test de regresión (viewer-metadata.test.mjs) que falla si ambos paneles vuelven a compartir clase con conteo de hijos incompatible. Verificado en preview 1400px: reopen 731/117px, accept/reject 112/593/133px.
- **2026-07-03T23:17:39Z** — Revisión (subagente, contexto limpio): PASS, sin defectos. Confirmada separación limpia de clases (.validation-controls solo en validationPanel, .reopen-controls solo en reopenPanel) y que el test de regresión detecta la reincidencia.
- **2026-07-03T23:17:39Z** — status: in-review → in-validation
