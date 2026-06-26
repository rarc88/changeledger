---
id: "20260617-190005"
title: loadRepoAsync bloquea event loop con fs.existsSync síncrono
type: bug
status: done
created: 2026-06-17T19:00:05Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

`loadRepoAsync` fue introducida para no bloquear el event loop durante peticiones
HTTP al viewer. Pero contiene dos `fs.existsSync()` sincrónicas que sí bloquean,
derrotando el objetivo del change `f632813` (async-view-io).

## Investigation

`src/repo.mjs:86` y `repo.mjs:99`:

```js
export async function loadRepoAsync(start = process.cwd()) {
  // ...
  if (fs.existsSync(changesDir)) {     // BLOQUEA — línea 86
    const names = (await fs.promises.readdir(changesDir)).sort();
    // ...
  }
  if (fs.existsSync(specsDir)) {       // BLOQUEA — línea 99
    const names = (await fs.promises.readdir(specsDir)).sort();
    // ...
  }
}
```

Las llamadas `readdir` y `readFile` subsiguientes son correctamente async. Solo
los dos `existsSync` son sincrónicas. Fix idiomático:

```js
try {
  const names = (await fs.promises.readdir(dir)).sort();
  // ...
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
```

`loadRepo` (síncrona, usada por CLI) queda sin cambios.

## Specification

### CR1 — loadRepoAsync no usa ninguna API síncrona de fs
- **Given** el código de `loadRepoAsync` en `src/repo.mjs`
- **When** se inspecciona
- **Then** no contiene `fs.existsSync`, `fs.readdirSync`, `fs.readFileSync` ni ninguna otra API síncrona de `node:fs`

### CR2 — Directorio inexistente retorna array vacío, no lanza
- **Given** un repo donde `changesDir` o `specsDir` no existen
- **When** se llama `loadRepoAsync`
- **Then** retorna `{ changes: [], specs: [] }` sin lanzar
- **And** el mismo comportamiento se verifica en `loadRepo` (regresión)

### CR3 — Sin regresión en tests de viewer existentes
- **Given** el fix aplicado
- **When** se corre `pnpm test -- test/view.test.mjs`
- **Then** todos los tests pasan

## Plan

- [x] Reemplazar los dos `fs.existsSync` en `src/repo.mjs` (`loadRepoAsync`) con `try/catch ENOENT` sobre `fs.promises.readdir`, verificar con `test/view.test.mjs` (CR1) — 2026-06-17T20:07:41Z
- [x] Agregar test en `test/view.test.mjs` que llama `loadRepoAsync` sobre repo con `changesDir` inexistente en `src/repo.mjs`, verifica retorno `{ changes: [], specs: [] }` (CR2) — 2026-06-17T20:07:41Z
- [x] Correr `pnpm test -- test/view.test.mjs` para confirmar `src/repo.mjs` sin regresiones (CR3) — 2026-06-17T20:07:41Z

## Log

- **2026-06-17T19:00:05Z** — Detectado en auditoría. `f632813` introdujo `loadRepoAsync` sin migrar los dos `existsSync`.
- **2026-06-17T20:04:25Z** — status: draft → approved
- **2026-06-17T20:06:54Z** — status: approved → in-progress
- **2026-06-17T20:06:54Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T20:07:44Z** — status: in-progress → in-review
- **2026-06-17T20:08:37Z** — review → done (delegated subagent, clean context)
- **2026-06-17T20:08:41Z** — graduado a spec `architecture.md`
- **2026-06-18T10:09:09Z** — archived
