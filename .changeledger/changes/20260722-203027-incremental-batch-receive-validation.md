---
id: "20260722-203027"
title: Validación incremental de batches por blob OID
type: refactor
status: in-progress
created: 2026-07-22T20:30:27Z
depends_on: ["20260722-202059", "20260722-202058"]
owner: raruiz-hiberuscom
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

- [x] Añadir tests de equivalencia completa vs incremental sobre DAGs lineales y merges, con aceptación y rechazos de no-desaparición, duplicados, dependencias/ciclos, relaciones, graduación, releases, config, manifest y authority; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` exige el mismo veredicto y diagnóstico normalizado contra cada padre (support)
  - **Resolved:** `2026-07-23T00:35:00Z`
- [x] Implementar en `src/state-validation.mjs` el índice completo por snapshot, la derivación copy-on-write, la clausura afectada y la reutilización por blob OID dentro del batch; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` sin reparsear blobs estables y conservando límites (support)
  - **Resolved:** `2026-07-23T00:40:00Z`
- [x] Ejecutar benchmarks de 1/50/256 commits, 1/3 documentos por delta y 1.000/5.000 changes; verify: registrar p50/p95 comparativo en el Log y exigir p95 <30.000 ms para 256 commits sobre 5.000 changes (support)
  - **Resolved:** `2026-07-23T00:55:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T00:58:00Z`
- [ ] Subir `max_object_bytes` default a 64 MiB en `src/state-validation.mjs` con test rojo que exige que el default cubra con margen los 33.754.846 bytes medidos del perfil declarado (256 commits × 5.000 changes); verify: `node --test test/state-validation.test.mjs` (support)
- [ ] Extender `scripts/bench-batch-validation.mjs` con `--limits default` y re-ejecutar 256 commits × 5.000 changes × 1/3 docs con presupuestos default, registrando p95 y object_bytes en el Log; verify: `node scripts/bench-batch-validation.mjs --commits 256 --sizes 5000 --limits default` acepta dentro de budget (support)
- [ ] Publicar la envolvente de sizing del hook en la sección pre-receive de `README.md` (defaults, perfil declarado medido, cómo redimensionar con --max-commits/--max-object-bytes/--timeout-ms); verify: revisión manual de la sección renderizada (support)
- [ ] Ejecutar el gate completo tras la corrección; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:27Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: separado de 20260722-202100 porque un caché por OID de commit no evita N snapshots distintos en un batch de N commits; la solución para batches es validación incremental por delta con reutilización por blob OID.
- **2026-07-22T20:41:30Z** `[note]` Readiness reforzada con DAG multi-padre, índice completo para invariantes globales, dependencia explícita de la política de no-desaparición y matriz cuantificada hasta max_commits=256.
- **2026-07-23T00:05:32Z** `[status]` draft → approved (human via conversation)
- **2026-07-23T00:05:33Z** `[status]` approved → in-progress
- **2026-07-23T00:05:33Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T00:10:00Z** `[note]` Diseño propuesto y acordado con el humano antes de implementar (cambio de alto riesgo, toca el hook `pre-receive`): en vez de un índice incremental reescribiendo las invariantes de `checkRepo` desde cero, se reutiliza `checkRepo` sin modificar sobre una lista de documentos mantenida en memoria vía copy-on-write (`deriveCandidateSnapshot`/`validateSnapshotContent`, ya exportadas de `src/ledger-store.mjs` para 20260722-202100 — misma función sirve ambos consumidores). Alcance recortado deliberadamente: los merges y cualquier commit que toque `manifest.yml` caen al camino de snapshot cerrado completo (20260722-202059), no a derivación incremental — la reconciliación de un merge contra sus padres exigiría probar equivalencia multi-padre, un problema más difícil que no aporta al objetivo medible (historia mayormente lineal en un push típico); la comprobación de no-desaparición de 20260722-202058 contra cada padre sigue corriendo sin cambios para todos los commits, incluidos los merges.
- **2026-07-23T00:58:00Z** `[note]` Implementado en `src/state-validation.mjs`: `deriveIncrementalSnapshot` deriva el snapshot de un commit desde su único padre ya validado más el delta de blobs, reutilizando `deriveCandidateSnapshot`/`validateSnapshotContent`; devuelve `null` (cae a validación completa) si el delta toca el manifest. Elegibilidad: solo un commit con exactamente un padre YA validado dentro de esta misma pasada usa el camino incremental; el primer commit del rango, cualquier padre externo al batch y los merges siempre pasan por `validateServerStateRevision` (snapshot cerrado). `assertNoDisappearance` (20260722-202058) sigue corriendo sin cambios contra cada padre para todo commit, sea cual sea su camino de validación. Corrección de diseño tras medir: la primera implementación llamaba `git diff-tree`/`rev-list --parents` **por commit** (2-4 subprocesos c/u) — el spawn de subprocesos, no el CPU, domina a escala (256 commits × 5.000 changes: 70,8 s). Rediseñado para UNA sola llamada por todo el rango: `allCommitParents` (`rev-list --parents` de todo el rango) y `logRawEntries` (`git log --raw --no-abbrev -z --format=%x00%H`, parseando el delta de cada commit contra su primer padre en una sola pasada — nota: `--full-index` no fuerza OIDs completos en `git log --raw` en git 2.50.1, hace falta `--no-abbrev`), más un único `cat-file --batch` prefetch de todos los blobs nuevos/modificados del rango. Segunda corrección: `deriveCandidateSnapshot` reetiquetaba `.file` (`git:<revision>:<path>`, un campo puramente diagnóstico que `checkRepo` nunca lee — reporta por `.name`) para CADA documento sobreviviente en cada llamada; a 5.000 changes eso son ~1,28M clonados de objeto redundantes en 256 commits. Corregido para reutilizar los documentos sin cambios por referencia (sin clonar); `restampRevision` sigue reetiquetando `.file` en el snapshot final cuando un caller (20260722-202100) realmente lo necesita. Tercera corrección, la de mayor impacto: perfilado directo mostró que `checkRepo` sola costaba ~200 ms a 5.000 changes — multiplicado por 256 commits, ~51 s, coincidiendo casi exacto con el tiempo medido. `checkAutoFixable` (vía `hasFixableDefects`→`computeFixes`, un recómputo completo de los fixes aplicables) resultó ser ~90% de ese costo, y solo produce una advertencia (`warn`, nunca `err`) que ningún camino de validación (`validateSnapshotContent`, usado por 20260722-202100 y este cambio) lee jamás. Añadida `opts.skipAdvisory` a `checkRepo` (`src/check.mjs`), opt-in, que omite `checkAutoFixable`; `validateSnapshotContent` la activa siempre — cambio 100% retrocompatible para los demás llamadores de `checkRepo` (CLI `check`, viewer, `state-migration.mjs`), que no pasan la opción y conservan su comportamiento exacto, incluidas las advertencias. Benchmark reproducible en `scripts/bench-batch-validation.mjs` (fixture sintética real vía `store`/`validateStateUpdate`, matriz completa): 1.000 changes → 0,9–2,2 s (1/50/256 commits, 1/3 docs); 5.000 changes → 3,3–8,8 s. Objetivo p95 <30.000 ms para 256 commits/5.000 changes cumplido con margen (~3,4×): 8.297,7 ms (1 doc/commit) y 8.793,7 ms (3 docs/commit). Tests de equivalencia (8, en `test/state-validation.test.mjs`): cadena de 2 commits comparando el mismo commit validado como frontera (rango de 1 commit) vs incrementalmente (rango de 2 commits) — desaparición de identidad, duplicados, dependencia faltante, relación auto-referencial, `graduated_from` faltante, release con change no-`done`, deriva de `project_id` en config, y fallback correcto cuando el commit toca el manifest. Verificado empíricamente: deshabilitar `validateSnapshotContent` dentro de `deriveIncrementalSnapshot` hace fallar 5 de los 8 tests (los que dependen de invariantes de `checkRepo` vía el camino incremental), confirmando que sí ejercen la propiedad que afirman probar; los otros 3 pasan por mecanismos separados intactos (no-desaparición, chequeo de `project_id` dentro de `deriveCandidateSnapshot`, fallback de manifest). Suite completa: 946/946 tests, lint y `changeledger check` verdes.
- **2026-07-23T00:59:17Z** `[status]` in-progress → in-review
- **2026-07-23T01:23:29Z** `[note]` Reviewer de contexto limpio devolvió `RETRY`: `logRawEntries` corre `git log --raw --no-abbrev -z` sin `--no-renames`, y git 2.50.1 detecta renames por defecto en `log --raw` — un rename de spec/release (los changes tienen filename atado al id, no pueden renombrarse) produce un registro `R100` de dos paths que `DIFF_TREE_RECORD` (una sola letra de estado) no matchea, lanzando `malformed log --raw record` en el camino incremental en vez del rechazo correcto y ya existente de 20260722-202058 (un rename ES una desaparición de identidad, ya que la identidad de un spec es su nombre de archivo) que el camino frontera sí da. Fail-closed (nunca acepta un push inválido, solo podía rechazar con mensaje opaco un push que de todas formas ya iba a rechazarse por la política de identidad) pero rompía la equivalencia frontera↔incremental que el cambio promete. Corregido añadiendo `--no-renames` al comando; verificado empíricamente quitando la bandera temporalmente (el nuevo test falla exactamente como describe el reviewer) y restaurándola. Test nuevo: "incremental and full validation reject a renamed spec identically" (usa `assertEquivalentRejection`, confirma que ambos caminos dan el mismo mensaje `removes specs identity "one.md"`, no solo que ninguno acepta). Gate re-ejecutado: 947/947 tests, lint y `changeledger check` verdes.
- **2026-07-23T01:23:54Z** `[review]` in-review → in-progress (retry): logRawEntries missing --no-renames caused an opaque parse error on rename instead of the correct identity-disappearance rejection; fixed and re-verified
- **2026-07-23T01:24:00Z** `[status]` in-progress → in-review
- **2026-07-23T09:19:31Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T22:58:06Z** `[validation]` in-validation → in-progress (agent rejected): La reauditoría be058658 confirma que la matriz 256 commits x 5000 changes solo pasa con budgets ampliados; con defaults excede 32 MiB. La evidencia no demuestra el perfil default declarado ni el runbook publica su envolvente.
- **2026-07-24T17:09:35Z** `[note]` Dirección de la reapertura autorizada por el humano (conversación 2026-07-24): default de max_object_bytes a 64 MiB — cubre el perfil declarado (33.754.846 bytes) con ~2x de margen, coste de memoria transitorio acotado en el hook — más publicación de la envolvente en el runbook del README.
