---
id: "20260613-205459"
title: sl new genera el slug del archivo en español
type: bug
status: done
created: 2026-06-13T20:54:59Z
depends_on: ["20260613-150402"]
reviewed: true
---

## Request

`sl new` deriva el slug del nombre de archivo a partir del `title`, que está en
el idioma del repo (español). El contrato (`AGENTS.md` §8) exige que los nombres
de archivo sean **siempre en inglés** (son estructura, no contenido). `sl new`
viola su propio contrato.

Ejemplo: `20260613-205056-sl-new-colisiona-ids-creados-en-el-mismo-segundo.md`.

## Investigation

- `slugify(title)` produce el slug; `title` es contenido (idioma variable).
- El slug es parte del nombre de archivo → estructura → debe ser inglés.
- Necesitamos separar el **slug inglés** (estructura) del **title** (contenido).

## Specification

### CR1 — Slug inglés explícito
- **Given** ejecuto `sl new` con un slug y un título
- **When** se crea el change
- **Then** el nombre de archivo usa el slug inglés provisto
- **And** el `title` del frontmatter conserva el idioma del contenido

### CR2 — Slug normalizado
- **Given** un slug con mayúsculas o espacios
- **When** se crea el change
- **Then** se normaliza a kebab-case ascii (`a-z0-9-`)

## Plan

- [x] Cambiar firma a `sl new <type> <slug> "<title>"` (CR1) — 2026-06-13T20:57:00Z
- [x] Normalizar el slug (kebab ascii); el `title` ya no alimenta el nombre (CR2) — 2026-06-13T20:57:30Z
- [x] Actualizar `AGENTS.md` §7 (slug inglés explícito) y README/USAGE — 2026-06-13T20:58:00Z
- [x] Tests: slug inglés en el archivo, title en frontmatter — 2026-06-13T20:58:30Z

## Log

- **2026-06-13T20:54:59Z** — Creado en draft. Bug encontrado tras feedback humano:
  los nombres de archivo deben ser inglés (§8); `sl new` los generaba en español.
- **2026-06-13T20:58:30Z** — Aprobado e implementado. Firma `sl new <type> <slug>
  <title>`: slug inglés normalizado para el archivo, `title` (contenido) al
  frontmatter. `AGENTS.md` §7 y README actualizados. Tests verde. `in-progress → done`.
