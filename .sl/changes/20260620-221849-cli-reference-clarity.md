---
id: "20260620-221849"
title: Claridad autocontenida de la referencia CLI
type: chore
status: approved
created: 2026-06-20T22:18:49Z
depends_on: []
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

- [ ] Aclarar las entradas `sl status` y `sl graduate --into` en `templates/AGENTS.md`; verificar con `node --test test/cli.test.mjs` (support)
- [ ] Ejecutar `pnpm verify` y confirmar que la referencia editada no introduce regresiones (support)

## Log

- **2026-06-20T22:21:04Z** — status: draft → approved
