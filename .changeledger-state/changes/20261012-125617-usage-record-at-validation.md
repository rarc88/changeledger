---
id: "20261012-125617"
title: check valida el instante de los registros de consumo
type: bug
status: in-progress
created: 2026-10-12T12:56:17Z
depends_on: []
branch: bug/20261012-125617
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

- [x] Probar y validar at en check
  - **Target:** `src/check.mjs, test/check.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T13:57:31Z`
- [x] Fijar con un test el filtro de at del análisis
  - **Target:** `test/usage-analysis.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-12T13:57:31Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T13:57:32Z`

## Log
- **2026-10-12T12:56:17Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:44Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T13:51:46Z** `[status]` approved → in-progress
- **2026-10-12T13:51:46Z** `[branch]` set: bug/20261012-125617 (auto)
- **2026-10-12T13:57:30Z** `[note]` Reproducido antes del cambio: check sobre un ledger con registros sin at, con at 123 y con at "ayer" salió con 0. Implementación: usageRecordIssue reporta missing "at" y «at must be an ISO 8601 UTC instant, got <valor>» con la regex ISO_UTC que check ya usa para created y updated; los 114 registros de usage/ de este repo la cumplen y check pasa sobre él. CR3 queda fijado en test/usage-analysis.test.mjs y, por la CLI, en test/analyze.test.mjs (fuera del Target del Plan, que sólo nombraba el primero); quitar la condición de at de isPlaceable los hace fallar. El orquestador actualizó el comentario de isPlaceable en src/usage-analysis.mjs, que decía que check no reporta un at ausente.
- **2026-10-12T13:57:32Z** `[status]` in-progress → in-review
- **2026-10-12T13:57:37Z** `[note]` Mandato de revisión: la superficie que el change gobierna — la validación de registros de consumo en check (usageRecordIssue) y el filtro de at del análisis (isPlaceable) con sus tests, sobre dev..HEAD.
- **2026-10-12T14:01:41Z** `[review]` in-review → in-progress (retry): El comentario de isPlaceable en src/usage-analysis.mjs afirma que check reporta un at que no es un instante ISO UTC, pero ISO_UTC sólo valida la forma: check acepta 2026-99-99T99:99:99Z y 2026-02-30T00:00:00Z. La nota del Log cifra en 114 los registros de usage/; el state ref tiene 105.
