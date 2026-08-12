---
id: "20260812-022248"
title: Los pathspecs del cutover mezclan formas de ruta en Windows
type: bug
status: in-review
created: 2026-08-12T02:22:48Z
depends_on: []
branch: bug/20260812-022248
related_to: ["20260812-020449", "20260809-113240", "20260810-120457"]
owner: rarc88
---

## Request

El error real del CI de Windows, visible gracias al CR2 de
`20260812-020449`: `git status --porcelain -- ../../../..` con pathspecs
que trepan fuera del repo — `ledgerPathspecs` calcula `path.relative` entre
el top-level de git (forma larga, `C:/Users/runneradmin/...`) y un
`changeledgerDir` derivado del cwd, que en Windows conserva la forma corta
8.3 (`RUNNER~1`). En macOS/linux no se ve porque getcwd devuelve el
realpath; en Windows la forma corta sobrevive y el cutover de producción
falla sus precondiciones en cualquier cwd corto.

## Investigation

- `ledgerLayout` (src/commands/cutover.mjs) ya normaliza a POSIX pero no a
  UNA forma de ruta: mezcla la respuesta de git con rutas del caller.
- La lección de `20260810-120457` (walks fs-only para evitar el realpath de
  git) no aplica aquí: este cálculo necesita comparar contra el top-level
  que git mismo reporta, así que la consistencia se logra realpath-eando
  AMBOS lados (`fs.realpathSync.native`), no evitando el realpath.
- El mkdtemp de los helpers de test devuelve la forma del tmpdir del SO
  (corta en Windows, symlink /var en macOS): realpath-earlo en su único
  asiento protege a todas las suites de la clase.

## Specification

### CR1 — Los pathspecs comparten una sola forma de ruta
- **Given** un repo cuyo cwd llega en una forma de ruta distinta a la que git reporta como top-level (en POSIX: un symlink como /var→/private/var; el caso 8.3 de Windows es la misma clase)
- **When** se ejecuta `changeledger cutover`
- **Then** las precondiciones y la limpieza operan con pathspecs relativos correctos (sin ../ que trepe fuera del repo) y el corte aterriza con exit 0

### CR2 — Los fixtures nacen en realpath
- **Given** los helpers de fixture que crean repos temporales
- **When** un test construye un repo
- **Then** la raíz devuelta es el realpath nativo (una sola forma en todos los SO), en el asiento único del mkdtemp

## Plan

- [x] Realpath de ambos lados en ledgerLayout
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-08-12T02:25:36Z`
- [x] Realpath nativo en el mkdtemp de los helpers
  - **Target:** `test/helpers/state-repo.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR2
  - **Resolved:** `2026-08-12T02:25:36Z`
- [x] Gate completo
  - **Target:** `test/cutover.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-12T02:25:37Z`

## Log
- **2026-08-12T02:22:50Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T02:22:50Z** `[status]` approved → in-progress
- **2026-08-12T02:22:50Z** `[branch]` set: bug/20260812-022248 (auto)
- **2026-08-12T02:25:37Z** `[note]` CR1 reproducido en macOS con cwd por symlink (el gemelo POSIX del 8.3) — mismo error 'outside repository' del CI; fix: realpath nativo de ambos lados en ledgerLayout, pathspecs derivados del layout (ledgerDirRel). CR2: realpath en el asiento del mkdtemp. Mandato del review: spot check del diff
- **2026-08-12T02:25:37Z** `[status]` in-progress → in-review
- **2026-08-12T02:30:54Z** `[review]` in-review → in-progress (retry): Residuo del refactor: changeledgerDir quedó como parámetro muerto en assertCleanLedger y exactStagedCleanup (biome noUnusedFunctionParameters) con 5 call sites pasándolo — retirarlo de firmas y llamadas
- **2026-08-12T02:32:04Z** `[status]` in-progress → in-review
- **2026-08-12T02:32:04Z** `[note]` Mandato de la confirmación: mínimo — parámetro muerto retirado de ambas firmas y 5 call sites, biome limpio en el archivo, sin regresión
