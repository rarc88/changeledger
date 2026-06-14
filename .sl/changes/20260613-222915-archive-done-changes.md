---
id: "20260613-222915"
title: Archivar changes done para no saturar el board
type: feature
status: done
created: 2026-06-13T22:29:15Z
depends_on: []
reviewed: true
---

## Request

Los changes `done` saturan el board con el tiempo. Archivarlos (mover a `.sl/archive/` o flag) para que el visor los oculte por defecto, con opción de mostrarlos.

## Investigation

- `loadRepo` solo lee `changes_dir`. Mover los archivados a `.sl/archive/` los
  sacaría de la carga: `check` dejaría de verlos y cualquier `depends_on` que los
  referencie pasaría a ser "missing change" (rotura de validación cruzada).
- Un flag en frontmatter mantiene el change en `changes_dir`: `check` sigue
  validándolo y resolviendo deps; solo el visor decide ocultarlo.

## Proposal

Flag `archived: true` opcional en frontmatter (ausente = activo).

- **CLI**: `sl archive <id>` / `sl unarchive <id>` (set/quita el flag + log).
- **Writer**: `setArchived(text, bool)` añade/quita la línea `archived: true`.
- **Visor**: oculta archivados por defecto; un toggle "Archived" los muestra
  (con estilo atenuado). El contador de columna refleja lo visible.
- **check**: si `archived` existe, debe ser booleano.

Descartado: mover a `.sl/archive/` — rompe la validación de `depends_on` hacia
changes archivados y complica la carga. El flag cumple el objetivo (board limpio)
sin esos efectos.

## Specification

### CR1 — Archivar y desarchivar
- **Given** un change done
- **When** ejecuto `sl archive <id>`
- **Then** su frontmatter contiene `archived: true`
- **And** `sl unarchive <id>` elimina el flag

### CR2 — El visor oculta archivados por defecto
- **Given** changes archivados y activos
- **When** abro el visor
- **Then** los archivados no aparecen
- **And** al activar el toggle "Archived" sí aparecen, atenuados

### CR3 — check valida el tipo del flag
- **Given** un change con `archived: 1`
- **When** ejecuto `sl check`
- **Then** se reporta que `archived` debe ser booleano

## Plan

- [x] `setArchived(text, bool)` en writer.mjs (CR1) — 2026-06-14T11:48:06Z
- [x] `archive(id, on)` en agent.mjs + comandos `sl archive`/`sl unarchive` (CR1) — 2026-06-14T11:48:07Z
- [x] `serialize()` expone `archived`; app.js: toggle + ocultar/atenuar (CR2) — 2026-06-14T11:48:07Z
- [x] `check.mjs`: `archived` debe ser booleano (CR3) — 2026-06-14T11:48:07Z
- [x] Tests: setArchived, archive/unarchive, check del flag (CR1, CR3) — 2026-06-14T11:48:07Z

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
- **2026-06-14T11:48:07Z** — status: in-progress → done
