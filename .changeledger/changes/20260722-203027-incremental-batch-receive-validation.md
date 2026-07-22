---
id: "20260722-203027"
title: Validación incremental de batches por blob OID
type: refactor
status: draft
created: 2026-07-22T20:30:27Z
depends_on: ["20260722-202059"]
related_to: ["20260721-193106", "20260721-193104", "20260722-202100", "20260722-202058"]
release_impact: patch
---

## Request

La auditoría `20260721-193106` midió que el hook de `pre-receive` agota su
presupuesto de 30 s desde 1.000 changes. `20260722-202059` (lectura batch) deja
un update de **un** commit dentro del presupuesto, pero un batch de N commits
sigue costando N validaciones completas: cada commit del rango tiene un
snapshot distinto, así que reutilizar por OID de commit (`20260722-202100`) no
ayuda entre commits. Sin validación incremental, un push legítimo de varios
commits de estado sobre un ledger grande sigue expirando.

## Proposal

Validar el delta, no el snapshot completo, para los commits interiores de un
rango:

- El primer commit del rango se valida completo (snapshot cerrado, con la
  lectura batch de `20260722-202059`).
- Para cada commit siguiente, `validateReceiveBatch`/`validateStateRef`
  (`src/state-validation.mjs`) obtienen el delta con `diff-tree` contra el
  padre ya validado y revalidan únicamente: los documentos añadidos o
  modificados (por blob OID — un blob idéntico ya validado en este batch no se
  re-parsea), las reglas de transición entre snapshots (incluida la política de
  no-desaparición de `20260722-202058` si ya está integrada) y los invariantes
  globales afectados por el delta (manifest/config/authority/integration
  branch).
- La reutilización es por **blob OID** dentro del batch: inmutable por
  construcción, sin invalidación; el caché muere con el proceso del hook.
- Los límites operacionales (`max_commits`, `max_object_bytes`, `timeout_ms`)
  y todos los rechazos existentes conservan su semántica y diagnósticos.

Objetivo medible: un batch de N commits cuesta una validación completa más N−1
deltas; a 5.000 changes con deltas típicos (1–3 documentos por commit), el
batch completo queda dentro del presupuesto de 30 s.

Riesgo a vigilar en review: la equivalencia entre «snapshot cerrado validado
completo» y «padre validado + delta revalidado» debe demostrarse con tests de
equivalencia que corran ambas rutas sobre los mismos rangos y exijan idéntico
veredicto, incluidos rechazos.

No-goals: caché entre batches o procesos; relajar ninguna regla de validación.

## Plan

- [ ] Añadir tests de equivalencia (ruta completa vs incremental sobre los mismos rangos, aceptación y rechazo idénticos) y el benchmark de batch multi-commit a 1.000/5.000 en `test/state-validation.test.mjs`/`test/state-receive.test.mjs`; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR de equivalencia)
- [ ] Implementar la validación incremental por delta con reutilización por blob OID en `src/state-validation.mjs`, conservando límites y diagnósticos; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR de equivalencia)
- [ ] Re-ejecutar el benchmark de hook por volumen contra el objetivo (batch N commits dentro de 30 s a 5.000); verify: benchmark comparativo en el Log (support)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:27Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: separado de 20260722-202100 porque un caché por OID de commit no evita N snapshots distintos en un batch de N commits; la solución para batches es validación incremental por delta con reutilización por blob OID.
