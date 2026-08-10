---
id: "20260809-194233"
title: Blindar la selección y el resume del cutover
type: bug
status: in-review
created: 2026-08-09T19:42:33Z
depends_on: ["20260809-131004"]
branch: bug/20260809-194233
related_to: []
owner: rarc88
---

## Request

Consolida los follow-ups de selección/resume que dejaron las dos
confirmaciones de `20260809-131004` (autorizado por el humano el 2026-08-09):
un empate de baseline entre varios registros de corte se resuelve hoy por
topología en vez de fallar cerrado, y dos invariantes reales quedaron
guardados solo por comentarios o por la mitad de sus formas.

## Investigation

Los tres hallazgos vienen de las confirmaciones de `20260809-131004`,
ejecutados en fixtures por los revisores:

- **Empate de baseline.** Los oids de baseline no son identificadores únicos:
  con fechas de committer fijadas, un re-corte de contenido idéntico
  reproduce el mismo oid, y dos commits distintos pueden llevar el mismo
  trailer si se forja a mano (un `cherry-pick` real del commit de corte sobre
  contenido divergente conflictúa — no ocurre en silencio). Ejecutado: con un
  corte real `C1` y un `C1'` forjado en rama lateral mergeada `-s ours`,
  `findCutover` elige `C1'` (primero por topología) y `--undo` restaura
  contenido que nunca se publicó, borrando la ref que sostenía el real. La
  regla vigente (el registro cuyo baseline concuerda con la ref) debe fallar
  cerrado cuando concuerda más de uno.
- **`--first-parent` de `findCompletedUndo` sin test.** El mutante que lo
  elimina sobrevive a la suite entera; el escenario que lo justifica (un undo
  manual en rama lateral mergeado `-s ours` debe seguir permitiendo el undo
  real) solo existió fuera de suite. El invariante vive en un comentario de
  `src/commands/cutover.mjs`.
- **Brazo `activated`-only del gate del señuelo sin escenario.** El gate
  `(tip !== null || activated)` del fallo por trailer solo tiene ejercitado
  el camino `tip !== null` (y el mutante del gate completo); la forma "solo
  activación presente, sin ref de estado" no tiene escenario dedicado.

## Specification

### CR1 — Empate de baseline falla cerrado
- **Given** una historia con dos commits de corte alcanzables cuyo trailer declara el mismo baseline que la ref de estado sostiene
- **When** se ejecuta `changeledger cutover --undo` (o el re-run de `cutover`)
- **Then** el comando falla con exit distinto de cero nombrando ambos oids y pidiendo resolución manual, sin revertir ni tocar refs

### CR2 — El undo descartado queda anclado en suite
- **Given** un corte en la rama de integración y un undo manual en rama lateral mergeado con `-s ours` (el ledger sigue ausente del worktree)
- **When** se ejecuta `changeledger cutover --undo`
- **Then** exit 0: undo real, ledger restaurado byte a byte y refs borradas
- **And** el mutante que elimina `--first-parent` de `findCompletedUndo` muere exactamente por este test

### CR3 — El señuelo con solo activación presente
- **Given** un repo con activación presente, sin ref de estado, y un commit señuelo sin trailer con el subject exacto
- **When** se ejecuta `changeledger cutover`
- **Then** el fallo es el de trailer no verificable nombrando el oid (no el de media publicación), con exit distinto de cero y sin escribir nada

## Plan

- [x] Fallar cerrado ante empate de baseline en la selección del corte vivo
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-08-10T00:58:27Z`
- [x] Test del escenario `-s ours` que fija el `--first-parent` de
  `findCompletedUndo`
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-08-10T00:58:27Z`
- [x] Escenario dedicado del brazo activated-only del gate del señuelo
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-08-10T00:58:27Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T00:58:27Z`

## Log
- **2026-08-10T00:38:56Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T00:49:35Z** `[status]` approved → in-progress
- **2026-08-10T00:49:35Z** `[branch]` set: bug/20260809-194233 (auto)
- **2026-08-10T00:58:28Z** `[status]` in-progress → in-review
- **2026-08-10T00:58:28Z** `[note]` Mandato del review: superficie que gobierna (src/commands/cutover.mjs + test/cutover.test.mjs, diff cerrado de la rama del carril), con las 4 decisiones no especificadas del implementador como escrutinio: forma del error de ambigüedad; empate detectado solo entre registros que concuerdan con la ref (dos registros con baseline que la ref NO sostiene siguen cayendo al stand-in de diagnóstico); decoy CR1 con --allow-empty; y verificación de que los dos mutantes reportados (first-parent de findCompletedUndo, gate estrechado) matan exactamente su test.
