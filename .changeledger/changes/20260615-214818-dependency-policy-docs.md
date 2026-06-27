---
id: "20260615-214818"
title: Aclarar la política de dependencias runtime
type: chore
status: done
created: 2026-06-15T21:48:18Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Aclarar la política real de dependencias runtime: no están prohibidas, pero deben
evitarse cuando no aportan valor claro; si son necesarias, deben ser maduras,
mantenidas y proporcionales al riesgo que reducen.

## Plan

- [x] Actualizar `README.md` para reemplazar cualquier lectura de "runtime cero deps" por "núcleo CLI ligero; dependencias runtime solo cuando estén justificadas" — 2026-06-15T21:55:33Z
- [x] Actualizar `.sl/specs/architecture.md` con la política: preferir estándar Node y código propio pequeño, aceptar dependencias maduras para dominios complejos o seguridad como sanitización/render Markdown/diagramas — 2026-06-15T21:55:33Z
- [x] Corregir el warning actual de `sl check` refrescando `updated` en `.sl/specs/architecture.md` — 2026-06-15T21:55:33Z
- [x] Revisar `package.json` para confirmar que `dompurify`, `marked` y `mermaid` están descritas como dependencias deliberadas del viewer, no como accidente — 2026-06-15T21:59:43Z
- [x] Ejecutar `pnpm check` — 2026-06-15T21:59:51Z

## Log

- **2026-06-15T21:52:25Z** — status: draft → approved
- **2026-06-15T21:53:14Z** — status: approved → in-progress
- **2026-06-15T21:53:14Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:00:05Z** — status: in-progress → done
- **2026-06-15T22:08:03Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:24Z** — archived
