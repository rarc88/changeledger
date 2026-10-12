---
id: "20261012-141915"
title: analyze avisa de los registros de consumo que no puede ubicar
type: feature
status: in-progress
created: 2026-10-12T14:19:15Z
depends_on: []
branch: feature/20261012-141915
related_to: ["20261012-125617", "20261002-140038"]
owner: rarc88
---

## Request

La revisión de `20261012-125617` observó que `changeledger analyze` descarta sin
avisar los registros de consumo que no puede ubicar, y que sí ubica un registro
cuyo `at` es texto pero sin la forma `YYYY-MM-DDTHH:MM:SSZ` (por ejemplo
`"ayer"`), aunque `check` lo rechaza. Se pide que `analyze` avise de cuántos
registros del ledger no ubica, y que deje de ubicar un `at` sin esa forma.

Excluido: mostrar ese aviso en el panel Usage del viewer.

## Investigation

En `src/usage-analysis.mjs`, el predicado `isPlaceable` exige un registro
legible, `schema: 1`, `change` presente y `typeof record.at === 'string'`; lo
comparten `validRecords` y `usageRecordCounts`, este último también usado por el
viewer, así que alinear la forma de `at` cambia también los recuentos del panel
Usage. Las pistas de `analyzeUsage` son textos con prefijo (`unpriced:`,
`failed:`, `gap:` …) que `src/commands/analyze.mjs` imprime tras las cifras y
`--json` devuelve en `hints`. `check` valida `at` con la regex `ISO_UTC` de
`src/check.mjs`.

Interfaces externas: ninguna.

## Proposal

`analyzeUsage` cuenta los registros del ledger que `isPlaceable` rechaza y, si
hay alguno, añade la pista `skipped:` a las demás; `isPlaceable` exige para `at`
la misma forma que `check`. El recuento es del ledger entero y no del change
pedido, porque un registro sin `change` válido no se puede atribuir a ninguno.

Descartadas: avisar de cada registro por nombre, que duplica el informe de
`check` y crece con el ledger; y hacer fallar `analyze` ante un registro
inválido, que impediría analizar el resto, cuando `check` ya es el gate.

## Specification

### CR1 — Un registro que no se ubica se anuncia
- **Given** un ledger con un registro válido del change A y otro de A cuyo `at` es `123`
- **When** se ejecuta `changeledger analyze A` y `changeledger analyze A --json`
- **Then** la salida de texto incluye `skipped: 1 usage record(s) in the ledger cannot be placed; changeledger check reports why` y `hints` del JSON contiene ese mismo texto

### CR2 — Un at sin la forma de check no se ubica
- **Given** un registrador con un registro válido seguido de uno cuyo `at` es `"ayer"`
- **When** se ejecuta `changeledger analyze --json`
- **Then** el segundo registro no cierra ningún tramo y la pista `skipped:` lo cuenta

### CR3 — Un ledger sin registros inválidos no muestra la pista
- **Given** un ledger cuyos registros pasan `changeledger check`
- **When** se ejecuta `changeledger analyze --json`
- **Then** ningún elemento de `hints` empieza por `skipped:`

## Plan

- [x] Escribir pruebas fallidas de la pista y de la forma de at
  - **Target:** `test/usage-analysis.test.mjs, test/analyze.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-12T16:19:10Z`
- [x] Contar los registros no ubicables y exigir la forma de at en isPlaceable
  - **Target:** `src/usage-analysis.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-12T16:19:10Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T16:19:10Z`

## Log
- **2026-10-12T14:19:15Z** `[version]` 0.18.0-dev
- **2026-10-12T15:24:01Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T16:14:15Z** `[status]` approved → in-progress
- **2026-10-12T16:14:15Z** `[branch]` set: feature/20261012-141915 (auto)
- **2026-10-12T16:19:09Z** `[note]` Reproducido antes del cambio con analyzeUsage: un registro con at "ayer" se ubicaba y cerraba un tramo, uno con at 123 se descartaba, y ninguno producía aviso. Implementación: isPlaceable exige además isIsoUtc(record.at), reutilizado de src/lifecycle.mjs, que usage-analysis ya importaba; analyzeUsage cuenta sobre todo el ledger los registros que isPlaceable rechaza y añade al final la pista skipped:. Sobre el ledger de este repo, analyze --json no emite skipped:. Mutantes M1–M4 fallaron por la aserción esperada.
- **2026-10-12T16:19:11Z** `[status]` in-progress → in-review
- **2026-10-12T16:19:16Z** `[note]` Mandato de revisión: la superficie que el change gobierna — isPlaceable y la pista skipped: de analyzeUsage en src/usage-analysis.mjs, su salida por changeledger analyze y el efecto en los recuentos del viewer, con sus tests, sobre dev..HEAD.
- **2026-10-12T16:24:16Z** `[review]` in-review → in-progress (retry): docs/usage-capture.md enumera las pistas de analyze (rework … failed … gap) y no incluye skipped, que este change añade.
