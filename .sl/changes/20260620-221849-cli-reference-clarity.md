---
id: "20260620-221849"
title: Claridad autocontenida de la referencia CLI
type: chore
status: done
created: 2026-06-20T22:18:49Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Eliminar dos fricciones menores de la referencia rápida en §9 de
`templates/AGENTS.md`:

- Reemplazar el pronombre ambiguo “you” en `sl graduate --into` por el actor
  explícito: el agente edita manualmente el body del spec.
- Hacer autocontenida la entrada de `sl status`, indicando que no acepta los
  destinos human-owned `done` ni el terminal razonado `discarded`, y enlazando
  las acciones dedicadas correspondientes sin duplicar la explicación de §5.

## Plan

- [x] Aclarar las entradas `sl status` y `sl graduate --into` en `templates/AGENTS.md`; verificar con `node --test test/cli.test.mjs` (support) — 2026-06-20T22:22:37Z
- [x] Ejecutar `pnpm verify` y confirmar que la referencia editada no introduce regresiones (support) — 2026-06-20T22:22:56Z

## Log

- **2026-06-20T22:21:04Z** — status: draft → approved
- **2026-06-20T22:22:03Z** — status: approved → in-progress
- **2026-06-20T22:22:03Z** — owner → Roberto Ruiz (auto)
- **2026-06-20T22:22:56Z** — Implementación completada; pnpm verify pasó con 335 tests y 113 changes válidos.
- **2026-06-20T22:22:57Z** — status: in-progress → in-validation
- **2026-06-20T22:24:43Z** — validation → done (human accepted)
- **2026-06-20T22:25:13Z** — graduation skipped: Ajuste editorial de la referencia CLI; no introduce verdad arquitectónica persistente adicional.
- **2026-06-20T22:25:13Z** — archived
