---
id: "20260723-235906"
title: Distinguir ausencia y fallo al leer refs locales
type: bug
status: done
created: 2026-07-23T23:59:06Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193102", "20260721-193106", "20260722-202057", "20260723-202646"]
release_impact: patch
---

## Request

El segundo review limpio de `20260723-202646` reprodujo que una mutación puede
continuar si falla la lectura de `refs/changeledger/pending`: varios lectores
locales capturan cualquier error de Git como si la ref estuviera ausente. La
selección de verdad, sync, mutaciones y recovery deben distinguir ausencia real
de una lectura no fiable y fallar antes de servir o escribir estado.

## Investigation

`optionalRefOid` y `state-validation` ya clasifican correctamente el status 1
de `git rev-parse --verify --quiet` como ref ausente, pero quedan implementaciones
paralelas con `catch { return null }` o catches que ignoran el resultado:

- `mutateState` consulta pending y continúa tras cualquier excepción;
- `state-store.resolveRef` y `state-migration.resolveRefOrNull` históricamente
  compartían la misma ambigüedad;
- `gitStateRevision` tenía sondeos propios para confirmed/pending.

La causa es duplicación de semántica, no un fallo de Git concreto. Un missing
real tiene status 1; EACCES, corrupción, ejecución fallida u otra incapacidad de
leer no prueban ausencia. El comportamiento legacy fuera de un repo Git sigue
siendo válido únicamente antes de intentar resolver refs.

## Specification

### CR1 — Toda lectura local distingue missing de error
- **Given** cualquier ruta local que consulta activation, confirmed, observed o pending
- **When** `rev-parse --verify --quiet` devuelve status 1
- **Then** la ref se trata como ausente
- **And** para cualquier otro error falla con `cannot read Git ref <ref>: <cause>` sin seleccionar otra fuente de verdad

### CR2 — Una mutación no continúa con pending desconocido
- **Given** una réplica v2 activada y una mutación con revisión esperada válida
- **When** falla operacionalmente la lectura de `refs/changeledger/pending`
- **Then** la mutación falla antes de crear objetos, mover refs o publicar
- **And** confirmed, observed y pending conservan exactamente sus OIDs anteriores

### CR3 — Legacy y ref ausente conservan su comportamiento
- **Given** un ledger worktree fuera de Git o una réplica donde la ref consultada realmente no existe
- **When** se carga el ledger o se evalúa una operación permitida
- **Then** el modo legacy o la rama de ausencia documentada sigue funcionando sin falsos errores

## Plan

- [x] Añadir regresiones con runners inyectados para selección, carga y mutación; verificar ausencia de objetos/refs nuevos; verify: `node --test test/ledger-store.test.mjs` (support)
  - **Resolved:** `2026-07-24T00:03:40Z`
- [x] Unificar la clasificación de refs en `src/ledger-store.mjs`, `src/state-store.mjs` y `src/state-migration.mjs`, eliminando catches permisivos; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs test/state-migration.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-24T00:03:48Z`
- [x] Ejecutar `pnpm verify` tras la corrección (support)
  - **Resolved:** `2026-07-24T00:05:20Z`

## Log

- **2026-07-23T23:59:06Z** `[note]` Draft creado al dividir 20260723-202646 después de su segundo rechazo; esta frontera posee únicamente la semántica uniforme de lectura de refs y la prohibición de mutar con pending desconocido.
- **2026-07-24T00:01:13Z** `[status]` draft → approved (human via conversation)
- **2026-07-24T00:01:40Z** `[status]` approved → in-progress
- **2026-07-24T00:01:40Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-24T00:05:26Z** `[note]` Implementación: optionalRefOid gobierna selección, carga y mutación; state-store y state-migration distinguen únicamente status 1 como missing. Regresión de fallo único en pending prueba que mutator no se invoca ni cambian refs. 149/149 focalizadas y pnpm verify 1.076/1.076; 241 changes válidos.
- **2026-07-24T00:05:30Z** `[status]` in-progress → in-review
- **2026-07-24T00:13:27Z** `[review]` in-review → in-progress (retry): La regresión CR2 no compara observed ni el inventario de objetos antes/después; también debe actualizar su trazabilidad y un comentario obsoleto.
- **2026-07-24T00:17:23Z** `[status]` in-progress → in-review
- **2026-07-24T00:23:54Z** `[review]` in-review → in-progress (retry): CR2: la ruta online ejecuta syncStateReplica antes de leer pending; un fallo posterior puede ocurrir después de crear objetos o mover observed/confirmed. Adelantar la lectura fail-closed y cubrir la ruta online sin cambios de objetos/refs.
- **2026-07-24T00:27:49Z** `[note]` Corrección del retry: las mutaciones online y prepareMutation sondean pending con semántica fail-closed antes de cualquier sync; la regresión online compara confirmed, observed, pending e inventario de objetos. 149/149 focalizadas y pnpm verify 1.076/1.076; 241 changes válidos.
- **2026-07-24T00:27:49Z** `[status]` in-progress → in-review
- **2026-07-24T00:35:17Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:45:58Z** `[validation]` in-validation → done (human accepted)
