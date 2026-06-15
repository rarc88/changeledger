---
id: "20260613-222913"
title: sl check detecta marcadores de conflicto de merge
type: feature
status: done
created: 2026-06-13T22:29:13Z
depends_on: []
archived: true
reviewed: true
---

## Request

Tras un merge, un change puede quedar con marcadores de conflicto (`<<<<<<<`, `=======`, `>>>>>>>`). `sl check` debe detectarlos y fallar, evitando que se commiteen.

## Investigation

- `checkRepo` recibe el repo ya parseado (changes con `frontmatter`/`stages`),
  sin el texto crudo. Los marcadores pueden caer en cualquier zona (frontmatter,
  cuerpo) y un `<<<<<<<` rompería el parseo o quedaría en un stage body.
- `loadRepo` (repo.mjs) ya lee el texto del archivo antes de parsear: basta con
  adjuntar el `text` crudo a cada change para que `check` lo escanee.
- Precisión: `<<<<<<<` y `>>>>>>>` (7 símbolos a inicio de línea) no aparecen en
  markdown normal. `=======` colisiona con un subrayado setext de H1, pero los
  documentos usan headings ATX (`##`), así que el riesgo es nulo en la práctica.

## Proposal

`loadRepo` adjunta `text` (crudo) a cada change. `checkRepo` escanea, por change
objetivo, líneas que empiecen por exactamente 7 `<`, `=` o `>` y emite un error
con el número de línea. Si un change no trae `text` (tests unitarios antiguos),
se omite la comprobación — no rompe nada.

Descartado: re-leer archivos dentro de `check.mjs` (rompe la pureza "sin IO" del
validador; el texto ya está disponible en la carga).

## Specification

### CR1 — Detectar marcador de conflicto
- **Given** un change cuyo contenido tiene una línea `<<<<<<< HEAD`
- **When** ejecuto `sl check`
- **Then** se reporta un error que menciona el marcador y la línea
- **And** el código de salida es 1

### CR2 — Repo limpio no falsea
- **Given** changes sin marcadores
- **When** ejecuto `sl check`
- **Then** no se emite ningún error de conflicto

## Plan

- [x] `loadRepo` adjunta el texto crudo `text` a cada change (CR1) — 2026-06-14T11:43:27Z
- [x] `checkRepo` escanea `text` y reporta marcadores con su línea (CR1, CR2) — 2026-06-14T11:43:27Z
- [x] Tests: detecta los tres marcadores; repo limpio no falsea (CR1, CR2) — 2026-06-14T11:43:27Z

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
- **2026-06-14T11:43:27Z** — status: in-progress → done
- **2026-06-15T21:17:55Z** — archived
