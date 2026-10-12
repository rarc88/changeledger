---
id: "20261007-172316"
title: Decidir el mensaje vacío de Usage sin un análisis por change
type: refactor
status: done
created: 2026-10-07T17:23:16Z
depends_on: []
archived: true
reviewed: true
branch: refactor/20261007-172316
related_to: ["20261007-135142", "20261002-140242"]
owner: rarc88
---

## Request

La sección Usage del viewer decide su mensaje vacío con un análisis completo del
proyecto por cada change filtrado cuando ninguno está medido. La revisión de
`20261007-135142` midió 577 ms con 400 changes filtrados y 2000 registros,
frente a 18 ms cuando hay un change medido. Se pide decidir el mensaje sin
repetir el análisis por change, con los mismos mensajes que hoy.

## Proposal

`src/usage-analysis.mjs` ya cuenta los registros bien formados de cada change
(`records` en la salida con `id`). El módulo exporta esa cuenta como función
pura, la misma que usa `analyzeUsage`, y `usageSectionAnalyses` en
`src/viewer/public/app.js` la usa una vez para saber si algún change filtrado
tiene registros, en lugar de llamar a `analyzeUsage` con `id` por cada uno.

Alternativa descartada: añadir un campo nuevo a la salida de `analyze --json`,
que cambiaría el esquema público para un detalle del viewer.

## Specification

### CR1 — Los mensajes no cambian
- **Given** los escenarios de `20261007-135142`: changes filtrados con registros pero ningún tramo atribuido, y changes filtrados sin registros
- **When** se pinta la sección Usage
- **Then** muestra `No usage data for the current filters.` y `No usage records for the current filters.` respectivamente, como hoy

### CR2 — Tres análisis por pintado
- **Given** 400 changes filtrados, ninguno medido, en un proyecto con registros
- **When** `usageSectionAnalyses` calcula la sección
- **Then** llama a `analyzeUsage` exactamente tres veces (segment, model y version)

### CR3 — La cuenta es la del análisis
- **Given** un ledger con registros válidos, uno con `error` y un archivo ilegible
- **When** se comparan la cuenta exportada y `records` de `analyzeUsage` con `id` para cada change
- **Then** coinciden en todos los changes del ledger

## Plan

- [x] Probar y exportar la cuenta de registros por change desde el módulo
  - **Target:** `src/usage-analysis.mjs, test/usage-analysis.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-12T12:37:21Z`
- [x] Probar y usar la cuenta en la sección Usage
  - **Target:** `src/viewer/public/app.js, test/view.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T12:37:21Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T12:37:22Z`

## Log
- **2026-10-07T17:23:16Z** `[version]` 0.18.0-dev
- **2026-10-12T11:14:36Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T12:31:21Z** `[status]` approved → in-progress
- **2026-10-12T12:31:21Z** `[branch]` set: refactor/20261007-172316 (auto)
- **2026-10-12T12:37:22Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1 a 3: src/usage-analysis.mjs exporta usageRecordCounts(usage), un Map por change con los registros bien formados (predicado isPlaceable compartido con validRecords), y analyzeUsage toma de ahí su records; usageSectionAnalyses recibe esa función como cuarto argumento y calcula recorded con una sola llamada. Antes: 403 llamadas a analyzeUsage con 400 changes filtrados sin medir; después: 3. Red de CR2 con 403 !== 3 y de CR3 por la exportación ausente; CR1 son los tests existentes de 20261007-135142 y 140242 CR6, verdes antes y después. Mutantes: volver a la búsqueda por id, recorded sin filtrar, la cuenta sin los registros con error y la cuenta sin comprobar schema; todos fallan. pnpm verify en verde con 1816/1816. Decisiones no especificadas: nombre y forma Map de la exportación; cuarto argumento obligatorio porque el módulo se carga dinámicamente; se quita el atajo por changes medidos. Residuos: el detalle de un change sigue analizando con id una vez por vista; analyzeUsage recorre los registros dos veces; el comentario de validRecords queda sobre el predicado.
- **2026-10-12T12:37:23Z** `[status]` in-progress → in-review
- **2026-10-12T12:37:28Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR3 y el Plan, con las decisiones no especificadas y residuos del Log como puntos de escrutinio. Frases cuantificadas informadas: el título del test CR3 «for every change of the ledger» (bucle sobre A, B, C y D, con mutantes 3 y 4); el título del test CR2 (3 llamadas frente a 403); el comentario de usageRecordCounts «It is the records figure analyzeUsage reports for a change (0 for a change that has none)» (comparado en CR3 para C y D); y el comentario de app.js «once, instead of analysing the project again for each change» (CR2).
- **2026-10-12T12:43:58Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-12T12:44:03Z** `[note]` Observaciones del review para seguimiento (anteriores al change): ningún test detecta que se quite de isPlaceable el filtro de at no string; el comentario de usageSectionAnalyses dice whether any of changes has a usage record cuando cuentan sólo los registros que el análisis puede situar. El revisor comparó analyze --json de dev y de HEAD sobre el ledger real con y sin --by: idénticos byte a byte.
- **2026-10-12T12:51:53Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-12T12:52:12Z** `[graduation]` skipped: refactor interno sin cambio observable: los mensajes de la sección Usage y el esquema de analyze --json no cambian
- **2026-10-12T12:52:14Z** `[archive]` archived
