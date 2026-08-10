---
id: "20260810-180434"
title: Sacar a la superficie los diagnósticos de activación
type: quick
status: in-progress
created: 2026-08-10T18:04:34Z
depends_on: []
branch: quick/20260810-180434
related_to: ["20260810-120457"]
owner: claude
---

## Request

Dos hallazgos del review de `20260810-120457`, ambos en los diagnósticos de
la activación pre-ancla:

- `registry.listProjects` traga cualquier error del probe antes de resolver
  `activated`, así que una activación legacy (sin `ledger_dir`) se lista
  como repo inactivo con el nombre cacheado stale, mientras el CLI (exit 1)
  y el viewer (400) sí muestran el error accionable de re-activación. El
  listado debe distinguir "no activado" de "activación ilegible" sin perder
  su tolerancia a rutas registradas inutilizables.
- El throw defensivo de activate (`cannot activate <root>: it is not inside
  a Git repository`) es inalcanzable desde sus dos callers y no tiene test:
  retirarlo, o hacerlo alcanzable y pinearlo — nunca dejarlo como código
  muerto defensivo.

Test-only más un ajuste acotado de `registry.mjs`; sin superficie pública
nueva ni verdad persistente.

## Log
- **2026-08-10T21:36:16Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T22:35:36Z** `[status]` approved → in-progress
- **2026-08-10T22:35:36Z** `[branch]` set: quick/20260810-180434 (auto)
- **2026-08-10T22:35:37Z** `[owner]` set: claude
