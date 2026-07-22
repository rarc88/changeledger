---
id: "20260722-203027"
title: Validación incremental de batches por blob OID
type: refactor
status: draft
created: 2026-07-22T20:30:27Z
depends_on: ["20260722-202059", "20260722-202058"]
related_to: ["20260721-193106", "20260721-193104", "20260722-202100"]
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

- El primer commit del rango y todo padre que no pertenezca al batch se validan
  como snapshots cerrados con la lectura batch de `20260722-202059`. Los commits
  se recorren en orden topológico; un merge se compara y valida contra **cada**
  padre, no solo contra el primero.
- Cada snapshot validado conserva durante el proceso un índice completo e
  inmutable por colección: changes por id, specs por nombre, releases por
  versión, config/manifest/authority y los índices de dependencias, ciclos,
  relaciones, graduación y releases que usa `checkRepo`. El hijo se deriva por
  copy-on-write desde el índice del padre; los documentos sin cambios siguen
  disponibles para comprobar invariantes globales.
- Para cada arista padre→hijo, `validateReceiveBatch`/`validateStateRef`
  (`src/state-validation.mjs`) obtienen el delta con `diff-tree`, parsean solo
  blobs añadidos o modificados y revalidan la clausura afectada en los índices.
  Esto incluye duplicados, dependencias ausentes/ciclos, relaciones,
  graduaciones/releases y la no-desaparición de `20260722-202058`. Un merge debe
  producir el mismo veredicto completo contra todos sus padres.
- La reutilización es por **blob OID** dentro del batch: inmutable por
  construcción, sin invalidación; el caché muere con el proceso del hook.
- Los límites operacionales (`max_commits`, `max_object_bytes`, `timeout_ms`)
  y todos los rechazos existentes conservan su semántica y diagnósticos.

Objetivo medible con el límite por defecto `max_commits: 256`: fixtures de 1,
50 y 256 commits sobre snapshots de 1.000 y 5.000 changes, con variantes de 1 y
3 documentos modificados por commit. El p95 del batch de 256 commits/5.000
changes debe quedar dentro de `timeout_ms: 30_000`, y las demás escalas se
registran para detectar regresión.

Riesgo a vigilar en review: la equivalencia entre «snapshot cerrado validado
completo» y «padre validado + delta revalidado» debe demostrarse con tests de
equivalencia que corran ambas rutas sobre los mismos DAGs —lineales y con
merges— y exijan idéntico veredicto y diagnóstico normalizado, incluidos
rechazos de cada invariante global.

No-goals: caché entre batches o procesos; relajar ninguna regla de validación.

## Plan

- [ ] Añadir tests de equivalencia completa vs incremental sobre DAGs lineales y merges, con aceptación y rechazos de no-desaparición, duplicados, dependencias/ciclos, relaciones, graduación, releases, config, manifest y authority; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` exige el mismo veredicto y diagnóstico normalizado contra cada padre (support)
- [ ] Implementar en `src/state-validation.mjs` el índice completo por snapshot, la derivación copy-on-write, la clausura afectada y la reutilización por blob OID dentro del batch; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` sin reparsear blobs estables y conservando límites (support)
- [ ] Ejecutar benchmarks de 1/50/256 commits, 1/3 documentos por delta y 1.000/5.000 changes; verify: registrar p50/p95 comparativo en el Log y exigir p95 <30.000 ms para 256 commits sobre 5.000 changes (support)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:27Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: separado de 20260722-202100 porque un caché por OID de commit no evita N snapshots distintos en un batch de N commits; la solución para batches es validación incremental por delta con reutilización por blob OID.
- **2026-07-22T20:41:30Z** `[note]` Readiness reforzada con DAG multi-padre, índice completo para invariantes globales, dependencia explícita de la política de no-desaparición y matriz cuantificada hasta max_commits=256.
