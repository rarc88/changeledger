---
id: "20261007-172316"
title: Decidir el mensaje vacío de Usage sin un análisis por change
type: refactor
status: draft
created: 2026-10-07T17:23:16Z
depends_on: []
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

- [ ] Probar y exportar la cuenta de registros por change desde el módulo
  - **Target:** `src/usage-analysis.mjs, test/usage-analysis.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR3
- [ ] Probar y usar la cuenta en la sección Usage
  - **Target:** `src/viewer/public/app.js, test/view.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T17:23:16Z** `[version]` 0.18.0-dev
