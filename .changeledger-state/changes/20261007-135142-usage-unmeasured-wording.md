---
id: "20261007-135142"
title: Decir sin consumo atribuido en lugar de sin registros cuando hay registros
type: bug
status: in-progress
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
- [ ] Probar y distinguir el mensaje vacío de la sección Usage
  - **Target:** `src/viewer/public/view-renderers.js, src/viewer/public/app.js, test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR2, CR3
- [ ] Ajustar la documentación del colector
  - **Target:** `docs/usage-capture.md`
  - **Verify:** `pnpm test`
  - **Support:**
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T13:51:42Z** `[version]` 0.18.0-dev
- **2026-10-07T15:02:53Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T16:17:26Z** `[status]` approved → in-progress
- **2026-10-07T16:17:26Z** `[branch]` set: bug/20261007-135142 (auto)
