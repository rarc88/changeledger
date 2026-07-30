---
id: "20260730-220545"
title: Mantener activo el guard de commit en Windows
type: bug
status: in-review
created: 2026-07-30T22:05:45Z
depends_on: []
owner: rarc88
release_impact: patch
related_to: ["20260726-141124"]
---

## Request

Evitar que `changeledger commit` deje de juzgar las rutas staged bajo
`changes_dir` en Windows. El guard debe conservar la semántica fail-closed y
byte-exacta existente sin normalizar la entrada que Git entrega.

## Investigation

La matriz Windows de Node 24 y 26 ejecuta la suite tras corregir los scripts,
pero los escenarios negativos de `test/commit.test.mjs` terminan creando el
commit en vez de abortar. `stagedFiles()` sí obtiene las entradas del índice;
la frontera calculada por `gitRelative()` desde rutas absolutas nativas no
coincide con las coordenadas repo-relativas que Git publica en Windows, por lo
que `undeclared` queda vacío.

El cambio original `#20260726-141124` gobierna el guard y queda como
`related_to`: no es una dependencia de ejecución. Git documenta
`rev-parse --show-prefix` para obtener el prefijo desde el directorio actual al
top-level y usarlo al trasladar argumentos a las coordenadas del repositorio.
Esa salida es la interfaz externa elegida; la entrada staged continúa siendo
la salida NUL-delimitada de la invocación ya fijada.

## Specification

### CR1 — Rechazar una ruta staged ajena en Windows
- **Given** un repositorio en Windows con un documento ajeno staged bajo `changes_dir`
- **When** se ejecuta `changeledger commit` declarando otro id
- **Then** el comando aborta con `Staged path(s) under the changes directory not declared for this commit: <ruta staged exacta> (declared: <id>)`
- **And** no crea ningún commit

### CR2 — Conservar las coordenadas de Git
- **Given** un ledger en el top-level, uno anidado o uno cuyo `.changeledger` es un symlink interno
- **When** el guard calcula la frontera de `changes_dir`
- **Then** usa un prefijo repo-relativo producido desde las coordenadas de Git
- **And** compara cada entrada staged sin normalizarla ni cambiar sus bytes

### CR3 — Mantener los casos permitidos
- **Given** un documento declarado, `.gitkeep` o una ruta staged fuera de `changes_dir`
- **When** se ejecuta `changeledger commit` en cualquier sistema de la matriz
- **Then** el guard conserva el comportamiento permitido existente

## Plan

- [x] Derivar la frontera de `changes_dir` desde las coordenadas repo-relativas de Git mediante TDD
  - **Target:** `src/commands/commit.mjs`, `src/git.mjs`, `test/commit.test.mjs`
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-30T22:25:00Z`
- [x] Ejecutar el gate completo y la matriz remota
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T22:30:03Z`

## Log

- **2026-07-30T22:05:45Z** `[note]` Borrador creado a partir de 16 escenarios del guard que no abortaron en Windows Node 24/26 después de que el script portable permitió ejecutar la suite.
- **2026-07-30T22:16:38Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T22:22:05Z** `[status]` approved → in-progress
- **2026-07-30T22:26:19Z** `[note]` TDD local: la prueba nueva falló con Expected values to be strictly deep-equal porque no existía ninguna lectura rev-parse --show-prefix; pasó al derivar la frontera en coordenadas Git. El mutante sin prefijo fue detectado. Suite del guard 32/32 y gate completo 1046/1046; queda pendiente la matriz remota Windows.
- **2026-07-30T22:29:57Z** `[note]` Matriz remota 7/7 verde en el run 30587195239: tarball smoke test y verify en Ubuntu, macOS y Windows con Node 24/26; los dos jobs de Windows ejecutaron pnpm verify sin fallos.
- **2026-07-30T22:30:48Z** `[status]` in-progress → in-review
