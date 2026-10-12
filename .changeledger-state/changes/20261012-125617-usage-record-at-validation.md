---
id: "20261012-125617"
title: check valida el instante de los registros de consumo
type: bug
status: approved
created: 2026-10-12T12:56:17Z
depends_on: []
related_to: ["20261002-133728", "20261007-172316"]
owner: rarc88
---

## Request

La revisión de `20261002-133728` y la de `20261007-172316` observaron que
`changeledger check` no valida el campo `at` de los registros de consumo y que
`changeledger analyze` descarta en silencio un registro cuyo `at` no es texto:
nadie avisa de que ese registro no cuenta. Además, ningún test detecta que se
quite ese filtro del análisis. Se pide que `check` rechace un registro con un
`at` ausente o mal formado, y que el comportamiento del análisis ante esos
registros quede fijado por un test.

## Investigation

`usageRecordIssue` en `src/check.mjs` valida el nombre del archivo, que el
contenido sea un objeto, `schema` y `change`, pero no `at`. En
`src/usage-analysis.mjs`, el predicado `isPlaceable` exige
`typeof record.at === 'string'` y lo comparten `validRecords` y
`usageRecordCounts`; la revisión de `20261007-172316` quitó esa condición en una
copia y los 173 tests de `test/usage-analysis.test.mjs` y `test/view.test.mjs`
siguieron en verde. El colector (`src/usage-collector.mjs`) escribe `at` con el
instante ISO UTC de la transición.

Interfaces externas: ninguna.

## Specification

### CR1 — check rechaza un at ausente
- **Given** un ledger con un registro de consumo sin el campo `at`
- **When** se ejecuta `changeledger check` en ambos layouts
- **Then** termina con código distinto de cero con un error que empieza por `usage record <nombre>: ` y contiene `missing "at"`

### CR2 — check rechaza un at mal formado
- **Given** registros con `at` igual a `123` y a `"ayer"`
- **When** se ejecuta `changeledger check`
- **Then** cada uno produce un error que empieza por `usage record <nombre>: ` y dice que `at` debe ser un instante ISO UTC

### CR3 — El análisis no atribuye un registro sin at válido
- **Given** un registrador con un registro válido seguido de uno cuyo `at` es `123`
- **When** se ejecuta `changeledger analyze --json`
- **Then** el segundo registro no cierra ningún tramo y un test falla si se quita esa condición de `isPlaceable`

## Plan

- [ ] Probar y validar at en check
  - **Target:** `src/check.mjs, test/check.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Fijar con un test el filtro de at del análisis
  - **Target:** `test/usage-analysis.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR3
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T12:56:17Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:44Z** `[status]` draft → approved (human via conversation)
