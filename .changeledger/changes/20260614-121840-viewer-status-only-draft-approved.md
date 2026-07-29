---
id: "20260614-121840"
title: El humano solo puede mover draft a approved en el visor
type: bug
status: done
created: 2026-06-14T12:18:40Z
depends_on: []
archived: true
reviewed: true
---

## Request

El drag-drop del visor (change 111153) permite hoy mover entre cualquier par de
columnas. Es peligroso: el único salto de estado que le corresponde al humano es
`draft → approved` (la aprobación). El resto del ciclo (`approved → in-progress
→ done`, `blocked`) lo conduce el agente. El visor debe permitir solo ese salto.

## Investigation

- `POST /api/status` (`changeStatus` en view.mjs) hoy delega en el comando
  `status`, que acepta cualquier estado válido — correcto para el CLI del agente,
  pero el visor no debe heredar esa libertad.
- La autoridad es el server: la restricción tiene que vivir en `changeStatus`,
  no solo en la UI (que es eludible).
- `changeStatus` tiene el path del proyecto; puede leer el estado actual del
  change (`loadRepo`) para validar el salto antes de escribir.

## Specification

### CR1 — Solo draft→approved en el endpoint
- **Given** un change en `draft`
- **When** `POST /api/status` pide `approved`
- **Then** se aplica
- **And** cualquier otro salto (p.ej. `approved→done`, `in-progress→done`) se
  rechaza con error y sin escribir

### CR2 — La UI solo ofrece ese gesto
- **Given** el board
- **When** se rinde
- **Then** solo las cards en `draft` son arrastrables
- **And** soltar solo surte efecto sobre la columna `approved`

## Plan

- [x] `changeStatus`: leer estado actual y permitir solo `draft → approved`
  - **Criteria:** CR1
  - **Resolved:** `2026-06-14T12:20:32Z`
- [x] Board: draggable solo en `draft`; drop efectivo solo en `approved`
  - **Criteria:** CR2
  - **Resolved:** `2026-06-14T12:20:32Z`
- [x] Tests: draft→approved ok; otros saltos rechazados sin escribir
  - **Criteria:** CR1
  - **Resolved:** `2026-06-14T12:20:32Z`

## Log
- **2026-06-14T12:20:32Z** `[status]` in-progress → done
- **2026-06-15T21:17:56Z** `[archive]` archived
