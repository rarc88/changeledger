---
id: "20260616-151234"
title: Endurecer la resolución de assets estáticos del viewer
type: bug
status: done
created: 2026-06-16T15:12:34Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Endurecer la resolución de assets estáticos del viewer. El servidor ya tiene
buenas defensas de loopback, token y headers, pero la rama de ficheros estáticos
usa `path.normalize()` más `startsWith(publicDir)`. Es una zona sensible porque
el viewer se abre sobre repos no confiables y conviene que el static serving sea
defensivo por construcción.

## Investigation

- `createRequestListener()` separa ruta/query con `req.url.split('?')` y luego
  construye el fichero con `path.join(publicDir, path.normalize(route)...)`.
- La comprobación `file.startsWith(publicDir)` funciona para los casos cubiertos,
  pero las comprobaciones por prefijo son fáciles de romper si se introduce un
  directorio hermano con prefijo común o si cambia la normalización.
- La solución debe usar primitivas de path containment más explícitas:
  `new URL()`, `decodeURIComponent` controlado por WHATWG URL, `path.resolve`,
  `path.relative` y, si el fichero existe, `realpath`.
- No debe afectar rutas `/api/*`, `/vendor/*`, `/` ni `/index.html`.

## Specification

### CR1 — Traversal codificado no lee fuera de public
- **Given** el viewer recibe `GET /..%2Fsecret.txt`
- **When** existe un fichero `secret.txt` fuera de `src/viewer/public`
- **Then** responde `404`
- **And** no devuelve el contenido de `secret.txt`

### CR2 — Directorio hermano con prefijo común no se sirve
- **Given** existe un directorio hermano cuyo path empieza por el mismo prefijo que `publicDir`
- **When** se solicita una ruta que normalizaría hacia ese hermano
- **Then** responde `404`
- **And** no usa una comprobación `startsWith(publicDir)` como autoridad final

### CR3 — Assets válidos siguen sirviéndose
- **Given** el viewer recibe `GET /app.js`
- **When** `src/viewer/public/app.js` existe
- **Then** responde `200`
- **And** el `Content-Type` es `text/javascript; charset=utf-8`

### CR4 — APIs y vendor no cambian
- **Given** una request válida a `/api/projects` o `/vendor/marked.min.js`
- **When** se procesa por el servidor
- **Then** conserva el comportamiento anterior cubierto por los tests existentes

## Plan

- [x] Añadir tests de traversal codificado en `test/view.test.mjs` y helper de resolución estática en `src/commands/view.mjs` (CR1) — 2026-06-16T15:31:36Z
- [x] Añadir test de directorio hermano con prefijo común en `test/view.test.mjs` y reemplazar la comprobación de prefijo en `src/commands/view.mjs` (CR2) — 2026-06-16T15:31:37Z
- [x] Añadir/ajustar test de asset válido en `test/view.test.mjs` manteniendo MIME en `src/commands/view.mjs` (CR3) — 2026-06-16T15:31:37Z
- [x] Ejecutar tests existentes de API/vendor en `test/view.test.mjs` contra `src/commands/view.mjs` sin cambios de comportamiento (CR4) — 2026-06-16T15:31:37Z
- [x] Ejecutar `pnpm verify` y registrar el resultado en `## Log` — 2026-06-16T15:31:37Z

## Log
- **2026-06-16T15:15:17Z** — status: draft → approved
- **2026-06-16T15:30:07Z** — status: approved → in-progress
- **2026-06-16T15:30:08Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T15:31:37Z** — Hardened static asset path resolution; node --test test/view.test.mjs and pnpm verify passed outside sandbox.
- **2026-06-16T15:31:37Z** — status: in-progress → in-review
- **2026-06-16T15:34:36Z** — review → done (delegated subagent, clean context)
- **2026-06-16T15:34:36Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
