---
id: "20260617-190008"
title: router catch expone e.message con paths internos al cliente
type: bug
status: done
created: 2026-06-17T19:00:08Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

El handler principal de `router.mjs` tiene un `catch` que retorna `e.message`
directamente al cliente HTTP. En Node.js, los errores del sistema incluyen el
path absoluto del archivo en el mensaje (ej. `ENOENT: no such file or directory,
open '/Users/alice/.sl/changes/...'`). Esto expone información de la estructura
interna del sistema de archivos.

Adicionalmente, `params.get('id')` del query string fluye sin validación a
`gitRefs(proj.path, id)`, donde se usa en un argumento `--grep=[#${id}]` de git.
No hay shell injection (se usa `execFileSync`), pero un `id` que contenga `]`
puede corromper el patrón de grep.

## Investigation

`src/viewer/server/router.mjs:164-165`:

```js
} catch (e) {
  send(res, 500, MIME['.json'], JSON.stringify({ error: e.message }));
}
```

`src/viewer/server/router.mjs:124`:

```js
send(res, 200, MIME['.json'], JSON.stringify(gitRefs(proj.path, params.get('id'))));
```

`src/git.mjs:47-48`:

```js
const out = run(
  ['log', '--all', '-n', '100', '-F', `--grep=[#${id}]`, `--pretty=format:%H${SEP}%s${SEP}%cI`],
  repoRoot,
);
```

Fix para info leak: retornar mensaje genérico al cliente, loguear `e.message` a `stderr`.

Fix para id en grep: validar que `id` sea alfanumérico + guiones antes de usar.
El formato de id de Spec Ledger es `YYYYMMDD-HHMMSS` — solo dígitos y un guión.

## Specification

### CR1 — catch de router retorna mensaje genérico
- **Given** un error interno lanzado dentro del handler (ej. ENOENT al leer archivo)
- **When** el catch lo captura
- **Then** la respuesta HTTP contiene `{ "error": "Internal server error" }` (u otro mensaje fijo)
- **And** `e.message` es emitido a `process.stderr` (o un logger inyectable), no al cliente

### CR2 — id validado antes de git grep
- **Given** una petición GET `/api/git?project=X&id=VALOR`
- **When** `VALOR` no es un id válido de Spec Ledger (`[0-9]{8}-[0-9]{6}`)
- **Then** el handler retorna 400 `{ "error": "invalid id" }` sin llamar `gitRefs`
- **And** `VALOR` vacío o ausente retorna `{ commits: [], branches: [] }` (comportamiento existente)

### CR3 — Tests cubren ambos casos
- **Given** el fix aplicado
- **When** se envía una petición `/api/git` con id inválido (ej. `foo]bar`)
- **Then** la respuesta es 400
- **And** un error simulado en el handler retorna 500 con mensaje genérico (no el error original)

## Plan

- [x] Cambiar `catch` final en `src/viewer/server/router.mjs` para retornar `{ error: 'Internal server error' }` y emitir `e.message` a `process.stderr`, verificar con `test/view.test.mjs` (CR1) — 2026-06-17T20:21:56Z
- [x] Agregar validación de `params.get('id')` con regex `/^[0-9]{8}-[0-9]{6}$/` en `src/viewer/server/router.mjs` handler `/api/git`, verificar con `test/view.test.mjs` (CR2) — 2026-06-17T20:21:56Z
- [x] Agregar tests en `test/view.test.mjs`: id inválido → 400; error simulado → 500 genérico en `src/viewer/server/router.mjs` (CR3) — 2026-06-17T20:21:56Z
- [x] Correr `pnpm test -- test/view.test.mjs` sobre `src/viewer/server/router.mjs` sin regresiones (CR1, CR2, CR3) — 2026-06-17T20:21:56Z

## Log

- **2026-06-17T19:00:08Z** — Detectado en auditoría. Bajo urgencia dado binding localhost, pero debe corregirse antes de cualquier exposición multi-usuario o en red.
- **2026-06-17T20:04:28Z** — status: draft → approved
- **2026-06-17T20:21:10Z** — status: approved → in-progress
- **2026-06-17T20:21:10Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T20:21:56Z** — status: in-progress → in-review
- **2026-06-17T20:22:13Z** — review → done (delegated subagent, clean context)
- **2026-06-17T20:22:14Z** — graduado a spec `architecture.md`
- **2026-06-18T10:09:09Z** — archived
