---
id: "20260613-150430"
title: Visor — búsqueda en contenido, filtros, vista tabla y responsive
type: feature
status: done
created: 2026-06-13T15:04:30Z
depends_on: ["20260613-134548"]
---

## Request

Mejorar el consumo humano del visor:

1. **Bug:** la búsqueda de texto no encuentra términos del cuerpo. Buscar "awc"
   no devolvió 0001 pese a estar en su Log; solo busca en `id/title/type`.
2. Filtros más potentes (por estado además de tipo, combinables).
3. **Vista tabla** para escaneo/filtrado denso, alternativa al kanban.
4. **Responsive**: en móvil el kanban se rompe.

## Investigation

- Búsqueda actual (`app.js`) concatena solo `id title type`. Debe indexar también
  el cuerpo de las etapas y las tareas.
- Kanban usa columnas de ancho fijo con scroll horizontal → inservible en móvil.

## Proposal

- Búsqueda full-text sobre id, title, type, cuerpo de etapas y tareas.
- Barra de filtros: tipo + estado (multi), combinables con la búsqueda.
- Toggle de vista: Board / Table / Graph. La tabla: columnas id, title, type,
  status, progreso, deps; ordenable y filtrable.
- Layout responsive: en viewport angosto, kanban colapsa a columnas apiladas o
  la tabla se vuelve la vista por defecto.

## Specification

### CR1 — Búsqueda en contenido
- **Given** un change cuyo término solo aparece en el cuerpo de una etapa
- **When** busco ese término
- **Then** el change aparece en los resultados

### CR2 — Vista tabla
- **Given** changes en el repo
- **When** activo la vista Table
- **Then** se listan en una tabla ordenable con id, title, type, status, progreso

### CR3 — Filtro por estado
- **Given** changes en varios estados
- **When** filtro por uno o más estados
- **Then** solo se muestran los que coinciden, combinado con la búsqueda

### CR4 — Responsive móvil
- **Given** un viewport angosto (móvil)
- **When** abro el visor
- **Then** el contenido es usable sin scroll horizontal roto

## Plan

- [x] Fix búsqueda: indexar cuerpo de etapas + tareas (CR1) — 2026-06-13T15:26:00Z
- [x] Filtro de estado multi, combinable (CR3) — 2026-06-13T15:28:00Z
- [x] Vista tabla ordenable (CR2) — 2026-06-13T15:30:00Z
- [x] CSS responsive / breakpoints móvil (CR4) — 2026-06-13T15:32:00Z

## Log

- **2026-06-13T15:04:30Z** — Creado en draft a partir de feedback humano tras
  probar el visor. Incluye el bug de búsqueda en contenido.
- **2026-06-13T15:08:09Z** — Aprobado (draft → approved).
- **2026-06-13T15:32:37Z** — Implementado y verificado en navegador (móvil
  incluido): búsqueda full-text (id/title/type/cuerpo de etapas/tareas) — "awc"
  ahora encuentra los changes que lo mencionan; filtro de estado multi (chips,
  combinable con búsqueda y tipo); vista tabla ordenable (id, title, type,
  status, progreso, deps); layout responsive (columnas apiladas en móvil).
  `in-progress → done`.
