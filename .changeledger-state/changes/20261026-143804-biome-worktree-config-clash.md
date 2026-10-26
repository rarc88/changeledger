---
id: "20261026-143804"
title: Un worktree de la app aborta el lint del repo padre
type: change
status: done
created: 2026-10-26T14:38:04Z
depends_on: []
reviewed: true
branch: change/20261026-143804
related_to: ["20260613-215319"]
owner: raruiz-hiberuscom
---

## Request

`pnpm lint` y, con él, `pnpm verify` abortan en cuanto existe un worktree bajo
`.claude/worktrees/`:

```
× Found a nested root configuration, but there's already a root configuration.
  /Users/.../.claude/worktrees/viewer-layout/biome.json
i The other configuration was found in /Users/.../changeledger.
```

Biome sale con error de configuración antes de mirar una sola línea de código.
La sesión del 2026-10-26 corrió el gate por partes durante todo su trabajo por
esta causa, y la nota quedó en tres pull requests.

### Investigation

El fallo no es de selección de ficheros. `biome.json` ya restringe
`files.includes` a `bin/**`, `src/**` y `test/**`, de modo que nada bajo
`.claude/` se habría linteado nunca. Lo que falla es el **descubrimiento de
configuración**: el escáner de Biome encuentra un `biome.json` anidado y se
niega a continuar.

Ese `biome.json` anidado es el del propio repo. El worktree es un checkout de
este mismo repositorio, así que lleva su copia del fichero versionado. Por eso
no basta con marcarlo `root: false`: sería marcar así el único `biome.json` que
hay, el que también actúa de raíz en el checkout principal.

No es un residuo que se limpie una vez. La app crea un worktree por sesión bajo
esa ruta, de modo que el lint vuelve a romperse en cuanto se abre la siguiente.
Borrar worktrees trata el síntoma.

El daño está acotado a `pnpm lint` y `pnpm verify`. El `hooks/pre-commit`
versionado usa `lint-staged`, que invoca Biome sobre rutas concretas, y siguió
funcionando durante toda la sesión: los commits pasaron su gate sin incidencia.

Biome 2.5.0, la versión fijada en `biome.json`, expone tanto
`files.experimentalScannerIgnores` como una clave `root` de primer nivel. Cuál
de las dos resuelve esto, y con qué efectos sobre el resto del gate, es trabajo
de implementación con el código delante.

### Objective

Que `pnpm verify` complete en un checkout que tenga worktrees de la app bajo
`.claude/`, sin depender de que estén borrados.

Terminado significa que, con al menos un worktree presente en esa ruta,
`pnpm lint` y `pnpm verify` se ejecutan sobre las mismas rutas que hoy declara
`files.includes` y terminan con su resultado real, no con un error de
configuración.

### Frontier

Entra la configuración del gate de calidad: `biome.json`, `.gitignore` y, si el
arreglo lo exige, los scripts `lint` y `verify` de `package.json`. `.gitignore`
lo autorizó el humano al elegir el arreglo, una vez las pruebas registradas en
el Log mostraron que el camino que cabía en la frontera original duplicaba la
lista de rutas.

Queda pre-autorizado dentro de esa frontera cubrir el caso con un test, si la
superficie elegida admite uno que no dependa de crear un worktree real.

Queda fuera:

- Borrar, mover o gestionar los worktrees que crea la app.
- `hooks/pre-commit` y la configuración de `lint-staged`, que no están rotos.
- Cambiar qué rutas se lintean: `files.includes` se conserva como está.

## Specification

### CR1 — El lint no aborta con un worktree de la app presente
- **Given** un checkout con al menos un directorio bajo `.claude/worktrees/` que contiene su propio `biome.json`
- **When** se ejecuta `pnpm lint`
- **Then** termina con el resultado del análisis de `bin/**`, `src/**` y `test/**`, sin el error `Found a nested root configuration`

### CR2 — Las dos mitades del arreglo se conservan juntas
- **Given** `biome.json` y `.gitignore` del repositorio
- **When** se leen
- **Then** `biome.json` declara `vcs.enabled: true`, `vcs.clientKind: "git"` y `vcs.useIgnoreFile: true`
- **And** `.gitignore` ignora `.claude/worktrees/`

### CR3 — Las rutas analizadas no cambian
- **Given** `biome.json`
- **When** se lee
- **Then** `files.includes` sigue siendo `["bin/**", "src/**", "test/**", "!src/viewer/public/vendor"]`

## Plan

- [x] Ignorar `.claude/worktrees/` en git
  - **Target:** `.gitignore`
  - **Verify:** `node --test test/quality-gate.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-26T14:51:44Z`
- [x] Declarar la costura de VCS en Biome para que el escáner respete ese ignore
  - **Target:** `biome.json`
  - **Verify:** `node --test test/quality-gate.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T14:51:45Z`
- [x] Escribir los criterios como tests
  - **Target:** `test/quality-gate.test.mjs`
  - **Verify:** `node --test test/quality-gate.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T14:51:46Z`
- [x] Comprobar a mano que `pnpm lint` pasa con el worktree presente, y dejar la
  evidencia en el Log
  - **Support:** verify: `pnpm lint` con `.claude/worktrees/viewer-layout` presente
  - **Resolved:** `2026-10-26T14:51:46Z`
- [x] Ejecutar el gate local completo
  - **Support:** `pnpm verify`
  - **Resolved:** `2026-10-26T14:51:47Z`

## Log
- **2026-10-26T14:38:04Z** `[version]` 1.0.1-dev
- **2026-10-26T14:39:17Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T14:39:21Z** `[status]` approved → in-progress
- **2026-10-26T14:39:21Z** `[branch]` set: change/20261026-143804 (auto)
- **2026-10-26T14:40:36Z** `[note]` Descartado `files.experimentalScannerIgnores: ['.claude/**']`: el abort por configuración anidada se produce igual, así que el descubrimiento de config no pasa por esa clave.
- **2026-10-26T14:40:37Z** `[note]` Probado `biome check bin src test` con rutas explícitas: 138 ficheros, exit 0, sin abort. Queda dentro de la frontera, pero duplica en `package.json` la lista de rutas que ya declara `files.includes`.
- **2026-10-26T14:40:37Z** `[note]` Probado `vcs.useIgnoreFile` con `.claude/worktrees/` en `.gitignore`: el abort desaparece, una sola declaración y además quita el ruido de `git status`. Exige tocar `.gitignore`, que la frontera aprobada no incluye.
- **2026-10-26T14:48:04Z** `[note]` El humano amplía la frontera a `.gitignore` y elige el arreglo con `vcs.useIgnoreFile` sobre el de rutas explícitas.
- **2026-10-26T14:51:48Z** `[note]` CR1 verificado a mano con `.claude/worktrees/viewer-layout` presente: `pnpm lint` pasa de abortar por `Found a nested root configuration` a `Checked 140 files` sin errores. `pnpm verify` completa entero por primera vez en la sesión: lint limpio, 2256 tests, `check` válido.
- **2026-10-26T14:52:18Z** `[status]` in-progress → in-review
- **2026-10-26T14:54:19Z** `[finding]` El patrón `.tmp` de `.gitignore` no está anclado, así que con `vcs.useIgnoreFile` un fichero o directorio `.tmp` bajo `bin`, `src` o `test` quedaría fuera del lint en silencio. Hoy no existe ninguno. Detectado en la revisión de este cambio; anclarlo queda fuera de su frontera.
- **2026-10-26T14:54:20Z** `[note]` Corregidos tras el informe dos guardas frágiles: el de `vcs` pasa de `deepEqual` sobre el objeto entero a comprobar sus tres claves, y el de `.gitignore` pasa de buscar una cadena literal a preguntarle a `git check-ignore` si la ruta está ignorada.
- **2026-10-26T14:54:26Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-26T14:54:36Z** `[graduation]` spec: `lifecycle.md`
