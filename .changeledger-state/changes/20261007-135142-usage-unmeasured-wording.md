---
id: "20261007-135142"
title: Decir sin consumo atribuido en lugar de sin registros cuando hay registros
type: bug
status: in-validation
created: 2026-10-07T13:51:42Z
depends_on: []
branch: bug/20261007-135142
related_to: ["20261002-140038", "20261002-140242"]
owner: rarc88
---

## Request

`changeledger analyze` y el panel Usage del viewer dicen «no usage records» en
casos en los que sí hay registros. El aviso
`unmeasured: <n> change(s) have no usage records` cuenta también los changes
cuyos registros tienen todos `error` o cuyo único registro con datos es la base
de su registrador, y la sección Usage del viewer dice
`No usage records for the current filters.` aunque los changes filtrados tengan
registros sin consumo atribuido. Quien lee el aviso concluye que el colector no
registró nada, cuando lo que pasa es que no hubo tramo que atribuir. Se pide que
cada texto diga lo que de verdad ocurre.

Queda fuera de este change cualquier cambio en la atribución o en qué changes
cuentan como medidos (lo fijó `20261002-140038`).

## Investigation

En `src/usage-analysis.mjs`, `analyzeUsage` cuenta `unmeasured` como los
changes conocidos (documentos o registros) sin ningún tramo atribuido
(`measured` sale de las contribuciones), así que incluye changes con registros
sólo de base o sólo con `error`, y emite
`unmeasured: ${n} change(s) have no usage records` sólo sin `id`.

`src/commands/analyze.mjs` ya distingue: `nothingMessage` imprime
`no usage data` si hay archivos de registro y `no usage records` si no hay
ninguno. En el viewer, `changeUsageHtml` de
`src/viewer/public/view-renderers.js` también distingue
(`No usage records for this change.` frente a `No usage data for this change.`),
pero `usageSectionHtml` imprime `No usage records for the current filters.`
siempre que no hay changes medidos.

Tests que fijan los literales: en `test/analyze.test.mjs`, `CR9: a ledger
without usage records is not an error` y los tests CR13 por la CLI; en
`test/usage-analysis.test.mjs`, los tests CR13 y `140242: ids drops unlisted and
unmeasured changes…`; en `test/view.test.mjs`, `140242 CR6: with no records
among the filtered changes the section says so…`. La spec `usage.md` nombra el
aviso `unmeasured`.

Interfaces externas: ninguna.

## Specification

### CR1 — El aviso unmeasured no afirma que falten registros
- **Given** un ledger con un change sin registros, un change cuyo único registro con datos es la base de su registrador y un change con dos registros con `error`
- **When** se ejecuta `changeledger analyze --json`
- **Then** `hints` contiene `unmeasured: 3 change(s) have no attributed usage`
- **And** ningún aviso contiene `have no usage records`

### CR2 — La sección Usage distingue registros sin datos de la ausencia de registros
- **Given** el viewer con un proyecto cuyos changes filtrados tienen registros pero ningún tramo atribuido
- **When** se abre la vista `metrics`
- **Then** la sección `Usage` muestra `No usage data for the current filters.`

### CR3 — Sin registros la sección conserva su mensaje
- **Given** el viewer con un proyecto cuyos changes filtrados no tienen ningún registro
- **When** se abre la vista `metrics`
- **Then** la sección `Usage` muestra `No usage records for the current filters.`

## Plan

- [x] Probar y cambiar el texto del aviso unmeasured en el módulo y la CLI
  - **Target:** `src/usage-analysis.mjs, test/usage-analysis.test.mjs, test/analyze.test.mjs`
  - **Verify:** `node --test test/usage-analysis.test.mjs test/analyze.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-07T16:21:51Z`
- [x] Probar y distinguir el mensaje vacío de la sección Usage
  - **Target:** `src/viewer/public/view-renderers.js, src/viewer/public/app.js, test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-10-07T16:21:51Z`
- [x] Ajustar la documentación del colector
  - **Target:** `docs/usage-capture.md`
  - **Verify:** `pnpm test`
  - **Support:**
  - **Resolved:** `2026-10-07T16:21:52Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-07T16:21:52Z`

## Log
- **2026-10-07T13:51:42Z** `[version]` 0.18.0-dev
- **2026-10-07T15:02:53Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T16:17:26Z** `[status]` approved → in-progress
- **2026-10-07T16:17:26Z** `[branch]` set: bug/20261007-135142 (auto)
- **2026-10-07T16:21:53Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1 a 4: el aviso pasa a unmeasured: <n> change(s) have no attributed usage; usageSectionAnalyses devuelve recorded (verdadero si hay un change medido o si algún id filtrado tiene records > 0 según analyzeUsage con id) y usageSectionHtml elige No usage data for the current filters. o No usage records for the current filters.; docs/usage-capture.md nombra el aviso. Red con literales en 7 tests de módulo y CLI y en CR2 del viewer; mutantes: texto antiguo del aviso, mensaje fijo en records, mensaje fijo en data y recorded calculado sobre todo el repo; todos fallan. pnpm verify en verde con 1759/1759. Decisiones no especificadas: recorded sin nuevo campo en el JSON de analyze; recorded ausente equivale a sin registros; la documentación no describe los mensajes del viewer. Residuos: la spec usage.md nombra el texto antiguo (se actualiza en la graduación); una línea larga previa en docs/usage-capture.md.
- **2026-10-07T16:21:53Z** `[status]` in-progress → in-review
- **2026-10-07T16:21:57Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR3 y el Plan, con las decisiones no especificadas y los residuos del Log como puntos de escrutinio.
- **2026-10-07T16:27:04Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-07T16:27:08Z** `[note]` Corrección del residuo del Log: la línea larga de docs/usage-capture.md (101 columnas, la que nombra no usage data y no usage records) la crea este diff, no es previa. Observaciones del review para seguimiento: con un change filtrado cuyo único archivo de registro es ilegible, la sección dice No usage records (como el detalle y analyze <id>) mientras el listado de la CLI diría no usage data; cuando ningún change filtrado está medido, recorded lanza un análisis por id (577 ms con 400 changes y 2000 registros frente a 18 ms); el test de CR2 del viewer cubre registros sólo de base y no sólo con error.
