---
id: "20260614-123212"
title: status falla en tipos sin etapa Log (chore)
type: bug
status: done
created: 2026-06-14T12:32:12Z
depends_on: []
---

## Request

Mover el estado de un change `chore` (p.ej. arrastrar draft→approved en el visor,
o `sl status`) falla con `no ## Log section`. El tipo `chore` tiene etapas
activas `[request, plan]`, sin `## Log`, pero `status()` siempre intenta loguear
la transición.

## Investigation

- Causa raíz: `appendLog` (writer.mjs) lanza `no ## Log section` si no halla el
  heading. `status()` lo llama siempre, así que cualquier change sin `## Log`
  (hoy: `chore`) no puede cambiar de estado — por CLI o por el endpoint del visor.
- El `## Log` es el **ledger de transiciones del ciclo de vida**, ortogonal a las
  etapas de *contenido* del tipo. Que un tipo no lo declare no significa que su
  ciclo no deba registrarse.
- `check` marca `## Log` en un `chore` como "stage not active for type", así que
  crear el Log al vuelo chocaría con la validación si no se exime al Log.

## Specification

### CR1 — status loguea aunque falte la sección
- **Given** un change sin `## Log` (p.ej. un `chore`)
- **When** ejecuto `sl status <id> approved` (o el endpoint del visor)
- **Then** se crea la sección `## Log` con la transición y no falla

### CR2 — check tolera Log en cualquier tipo
- **Given** un `chore` con `## Log` (creado por una transición)
- **When** ejecuto `sl check`
- **Then** no se reporta que `## Log` no esté activo para el tipo
- **And** las demás etapas no activas siguen siendo error

## Plan

- [x] `appendLog`: crear `## Log` al final si no existe (CR1) — 2026-06-14T12:33:37Z
- [x] `check.mjs`: eximir `log` de la regla "stage not active for type" (CR2) — 2026-06-14T12:33:37Z
- [x] Tests: appendLog sin Log previo; check chore+log ok (CR1, CR2) — 2026-06-14T12:33:37Z

## Log
- **2026-06-14T12:33:37Z** — status: in-progress → done
