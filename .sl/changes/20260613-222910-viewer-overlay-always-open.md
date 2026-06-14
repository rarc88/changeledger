---
id: "20260613-222910"
title: El panel lateral del visor siempre abierto y vacío
type: bug
status: done
created: 2026-06-13T22:29:10Z
depends_on: ["20260613-150430"]
reviewed: true
---

## Request

El panel de detalle (`#overlay`) aparece abierto y vacío al cargar el visor y no
se puede cerrar (sin contenido no hay botón de cierre).

## Investigation

- `.hidden` estaba como `display: none;` **sin `!important`**.
- La regla `.overlay { display: flex }` se define **después** de `.hidden` →
  con igual especificidad, gana la última por orden, así que el overlay con
  clase `hidden` se mostraba igual.

## Specification

### CR1 — Overlay oculto por defecto
- **Given** el visor recién cargado
- **When** no hay ningún change abierto
- **Then** el panel lateral está oculto
- **And** abrir una card lo muestra y el botón cerrar lo oculta

## Plan

- [x] `.hidden { display: none !important }` en styles.css (CR1) — 2026-06-13T22:30:00Z

## Log

- **2026-06-13T22:29:10Z** — Reportado por el humano: panel lateral siempre
  abierto y vacío.
- **2026-06-13T22:30:00Z** — Causa: `.hidden` sin `!important`, sobrescrito por
  `.overlay`. Fix aplicado y verificado en navegador (oculto al cargar; open/close
  OK). `draft → done`.
