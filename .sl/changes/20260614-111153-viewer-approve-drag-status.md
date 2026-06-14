---
id: "20260614-111153"
title: Aprobar/mover estado desde el visor (drag-drop draft→approved)
type: feature
status: done
created: 2026-06-14T11:11:53Z
depends_on: []
---

## Request

El humano revisa en el visor pero hoy debe ir al terminal (`sl status`) o editar
el archivo para mover estados. Permitir **mover el estado desde el visor**:
arrastrar una card entre columnas del board (p.ej. draft → approved) escribe el
nuevo `status` y registra la transición en el Log.

## Investigation

- El server hoy es de solo lectura. Requiere un endpoint de escritura
  (p.ej. `POST /api/status`) que reuse `setStatus` + `appendLog` (writer.mjs) y
  valide la transición como `sl status`.
- Riesgo: escritura desde el navegador a disco local. Server es localhost; el
  alcance es el repo del proyecto seleccionado.
- UI: drag-drop de cards entre columnas del board; al soltar, llamar al endpoint
  y refrescar.

## Proposal

Endpoint `POST /api/status` (body JSON `{ project, id, status }`) que reusa el
comando `status(id, newStatus, projectPath)` de agent.mjs — ya valida el enum y
escribe `setStatus` + `appendLog`. Solo proyectos vivos; errores → 400/410 con
mensaje.

- **Visor**: las cards del board son `draggable`; las columnas son zonas de
  drop. Al soltar en otra columna, se hace `POST /api/status` con el `status` de
  esa columna y se refresca el board (`lastJson=''` para forzar recarga).
- Localhost + repo del proyecto seleccionado: la escritura es local y acotada.

Descartado: un endpoint de escritura genérico que acepte cualquier mutación de
frontmatter — superficie de riesgo innecesaria; solo se necesita mover `status`.

## Specification

### CR1 — Mover estado vía endpoint
- **Given** un change en `draft`
- **When** llamo `POST /api/status` con `{id, status: "approved"}`
- **Then** el frontmatter pasa a `approved` y el Log registra la transición
- **And** un status inválido devuelve error sin escribir

### CR2 — Drag-drop en el board
- **Given** el board del visor
- **When** arrastro una card a otra columna y la suelto
- **Then** se llama al endpoint con el status de esa columna y el board se refresca

## Plan

- [x] `POST /api/status` en view.mjs: parse body, reusa `status()`, valida proyecto (CR1) — 2026-06-14T12:04:49Z
- [x] Visor: cards draggable + columnas drop + refresco (CR2) — 2026-06-14T12:04:49Z
- [x] Test: `status()` mueve draft→approved y rechaza inválido (ya cubierto en agent.test) + endpoint helper (CR1) — 2026-06-14T12:04:49Z

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
- **2026-06-14T12:04:49Z** — status: in-progress → done
