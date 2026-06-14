---
id: "20260614-151800"
title: Documentar pnpm link --global para uso local
type: chore
status: done
created: 2026-06-14T15:18:00Z
depends_on: []
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Aún no publicamos `spec-ledger` como paquete npm (eso es #222920). Mientras
tanto, `pnpm link --global` da una experiencia equivalente: expone el bin `sl`
global apuntando a este checkout, con ediciones vivas. Falta documentarlo para
que cualquiera pueda usar `sl` fuera de este repo hoy.

## Plan

- [x] README §Development: bloque de `pnpm link --global` / `sl --help` / `pnpm unlink --global` con una línea de contexto (interino hasta el publish npm #222920) — 2026-06-14T15:33:58Z

## Log

- **2026-06-14T15:27:16Z** — status: draft → approved
- **2026-06-14T15:33:43Z** — status: approved → in-progress
- **2026-06-14T15:33:43Z** — owner → Roberto Ruiz (auto)
- **2026-06-14T15:33:58Z** — status: in-progress → done
