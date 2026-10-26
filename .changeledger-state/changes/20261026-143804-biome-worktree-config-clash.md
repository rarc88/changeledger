---
id: "20261026-143804"
title: Un worktree de la app aborta el lint del repo padre
type: change
status: in-progress
created: 2026-10-26T14:38:04Z
depends_on: []
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

Entra la configuración del gate de calidad: `biome.json` y, si el arreglo lo
exige, los scripts `lint` y `verify` de `package.json`.

Queda pre-autorizado dentro de esa frontera cubrir el caso con un test, si la
superficie elegida admite uno que no dependa de crear un worktree real.

Queda fuera:

- Borrar, mover o gestionar los worktrees que crea la app.
- `hooks/pre-commit` y la configuración de `lint-staged`, que no están rotos.
- Cambiar qué rutas se lintean: `files.includes` se conserva como está.

## Log
- **2026-10-26T14:38:04Z** `[version]` 1.0.1-dev
- **2026-10-26T14:39:17Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T14:39:21Z** `[status]` approved → in-progress
- **2026-10-26T14:39:21Z** `[branch]` set: change/20261026-143804 (auto)
