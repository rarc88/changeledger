---
id: "20260613-222911"
title: Servir marked y mermaid desde pnpm en vez de vendor
type: refactor
status: done
created: 2026-06-13T22:29:11Z
depends_on: []
archived: true
reviewed: true
---

## Request

marked (36K) y mermaid (3.2M) están vendorizados en git → inflan el repo. Mejor declararlas como `dependencies` y que pnpm/npm las instale; el server las sirve desde `node_modules`. Alinea con publicar en npm.

## Proposal

`marked` y `mermaid` como `dependencies`. El server resuelve sus builds de
navegador desde `node_modules` (`marked/lib/marked.umd.js`,
`mermaid/dist/mermaid.min.js`) y los sirve bajo `/vendor/*`. Se eliminan los
`.min.js` vendorizados del repo. `index.html` no cambia (mismas rutas).

## Plan

- [x] `pnpm add marked mermaid` (dependencies) — 2026-06-13T22:32:00Z
- [x] view.mjs: resolver y servir builds desde node_modules bajo `/vendor/*` — 2026-06-13T22:32:30Z
- [x] Eliminar `src/viewer/public/vendor/*.js` del repo — 2026-06-13T22:32:40Z
- [x] Verificar en navegador (marked/mermaid cargan, diagrama renderiza) — 2026-06-13T22:33:00Z
- [x] Actualizar spec de arquitectura — 2026-06-13T22:33:11Z

## Log
- **2026-06-13T22:31:11Z** — status: draft → in-progress
- **2026-06-13T22:33:11Z** — Implementado. marked@18/mermaid@11 como deps; servidos
  desde node_modules (200, mermaid 3.3M fuera de git); diagrama renderiza.
  `in-progress → done`.
- **2026-06-15T21:17:54Z** — archived
