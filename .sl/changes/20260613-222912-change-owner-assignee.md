---
id: "20260613-222912"
title: Owner/assignee en changes y filtro por responsable
type: feature
status: done
created: 2026-06-13T22:29:12Z
depends_on: []
reviewed: true
---

## Request

Necesitamos saber quién trabaja en qué. Campo opcional `owner` en el frontmatter; el visor filtra y muestra el responsable. `sl status`/`new` podrían setearlo.

## Investigation

- El frontmatter se parsea con `parseYaml` (acepta claves arbitrarias), así que
  `owner` sobrevive sin tocar el parser.
- `sl new` arma el frontmatter a mano en `render()` (`new.mjs`); hay que inyectar
  la línea `owner` solo cuando se pasa.
- `setStatus`/`appendLog`/`setTask` operan por sección/regex y no tocan otras
  líneas: añadir `owner` no las rompe.
- El visor serializa un subconjunto fijo de campos en `serialize()` (`view.mjs`);
  hay que exponer `owner`. Los filtros del topbar son `text`, `type` y `statuses`.
- `owner` es contenido libre (un nombre), opcional. No es enum: sin validación de
  valores. Estructura inglesa, valor variable (AGENTS.md §8).

## Proposal

Campo `owner: <string>` opcional en el frontmatter (ausente = sin responsable).

- **CLI**: `sl new` acepta `--owner <name>`. Nuevo comando `sl owner <id> <name|-->`
  para fijar/limpiar (`-` limpia). Reusa un writer puro `setOwner`.
- **Writer**: `setOwner(text, owner)` añade/actualiza/elimina la línea `owner:`
  en el frontmatter, justo tras `depends_on`.
- **Visor**: `serialize()` expone `owner`. Nuevo filtro desplegable poblado con
  los owners presentes. La card y el detalle muestran el responsable. El owner
  entra en el haystack de búsqueda.

Descartado: enum cerrado de owners en config — over-engineering; el nombre libre
basta y no añade fricción de mantenimiento.

## Specification

### CR1 — Crear change con owner
- **Given** un repo Spec Ledger
- **When** ejecuto `sl new feature x "X" --owner ana`
- **Then** el frontmatter del change contiene `owner: ana`

### CR2 — Fijar y limpiar owner en un change existente
- **Given** un change sin owner
- **When** ejecuto `sl owner <id> ana`
- **Then** el frontmatter contiene `owner: ana`
- **And** `sl owner <id> -` elimina la línea `owner` del frontmatter

### CR3 — Owner visible y filtrable en el visor
- **Given** changes con distintos owners
- **When** abro el visor
- **Then** card y detalle muestran el owner cuando existe
- **And** el filtro por responsable limita las cards a ese owner
- **And** el texto del owner es buscable

## Plan

- [x] `setOwner(text, owner)` en writer.mjs: set/update/remove línea owner (CR1, CR2) — 2026-06-14T11:40:51Z
- [x] `newChange` acepta `owner` y `render()` lo inyecta (CR1) — 2026-06-14T11:40:51Z
- [x] `owner(id, name)` en agent.mjs + comando `sl new --owner` y `sl owner` en bin (CR1, CR2) — 2026-06-14T11:40:51Z
- [x] `serialize()` expone `owner`; app.js: filtro, display en card/detalle, haystack (CR3) — 2026-06-14T11:40:52Z
- [x] Tests: writer setOwner, new --owner, owner command (CR1, CR2) — 2026-06-14T11:40:52Z

## Log
- **2026-06-14T11:12:23Z** — status: draft → approved
- **2026-06-14T11:40:52Z** — status: in-progress → done
