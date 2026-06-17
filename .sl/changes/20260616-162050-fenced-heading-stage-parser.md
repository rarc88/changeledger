---
id: "20260616-162050"
title: Ignorar headings dentro de fenced code blocks
type: bug
status: done
created: 2026-06-16T16:20:50Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Evitar que el parser de cambios trate como etapas los headings `## ...` que
aparecen dentro de bloques fenced de Markdown.

## Investigation

`src/change.mjs` divide las etapas con cualquier linea que coincida con
`/^##\s+(.+?)\s*$/`. Esto funciona para documentos simples, pero Markdown permite
bloques fenced. Por ejemplo, una etapa puede documentar un bloque de codigo que
contiene la linea literal `## Request`.

En ese caso el heading es contenido del bloque de codigo, no una etapa real. El
parser actual lo interpretaria como nueva etapa y podria producir duplicados,
orden incorrecto o perdida de contenido renderizado.

## Specification

### CR1 — Heading dentro de fence no crea etapa
- **Given** un change markdown con una etapa `## Investigation` que contiene un bloque fenced con la linea literal `## Request`
- **When** se llama `parseChange`
- **Then** el resultado contiene una sola etapa con key `request`
- **And** la linea literal `## Request` permanece dentro del body de `investigation`

### CR2 — Heading fuera de fence sigue creando etapa
- **Given** un change markdown con `## Request`, un bloque fenced cerrado, y luego `## Investigation`
- **When** se llama `parseChange`
- **Then** el resultado contiene las etapas `request` e `investigation` en ese orden

### CR3 — Fence sin cerrar conserva comportamiento defensivo
- **Given** un change markdown con `## Request`, un bloque fenced abierto y una linea posterior `## Investigation`
- **When** se llama `parseChange`
- **Then** `## Investigation` permanece en el body de `request`
- **And** no se crea una etapa `investigation` desde dentro del fence abierto

## Plan

- [x] Añadir tests en `test/change.test.mjs` para `src/change.mjs` con headings dentro de fences cerrados y abiertos (CR1, CR2, CR3) — 2026-06-16T16:32:51Z
- [x] Actualizar `src/change.mjs` y cubrirlo con `test/change.test.mjs` para que `splitStages` lleve estado de fenced code blocks y solo detecte etapas fuera de fences (CR1, CR2, CR3) — 2026-06-16T16:32:54Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para verificar `src/change.mjs` con `test/change.test.mjs` (CR1, CR2, CR3) — 2026-06-16T16:32:58Z

## Log
- **2026-06-16T16:26:19Z** — status: draft → approved
- **2026-06-16T16:32:23Z** — status: approved → in-progress
- **2026-06-16T16:32:23Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:33:01Z** — status: in-progress → in-review
- **2026-06-16T16:43:29Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:44:55Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
