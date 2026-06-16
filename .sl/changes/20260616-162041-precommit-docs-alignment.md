---
id: "20260616-162041"
title: Alinear documentacion con el hook pre-commit
type: chore
status: done
created: 2026-06-16T16:20:41Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Alinear la documentacion del proyecto con el comportamiento real del hook
versionado `hooks/pre-commit`.

## Plan

- [x] Actualizar `AGENTS.md` para decir que el gate completo es `pnpm verify`, mientras que `hooks/pre-commit` ejecuta `lint-staged`, `pnpm test` y `sl check` — 2026-06-16T16:35:22Z
- [x] Actualizar `README.md` para describir el mismo comportamiento sin prometer que el hook ejecuta `pnpm verify` — 2026-06-16T16:35:27Z
- [x] Revisar `CONTRIBUTING.md` por si repite la afirmacion anterior y corregirla si aparece — 2026-06-16T16:35:36Z
- [x] Ejecutar `pnpm lint` y `node bin/sl.mjs check` — 2026-06-16T16:35:40Z

## Log

- **2026-06-16T16:26:00Z** — status: draft → approved
- **2026-06-16T16:34:58Z** — status: approved → in-progress
- **2026-06-16T16:34:58Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:35:44Z** — status: in-progress → done
- **2026-06-16T16:35:49Z** — graduation skipped: docs-only alignment; no persistent spec change
