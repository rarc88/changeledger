---
id: "20260616-212319"
title: Archivar un change graduado no debe dejar stale el spec
type: bug
status: done
created: 2026-06-16T21:23:19Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Al archivar changes ya graduados a `architecture.md`, `sl check` avisó que el
spec estaba stale: el `updated` del spec era anterior a la nueva entrada de Log
`archived` del change. Archivar no cambia la verdad persistente graduada, así que
no debería obligar a refrescar el spec.

## Investigation
- `check` compara `spec.updated` contra actividad de changes enlazados.
- El archivado añade una entrada de Log posterior al marcador `graduado a spec`.
- Esa actividad es de presentación/board, no de verdad persistente, pero hoy
  cuenta para decidir que el spec quedó viejo.
- Refrescar `updated` manualmente arregla el warning, pero crea ruido y oculta
  la intención semántica.

## Specification
### CR1 — Archivar no vuelve stale un spec
- **Given** un change `done` graduado a un spec
- **When** se archiva después de la graduación
- **Then** `sl check` no marca el spec como stale solo por esa entrada de Log

### CR2 — Cambios relevantes sí mantienen el warning
- **Given** un change enlazado a un spec tiene actividad posterior que representa verdad graduada o nueva graduación
- **When** el spec `updated` queda anterior a esa actividad relevante
- **Then** `sl check` mantiene el warning de stale

### CR3 — Enlaces rotos siguen fallando
- **Given** un change dice `graduado a spec` hacia un archivo inexistente
- **When** se ejecuta `sl check`
- **Then** el error de enlace roto se mantiene

### CR4 — Specs huérfanos siguen avisando
- **Given** un spec no referencia ningún change existente
- **When** se ejecuta `sl check`
- **Then** el warning de orphan spec se mantiene

## Plan
- [x] Ajustar la heurística de stale en `src/check.mjs` para ignorar actividad no persistente posterior a la graduación, cubierta por `test/check.test.mjs` (CR1, CR2) — 2026-06-17T10:22:33Z
- [x] Añadir regresiones en `test/check.test.mjs` para archivar luego de graduar, enlace roto y spec huérfano en `src/check.mjs` (CR1, CR3, CR4) — 2026-06-17T10:22:37Z
- [x] Ejecutar `pnpm test -- test/check.test.mjs` contra `src/check.mjs` y `node bin/sl.mjs check` (CR1, CR2, CR3, CR4) — 2026-06-17T10:22:42Z

## Log
- **2026-06-16T21:23:19Z** — Creado desde fricción observada: archivar un change graduado generó stale warning en el spec sin cambio real de verdad persistente.
- **2026-06-17T10:03:06Z** — status: draft → approved
- **2026-06-17T10:21:35Z** — status: approved → in-progress
- **2026-06-17T10:21:35Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:22:59Z** — status: in-progress → in-review
- **2026-06-17T10:24:01Z** — review → done (delegated subagent, clean context)
- **2026-06-17T10:24:05Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
