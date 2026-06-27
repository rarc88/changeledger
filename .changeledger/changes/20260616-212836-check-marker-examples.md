---
id: "20260616-212836"
title: sl check no debe interpretar ejemplos de graduación como enlaces reales
type: bug
status: done
created: 2026-06-16T21:28:36Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Al documentar un futuro comando, mencionar un ejemplo literal del marcador de
graduación con placeholder hizo que `sl check` lo interpretara como enlace real
a un spec inexistente. Los ejemplos o placeholders no deben crear errores de
integridad change↔spec.

## Investigation
- `check` busca marcadores de graduación en el texto completo del change con una
  expresión regular.
- Esa búsqueda no distingue `## Log` de otras secciones ni distingue ejemplos de
  marcadores reales.
- Un texto explicativo con el marcador y un placeholder terminó como error
  `graduated to a missing spec`.
- Los enlaces reales de graduación los escribe `sl graduate` en `## Log`; la
  validación debería usar esa fuente, no cualquier mención narrativa.

## Specification
### CR1 — Ejemplos no crean enlaces
- **Given** un change menciona un ejemplo de marcador de graduación fuera de `## Log`
- **When** se ejecuta `sl check`
- **Then** no se interpreta como enlace real change→spec

### CR2 — Placeholders no fallan como specs
- **Given** un documento contiene un placeholder textual para explicar el marcador de graduación
- **When** se ejecuta `sl check`
- **Then** no falla por spec inexistente derivado del placeholder

### CR3 — Enlaces reales siguen validándose
- **Given** `## Log` contiene un marcador real de graduación hacia un spec inexistente
- **When** se ejecuta `sl check`
- **Then** mantiene el error de enlace roto

### CR4 — Backlinks de specs siguen validándose
- **Given** un spec referencia un change inexistente con su marcador de graduación
- **When** se ejecuta `sl check`
- **Then** mantiene el error de backlink roto

## Plan
- [x] Limitar en `src/check.mjs` la detección de enlaces change→spec a marcadores reales del `## Log`, cubierto por `test/check.test.mjs` (CR1, CR2, CR3) — 2026-06-17T10:15:59Z
- [x] Añadir regresiones en `test/check.test.mjs` para ejemplo narrativo, placeholder, enlace real roto y backlink roto de `src/check.mjs` (CR1, CR2, CR3, CR4) — 2026-06-17T10:16:06Z
- [x] Ejecutar `pnpm test -- test/check.test.mjs` contra `src/check.mjs` y `node bin/sl.mjs check` (CR1, CR2, CR3, CR4) — 2026-06-17T10:16:15Z

## Log
- **2026-06-16T21:28:36Z** — Creado desde fricción observada: una mención literal del marcador de graduación en un draft fue validada como enlace real.
- **2026-06-17T10:04:23Z** — status: draft → approved
- **2026-06-17T10:14:56Z** — status: approved → in-progress
- **2026-06-17T10:14:56Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:16:20Z** — status: in-progress → in-review
- **2026-06-17T10:18:05Z** — review → done (delegated subagent, clean context)
- **2026-06-17T10:18:10Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
