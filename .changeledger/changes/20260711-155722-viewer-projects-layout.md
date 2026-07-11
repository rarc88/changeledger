---
id: "20260711-155722"
title: Projects a ancho completo con scroll por panel
type: feature
status: in-progress
created: 2026-07-11T15:57:22Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
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

- [ ] Acotar altura y dar overflow por panel a `.projects-shell`/`.projects-list`/`.project-editor` en `src/viewer/public/styles.css`; verify: manual browser check con una config más alta que el viewport (CR1)
- [ ] Retirar el `max-width` del shell y ajustar proporciones en `src/viewer/public/styles.css`; verify: manual browser check a 1600 px (CR2)
- [ ] Ajustar el breakpoint estrecho apilando paneles con scroll de página en `src/viewer/public/styles.css`; verify: manual browser check a 680 px (CR3)
- [ ] Confirmar que `projectsViewTemplate` no requiere cambios y que su cobertura en `test/viewer-metadata.test.mjs` sigue verde (support)
- [ ] Ejecutar `pnpm verify` completo tras la implementación (support)

## Log
- **2026-07-11T16:13:59Z** — status: draft → approved
- **2026-07-11T16:22:44Z** — status: approved → in-progress
- **2026-07-11T16:22:44Z** — owner → raruiz-hiberuscom (auto)
