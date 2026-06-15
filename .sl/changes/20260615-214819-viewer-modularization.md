---
id: "20260615-214819"
title: Modularizar el visor para reducir acoplamiento
type: refactor
status: done
created: 2026-06-15T21:48:19Z
depends_on: ["20260615-214817"]
reviewed: true
owner: Roberto Ruiz
---

## Request

Reducir el acoplamiento del visor sin cambiar comportamiento visible. El
archivo `src/viewer/public/app.js` concentra render, estado, filtros, llamadas
API, graph, specs, métricas y sanitización. Ya funciona, pero dificulta cambios
seguros en una superficie que manipula contenido no confiable.

## Proposal

Dividir el visor en módulos pequeños, manteniendo la app como JavaScript estático
servido por `sl view` y sin introducir framework.

Propuesta de corte:

- `viewer/public/security.js`: `safeHtml`, `esc`, `cssIdent`, inicialización
  defensiva de Mermaid.
- `viewer/public/state.js`: estado de filtros, proyecto actual, vista actual,
  predicados `isVisible()` y `passesTombstones()`.
- `viewer/public/api.js`: `fetch` de proyectos, repo, git refs, búsqueda y
  cambio de estado.
- `viewer/public/views/*.js`: board, table, graph, specs, metrics y detail.
- `viewer/public/app.js`: bootstrap y wiring de eventos.

Alternativas descartadas:

- Adoptar un framework frontend: demasiado peso para un viewer local pequeño.
- Reescritura visual: aumenta riesgo y no responde a esta deuda.
- Refactor completo del server: `src/commands/view.mjs` también crecerá, pero el
  dolor actual está en el cliente.

## Plan

- [x] Crear módulos `security`, `state` y `api` en `src/viewer/public/`, moviendo funciones puras con tests existentes como red de seguridad — 2026-06-15T21:59:51Z
- [x] Extraer vistas de board/table/detail primero, porque concentran más interpolaciones HTML — 2026-06-15T21:59:51Z
- [x] Extraer graph/specs/metrics manteniendo IDs de DOM y comportamiento actual — 2026-06-15T21:59:51Z
- [x] Dejar `src/viewer/public/app.js` como bootstrap fino y eliminar estado global innecesario — 2026-06-15T21:59:57Z
- [x] Ejecutar tests de viewer (`test/viewer-*.test.mjs`, `test/view.test.mjs`) y `pnpm check` — 2026-06-15T21:59:57Z

## Log
- **2026-06-15T21:52:26Z** — status: draft → approved
- **2026-06-15T21:55:33Z** — status: approved → in-progress
- **2026-06-15T21:55:33Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:00:10Z** — status: in-progress → in-review
- **2026-06-15T22:07:19Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:08:03Z** — graduado a spec `architecture.md`
