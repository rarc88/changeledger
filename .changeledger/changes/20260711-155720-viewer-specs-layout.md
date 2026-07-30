---
id: "20260711-155720"
title: Pantalla Specs con grid rico a ancho completo
type: feature
status: done
created: 2026-07-11T15:57:20Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

La pestaña Specs del visor es floja y no aprovecha el espacio disponible: una
sola columna de 760 px con cards que solo muestran título, fecha y tags,
independientemente del viewport.

## Investigation

- `renderSpecs()` (`src/viewer/public/app.js`) filtra por texto y delega el
  markup en `specsListHtml(specs, fmtDateTime)`
  (`src/viewer/public/view-renderers.js`).
- `.specs-view` es un flex column con `max-width: 760px`
  (`src/viewer/public/styles.css`): en un monitor ancho queda una columna
  estrecha rodeada de vacío.
- Cada `.spec-card` muestra solo `.spec-title`, `updated` formateado y pills de
  tags; ni extracto del cuerpo ni ninguna señal de contenido. El click abre el
  detalle (`openSpec`).
- El payload de `/api/repo` ya sirve el cuerpo completo de cada spec (el filtro
  de texto ya busca en él), así que un extracto no requiere cambios de server.
- Solo aplica el filtro de texto global; type/owner/status no tienen sentido
  para specs (no son changes) y quedan fuera del alcance.
- `specsListHtml` no tiene cobertura en `test/viewer-metadata.test.mjs` (sí la
  tienen otros templates del mismo módulo).

## Proposal

Convertir la lista en un grid responsive a ancho completo con cards más
informativas, sin tocar el server:

- Grid `auto-fill, minmax(~320px, 1fr)` ocupando el ancho disponible del
  contenedor; en viewports estrechos degrada a una columna.
- Card enriquecida: título, `updated`, tags y un extracto de texto plano del
  primer párrafo del cuerpo (excluyendo el historial de graduación), truncado
  con elipsis. El extracto se deriva del Markdown crudo sin renderizarlo (sin
  HTML), preservando la frontera de sanitización actual.
- Orden por `updated` descendente para que la verdad más reciente aparezca
  primero.
- Comportamiento intacto: click abre el detalle, búsqueda global sigue
  filtrando por título/tags/cuerpo.

Alternativas descartadas:

- Tabla densa: las specs son documentos, no filas; el grid conserva la
  invitación a leer.
- Extracto renderizado con Markdown: complica sanitización y altura de card
  para ganancia mínima.

## Specification

### CR1 — Grid a ancho completo
- **Given** el visor a 1280 px o más con al menos 6 specs
- **When** se abre la pestaña Specs
- **Then** las cards se disponen en un grid de al menos 3 columnas que ocupa el ancho del contenedor, sin el tope actual de 760 px
- **And** por debajo de 680 px el grid degrada a una sola columna

### CR2 — Card con extracto
- **Given** un spec cuyo cuerpo empieza con el historial `> Graduado del change …` seguido de un párrafo de prosa
- **When** se renderiza su card
- **Then** la card muestra título, fecha `updated`, tags y un extracto en texto plano de ese primer párrafo de prosa (sin blockquotes ni sintaxis Markdown), truncado con elipsis
- **And** el extracto se inserta como texto, nunca como HTML interpretable

### CR3 — Orden por actualización
- **Given** specs con distintos `updated`
- **When** se renderiza la lista
- **Then** las cards aparecen ordenadas por `updated` descendente

### CR4 — Búsqueda y navegación intactas
- **Given** un término en la búsqueda global que solo matchea el cuerpo de un spec
- **When** se abre la pestaña Specs
- **Then** solo ese spec se muestra
- **And** el click en la card sigue abriendo su detalle

## Plan

- [x] Añadir en `test/viewer-metadata.test.mjs` cobertura de `specsListHtml` de `src/viewer/public/view-renderers.js`: extracto plano, orden por updated y escape del contenido
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-07-11T16:35:35Z`
- [x] Implementar extracto y orden en `specsListHtml` de `src/viewer/public/view-renderers.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-07-11T16:35:35Z`
- [x] Reemplazar el layout de `.specs-view`/`.spec-card` por grid responsive en `src/viewer/public/styles.css`
  - **Verify:** manual browser check a 1280 px y 680 px
  - **Criteria:** CR1
  - **Resolved:** `2026-07-11T16:35:36Z`
- [x] Verificar búsqueda y apertura de detalle en `renderSpecs` de `src/viewer/public/app.js`
  - **Verify:** manual browser check
  - **Criteria:** CR4
  - **Resolved:** `2026-07-11T16:35:36Z`
- [x] Ejecutar `pnpm verify` completo tras la implementación
  - **Support:**
  - **Resolved:** `2026-07-11T16:35:36Z`

## Log
- **2026-07-11T16:13:57Z** `[status]` draft → approved
- **2026-07-11T16:22:10Z** `[status]` approved → in-progress
- **2026-07-11T16:22:10Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T16:35:36Z** `[note]` Integrada implementación delegada (57e3ce1): grid auto-fill minmax(320px,1fr) con breakpoint 680px, specExcerpt en texto plano saltando el historial de graduación, sortSpecsByUpdated compartido con renderSpecs para mantener el índice de click. CRs verificados en navegador por el implementador. pnpm verify 610/610.
- **2026-07-11T16:35:36Z** `[status]` in-progress → in-review
- **2026-07-11T16:45:57Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:39:38Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T21:51:56Z** `[graduation]` spec: `viewer.md`
- **2026-07-11T21:54:25Z** `[archive]` archived
