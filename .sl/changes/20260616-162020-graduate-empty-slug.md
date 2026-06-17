---
id: "20260616-162020"
title: Rechazar slugs vacios en sl graduate
type: bug
status: done
created: 2026-06-16T16:20:20Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Hacer que `sl graduate` rechace slugs que normalizan a vacio, igual que ya hace
`sl new`.

## Investigation

`src/commands/new.mjs` normaliza el slug y falla con el mensaje literal
`slug must contain at least one ASCII letter or number` cuando no queda ningun
caracter valido.

`src/commands/graduate.mjs` tiene su propio `slugify`, no elimina diacriticos y
no valida el resultado. Un slug sin letras ni numeros ASCII puede terminar
produciendo el archivo `.md`, lo que rompe la politica de nombres estructurales
en ingles y crea un artefacto ambiguo.

## Specification

### CR1 — Slug que normaliza a vacio
- **Given** un cambio `done` existente con id `20260616-000001`
- **When** se ejecuta `sl graduate 20260616-000001 "!!!"`
- **Then** el comando falla con el mensaje literal `slug must contain at least one ASCII letter or number`
- **And** no se crea ningun archivo `.md` nuevo en `specs_dir`

### CR2 — Slug valido conserva comportamiento
- **Given** un cambio `done` existente con id `20260616-000002`
- **When** se ejecuta `sl graduate 20260616-000002 architecture-note`
- **Then** se crea el spec `architecture-note.md`
- **And** el change queda enlazado en `## Log` con el marcador de graduacion hacia `architecture-note.md`

### CR3 — La normalizacion de slugs es compartida
- **Given** el texto de slug `Árbol Técnico`
- **When** lo usan `sl new` y `sl graduate`
- **Then** ambos comandos derivan el mismo slug normalizado `arbol-tecnico`

## Plan

- [x] Añadir tests en `test/graduate.test.mjs` para `src/commands/graduate.mjs` con slug vacio y ausencia de escrituras al fallar (CR1) — 2026-06-16T16:30:06Z
- [x] Añadir test en `test/graduate.test.mjs` o `test/cli-bin.test.mjs` para `src/commands/graduate.mjs` con slug valido y comportamiento existente (CR2) — 2026-06-16T16:30:11Z
- [x] Extraer la normalizacion a un helper compartido en `src/` y cubrirlo con `test/graduate.test.mjs` para que `src/commands/new.mjs` y `src/commands/graduate.mjs` deriven el mismo slug (CR1, CR3) — 2026-06-16T16:30:11Z
- [x] Actualizar `src/commands/graduate.mjs` y cubrirlo con `test/graduate.test.mjs` para rechazar slugs vacios con el mismo mensaje de `sl new` (CR1, CR2) — 2026-06-16T16:30:15Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para verificar `src/commands/graduate.mjs` con `test/graduate.test.mjs` (CR1, CR2, CR3) — 2026-06-16T16:30:21Z

## Log
- **2026-06-16T16:25:24Z** — status: draft → approved
- **2026-06-16T16:29:14Z** — status: approved → in-progress
- **2026-06-16T16:29:14Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:30:21Z** — status: in-progress → in-review
- **2026-06-16T16:42:58Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:44:41Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
