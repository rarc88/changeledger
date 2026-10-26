---
id: "20261026-154858"
title: Un patrón de ignore sin anclar puede sacar código del lint
type: change
status: discarded
created: 2026-10-26T15:48:58Z
depends_on: []
related_to: ["20261026-143804"]
owner: raruiz-hiberuscom
---

## Request

`20261026-143804` hizo que Biome respete `.gitignore` (`vcs.useIgnoreFile`) para
que los worktrees de la app dejaran de abortar el lint. Desde entonces, lo que
git ignora deja de analizarse.

`.gitignore` declara `.tmp` sin anclar, bajo el comentario «Temporary files».
Un patrón sin barra inicial casa a cualquier profundidad, así que un fichero o
directorio `.tmp` dentro de `bin`, `src` o `test` quedaría fuera del lint **en
silencio**: sin aviso, sin error, y sin que `files.includes` intervenga. Hoy no
existe ninguno, así que no hay daño actual.

Se registró como hallazgo `F1` de `20261026-143804`, fuera de su frontera, y el
humano lo promueve.

### Investigation

Los demás patrones del fichero no comparten el problema, y conviene no tocarlos:
`node_modules/`, `.vscode/`, `.idea/` y `*.swp` casan a cualquier profundidad a
propósito, porque esos artefactos aparecen en cualquier nivel. `.claude/worktrees/`
ya lleva su propia ruta. El único ambiguo es `.tmp`, cuyo comentario sugiere un
directorio de trabajo en la raíz, no un nombre reservado en todo el árbol.

Queda por confirmar con el humano qué era `.tmp` originalmente, porque de eso
depende el arreglo: anclarlo a la raíz (`/.tmp`) si siempre fue un directorio de
trabajo, o conservarlo y excluir explícitamente las rutas analizadas si alguna
herramienta escribe `.tmp` en cualquier sitio.

### Objective

Que ninguna ruta bajo las rutas analizadas por el lint pueda quedar fuera de él
por culpa de un patrón de ignore sin anclar.

Terminado significa que un fichero y un directorio `.tmp` colocados bajo `bin`,
`src` o `test` son analizados por `pnpm lint`, y que lo que `.tmp` protegía
originalmente sigue ignorado.

### Frontier

Entra `.gitignore` y la guarda de `test/quality-gate.test.mjs`, que ya cubre la
costura entre el ignore de git y el lint.

Queda fuera:

- `biome.json` y `vcs.useIgnoreFile`, que se conservan tal como quedaron.
- Los demás patrones de `.gitignore`, salvo que la investigación demuestre que
  alguno tiene el mismo defecto, en cuyo caso vuelve al humano antes de tocarlo.
- `files.includes`, que no interviene en este fallo.

## Log
- **2026-10-26T15:48:58Z** `[version]` 1.0.1-dev
- **2026-10-26T15:56:25Z** `[status]` draft → discarded: El patrón .tmp casa solo un componente llamado exactamente así, no la extensión, y lo que hay dentro es scratch sin versionar: que el lint no lo mire es el comportamiento correcto. Anclarlo a /.tmp haría lo contrario de lo deseado, versionando y linterando un src/.tmp. La verdad ya está en specs/lifecycle.md.
