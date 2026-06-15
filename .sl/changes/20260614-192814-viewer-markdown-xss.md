---
id: "20260614-192814"
title: Sanitizar Markdown y Mermaid en el visor
type: bug
status: done
created: 2026-06-14T19:28:14Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Evitar que contenido Markdown o Mermaid almacenado en changes/specs ejecute
JavaScript en `sl view`. El visor debe tratar todos los documentos del repo como
contenido no confiable, incluso cuando el repo sea local.

## Investigation

- `src/viewer/public/app.js` inserta `marked.parse(...)` mediante `innerHTML` al
  renderizar stages y specs.
- Marked no sanitiza el HTML resultante. Un documento puede incluir HTML activo,
  atributos de evento o URLs peligrosas y producir XSS persistente al abrirlo.
- El JavaScript inyectado corre en el origen del visor y puede leer todos los
  proyectos registrados mediante `/api/projects`, `/api/repo`, `/api/search` y
  `/api/git`; también puede invocar el endpoint de aprobación.
- Mermaid también procesa texto controlado por los documentos. Su configuración
  debe fijar explícitamente un nivel de seguridad compatible con contenido no
  confiable.
- Escapar solo títulos y metadatos no resuelve el problema: la superficie
  vulnerable es el HTML generado desde el cuerpo Markdown.

## Specification

### CR1 — HTML activo no se ejecuta
- **Given** un stage o spec que contiene `<img src=x onerror="window.__sl_xss=1">`
- **When** el visor renderiza el documento
- **Then** el atributo ejecutable no está presente en el DOM resultante
- **And** `window.__sl_xss` permanece sin definir

### CR2 — URLs peligrosas se neutralizan
- **Given** Markdown con un enlace `javascript:` o contenido HTML equivalente
- **When** el visor lo renderiza
- **Then** el resultado no contiene una navegación ejecutable con ese esquema

### CR3 — Markdown permitido conserva formato
- **Given** Markdown con headings, listas, tablas, código y enlaces `https`
- **When** el visor lo renderiza
- **Then** el formato esperado se conserva después de sanitizar

### CR4 — Mermaid usa configuración segura
- **Given** un bloque Mermaid proveniente de un change o spec
- **When** se procesa el diagrama
- **Then** Mermaid se inicializa con un nivel de seguridad explícito para
  contenido no confiable
- **And** el diagrama normal continúa renderizando

## Plan

- [x] Añadir una estrategia de sanitización mantenida para el HTML producido por Marked y aplicarla antes de cada inserción en el DOM — 2026-06-15T11:50:55Z
- [x] Configurar Mermaid para contenido no confiable y documentar la frontera de confianza del visor — 2026-06-15T11:50:55Z
- [x] Añadir pruebas de navegador/DOM para payloads XSS, URLs peligrosas y Markdown permitido — 2026-06-15T11:50:55Z
- [x] Ejecutar `pnpm verify` y smoke test visual de Markdown y Mermaid (CR3, CR4) — 2026-06-15T11:50:55Z

## Log
- **2026-06-15T11:38:40Z** — status: draft → approved
- **2026-06-15T11:47:48Z** — status: approved → in-progress
- **2026-06-15T11:47:49Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T11:50:55Z** — status: in-progress → done
- **2026-06-15T21:16:51Z** — graduation skipped: bug del visor; modelo de seguridad documentado en SECURITY.md, sin verdad persistente en specs/
- **2026-06-15T21:17:34Z** — archived
