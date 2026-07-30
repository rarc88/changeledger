---
id: "20260711-155722"
title: Projects a ancho completo con scroll por panel
type: feature
status: done
created: 2026-07-11T15:57:22Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

La pestaña Projects no aprovecha el espacio disponible y el listado de
proyectos y el formulario de configuración comparten un único scroll de
página: al bajar por la config, el listado desaparece de la vista.

## Investigation

- `renderProjects()` → `projectsViewTemplate(...)` (`src/viewer/public/app.js`)
  pinta `.projects-shell`, un grid de 2 columnas
  `minmax(320px,0.8fr) minmax(460px,1.2fr)` con `max-width: 1500px`
  (`src/viewer/public/styles.css`).
- Ni `.projects-list` ni `.project-editor` declaran `overflow` ni altura: el
  scroll es de página y ambos paneles se desplazan juntos.
- El formulario Form es largo (General, Paths, lifecycle, types, review,
  SemVer, readiness, identidad), así que el problema aparece en cualquier
  config real.
- `projectsViewTemplate` tiene buena cobertura en `test/viewer-metadata.test.mjs`;
  el cambio es de layout (CSS), no de template.

## Proposal

- Acotar `.projects-shell` a la altura del viewport disponible bajo el header
  y dar a cada panel su propio `overflow-y: auto`: la config se desplaza sin
  mover el listado, y viceversa.
- Eliminar el tope de 1500 px para que el grid crezca con el contenedor,
  manteniendo las proporciones actuales entre paneles.
- Por debajo del breakpoint estrecho existente, los paneles se apilan y vuelve
  el scroll único de página (el patrón de dos scrolls no cabe en móvil).

Alternativas descartadas:

- `position: sticky` solo en el listado: no resuelve una config más alta que
  el viewport y produce saltos con el grid.
- Virtualizar el listado: el registro local tiene pocas entradas; complejidad
  sin beneficio.

## Specification

### CR1 — Scroll independiente por panel
- **Given** un proyecto cuya configuración en Form supera la altura del viewport
- **When** se hace scroll dentro del panel de configuración hasta su final
- **Then** el listado de proyectos permanece completamente visible en su panel
- **And** el scroll del listado no se ha desplazado

### CR2 — Ancho completo
- **Given** el visor a 1600 px o más
- **When** se abre la pestaña Projects
- **Then** `.projects-shell` ocupa el ancho del contenedor sin el tope actual de 1500 px
- **And** ambos paneles crecen manteniendo sus proporciones relativas

### CR3 — Degradación estrecha
- **Given** un viewport por debajo del breakpoint estrecho
- **When** se abre la pestaña Projects
- **Then** los paneles se apilan en una columna
- **And** la página recupera un único scroll vertical sin recortar contenido

## Plan

- [x] Acotar altura y dar overflow por panel a `.projects-shell`/`.projects-list`/`.project-editor` en `src/viewer/public/styles.css`
  - **Verify:** manual browser check con una config más alta que el viewport
  - **Criteria:** CR1
  - **Resolved:** `2026-07-11T16:33:24Z`
- [x] Retirar el `max-width` del shell y ajustar proporciones en `src/viewer/public/styles.css`
  - **Verify:** manual browser check a 1600 px
  - **Criteria:** CR2
  - **Resolved:** `2026-07-11T16:33:25Z`
- [x] Ajustar el breakpoint estrecho apilando paneles con scroll de página en `src/viewer/public/styles.css`
  - **Verify:** manual browser check a 680 px
  - **Criteria:** CR3
  - **Resolved:** `2026-07-11T16:33:25Z`
- [x] Confirmar que `projectsViewTemplate` no requiere cambios y que su cobertura en `test/viewer-metadata.test.mjs` sigue verde
  - **Support:**
  - **Resolved:** `2026-07-11T16:33:25Z`
- [x] Ejecutar `pnpm verify` completo tras la implementación
  - **Support:**
  - **Resolved:** `2026-07-11T16:33:26Z`

## Log
- **2026-07-11T16:13:59Z** `[status]` draft → approved
- **2026-07-11T16:22:44Z** `[status]` approved → in-progress
- **2026-07-11T16:22:44Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T16:33:26Z** `[note]` Integrada implementación delegada (9b8b828): altura acotada por --header-height, overflow-y por panel, sin tope de 1500px, breakpoint 900px con scroll de página. CRs verificados en navegador por el implementador (scroll independiente, 1564px de shell a 1600px, apilado a 700px). pnpm verify 607/607.
- **2026-07-11T16:33:26Z** `[status]` in-progress → in-review
- **2026-07-11T16:39:33Z** `[review]` in-review → in-progress (retry): El alto fijo --header-height:55px no cubre el topbar envuelto a dos filas (94.5px reales) en la banda ~1000-1280px: el shell desborda el viewport 20-40px y rompe la garantía de CR1; derivar la altura del layout real en vez de una constante
- **2026-07-11T16:45:22Z** `[note]` Corrección confirmada por re-review de contexto limpio: ResizeObserver en bootstrap() sincroniza --header-height con el alto real del topbar (95px envuelto verificado a 1000/1150px, sin overflow); CSS queda como fallback. Divergencia del Plan justificada: derivar la altura real exige JS.
- **2026-07-11T16:45:22Z** `[status]` in-progress → in-review
- **2026-07-11T16:45:22Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:39:43Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T21:51:56Z** `[graduation]` spec: `viewer.md`
- **2026-07-11T21:54:25Z** `[archive]` archived
