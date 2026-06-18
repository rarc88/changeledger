---
id: "20260616-151221"
title: Hacer estricto el parsing del formato de changes
type: bug
status: done
created: 2026-06-16T15:12:21Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Reducir la fragilidad del parsing de changes. La auditoría encontró que
`src/change.mjs` interpreta el markdown con regex deliberadamente simples; eso es
compatible con el tamaño actual, pero deja que documentos fuera del formato
canónico se lean como válidos o que errores manuales queden invisibles hasta más
tarde.

## Investigation

- `splitStages()` convierte cualquier heading `## ...` a lowercase y lo trata
  como stage key; esto permite que `## request` sea interpretado como `request`
  aunque el contrato fija heading inglés con casing canónico.
- `parseTasks()` acepta cualquier checklist `- [ ]` dentro de Plan, pero no
  valida que una tarea `done` tenga timestamp ISO UTC ni que una bloqueada tenga
  razón no vacía.
- La extracción de criterios solo enumera encabezados `### CRn`; no detecta CR
  duplicados ni numeración sospechosa.
- No hace falta introducir un parser Markdown completo todavía. Basta con
  separar parseo tolerante para visualización de validación estricta en
  `sl check`.

## Specification

### CR1 — Headings de stage canónicos
- **Given** un change con `## request` en lugar de `## Request`
- **When** se ejecuta `sl check`
- **Then** falla con `stage heading must be canonical: expected "## Request"`

### CR2 — Tareas done requieren timestamp válido
- **Given** un change con una tarea `- [x] Hacer algo (CR1)` sin sufijo de timestamp
- **When** se ejecuta `sl check`
- **Then** falla con `done task is missing an ISO 8601 UTC resolution timestamp`

### CR3 — Tareas bloqueadas requieren razón
- **Given** un change con una tarea `- [!] Hacer algo (CR1)` sin razón tras `—`
- **When** se ejecuta `sl check`
- **Then** falla con `blocked task is missing a reason`

### CR4 — Criterios duplicados son error
- **Given** una Specification con dos encabezados `### CR1`
- **When** se ejecuta `sl check`
- **Then** falla con `duplicate criterion "CR1"`

## Plan

- [x] Añadir tests de casing canónico de stages en `test/change.test.mjs` o `test/check.test.mjs` y validación en `src/check.mjs` usando datos de `src/change.mjs` (CR1) — 2026-06-16T15:17:37Z
- [x] Añadir tests de timestamp de tarea done en `test/check.test.mjs` y validación sobre `tasks.resolvedAt` en `src/check.mjs` (CR2) — 2026-06-16T15:17:37Z
- [x] Añadir tests de razón de tarea bloqueada en `test/check.test.mjs` y validación sobre `tasks.reason` en `src/check.mjs` (CR3) — 2026-06-16T15:17:38Z
- [x] Exponer o calcular duplicados de criterios en `src/change.mjs` y cubrirlos desde `test/check.test.mjs` (CR4) — 2026-06-16T15:17:38Z
- [x] Ejecutar `pnpm verify` y registrar el resultado en `## Log` (CR1, CR2, CR3, CR4) — 2026-06-16T15:17:38Z

## Log
- **2026-06-16T15:15:15Z** — status: draft → approved
- **2026-06-16T15:16:38Z** — status: approved → in-progress
- **2026-06-16T15:16:38Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T15:17:38Z** — Implemented strict stage heading, task suffix and duplicate criterion checks; node --test test/check.test.mjs passed.
- **2026-06-16T15:17:38Z** — status: in-progress → in-review
- **2026-06-16T15:20:04Z** — review → in-progress (retry): sl check fails on historical tasks whose description contains an em dash before the timestamp; tests were too synthetic.
- **2026-06-16T15:20:34Z** — Fixed parser interaction by reading task suffixes from the last em dash separator; node --test test/change.test.mjs test/check.test.mjs and sl check passed.
- **2026-06-16T15:20:34Z** — status: in-progress → in-review
- **2026-06-16T15:21:36Z** — review → done (delegated subagent, clean context)
- **2026-06-16T15:21:36Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
