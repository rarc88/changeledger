---
id: "20260715-093115"
title: Legacy readiness residual
type: bug
status: in-progress
created: 2026-07-15T09:31:15Z
depends_on: []
---

## Request

Representa un documento cuyo Log legacy se puede tipar, pero cuyo Plan aceptado
por una versión previa no satisface la readiness vigente.

## Investigation

El reemplazo debe completar target y verificación sin inventarlos.

## Specification

### CR1 — Conservar la decisión humana
- **Given** un Plan legacy
- **When** se migra
- **Then** no se inventa evidencia

## Plan

- [x] Implementar el criterio (CR1) — 2026-07-15T09:33:15Z

## Log

- **2026-07-15T09:31:15Z** — status: draft → approved
- **2026-07-15T09:32:15Z** — status: approved → in-progress
