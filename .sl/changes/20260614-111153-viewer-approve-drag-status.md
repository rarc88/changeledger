---
id: "20260614-111153"
title: Aprobar/mover estado desde el visor (drag-drop draft→approved)
type: feature
status: approved
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

## Proposal

## Specification

## Plan

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
