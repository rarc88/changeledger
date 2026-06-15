---
id: "20260615-175732"
title: Metadatos no confiables permiten XSS en el visor
type: bug
status: done
created: 2026-06-15T17:57:32Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Tratar como no confiables todos los campos estructurados que el visor inserta
en HTML, atributos, selectores o estilos. Sanitizar el cuerpo Markdown no basta:
un repositorio clonado no debe poder ejecutar JavaScript mediante frontmatter,
configuración, headings de etapa, tareas o referencias.

## Investigation

- `safeHtml` protege el HTML generado desde Markdown y Mermaid usa modo estricto,
  cerrando el alcance del change `20260614-192814`.
- El visor construye otras superficies con `innerHTML` e interpola sin escape
  valores controlados por los documentos o por `.sl/config.yml`: `id`, `type`,
  `status`, nombres de etapa, criterios, timestamps y algunos atributos
  `data-*`/`style`.
- Ejemplos relevantes están en `loadProjects`, `hydrateFilters`, `card`,
  `openDetail`, `stageBlock`, `taskList`, `renderGraph` y `tableRow`.
- Un payload en esos campos corre en el origen local del visor. Desde allí puede
  consultar todos los proyectos registrados y leer el token efímero de escritura
  inyectado en la página.
- Este bug no duplica el XSS de Markdown: aquel contrato afirmó explícitamente
  que su superficie era el HTML del cuerpo. La auditoría encontró una frontera
  adicional en los metadatos estructurados.

## Specification

### CR1 — Texto estructurado no crea HTML activo
- **Given** un change o config con payloads HTML en `id`, `type`, `status`, título
  de etapa, criterio o timestamp
- **When** el visor renderiza board, detalle, tabla, grafo, filtros y tareas
- **Then** los payloads aparecen únicamente como texto o son rechazados
- **And** no se crean elementos, atributos ejecutables ni handlers controlados
  por el payload

### CR2 — Atributos y selectores no son inyectables
- **Given** valores con comillas, corchetes, espacios o sintaxis CSS/selector
- **When** se usan en `data-*`, `value`, `id`, selectores o custom properties
- **Then** no rompen el atributo ni alteran el selector o estilo generado
- **And** la navegación y filtros siguen apuntando al elemento correcto

### CR3 — Todas las vistas comparten una estrategia segura
- **Given** un repositorio no confiable
- **When** se recorren board, table, graph, specs, metrics y búsqueda global
- **Then** cada inserción de datos usa APIs DOM seguras o escaping contextual
- **And** no depende de que `sl check` se haya ejecutado antes

### CR4 — Markdown y Mermaid conservan su protección
- **Given** contenido Markdown permitido y payloads XSS ya cubiertos
- **When** se aplica el hardening de metadatos
- **Then** el formato permitido sigue renderizando
- **And** los tests existentes de sanitización continúan pasando

## Plan

- [x] Añadir tests DOM con payloads en metadatos, headings, tareas, config y atributos para reproducir cada contexto (CR1, CR2, CR3) — 2026-06-15T18:52:27Z
- [x] Inventariar las escrituras `innerHTML` y clasificar cada interpolación por contexto HTML, atributo, selector o estilo (CR1, CR2, CR3) — 2026-06-15T18:52:27Z
- [x] Sustituir interpolaciones no confiables por APIs DOM seguras o helpers de escape contextual; limitar valores dinámicos usados en CSS/selectores (CR1, CR2, CR3) — 2026-06-15T18:52:27Z
- [x] Ejecutar `pnpm verify` y smoke visual de todas las vistas con Markdown/Mermaid normal (CR3, CR4) — 2026-06-15T18:52:27Z

## Log
- **2026-06-15T18:29:26Z** — status: draft → approved
- **2026-06-15T18:45:44Z** — status: approved → in-progress
- **2026-06-15T18:45:44Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T18:52:27Z** — fix: app.js es módulo ESM con builders exportables; esc() (incl comillas) en todo metadato no confiable y cssIdent() en var(--type) de board/detail/table/graph/metrics/global/filtros; tests DOM reales (CR1-CR4); smoke visual del visor OK
- **2026-06-15T18:52:39Z** — status: in-progress → in-review
- **2026-06-15T18:55:46Z** — polish: esc() en throughput date y mensaje de error del board para estrategia uniforme (CR3), por revisión independiente
- **2026-06-15T18:55:59Z** — review → done (delegated subagent, clean context)
