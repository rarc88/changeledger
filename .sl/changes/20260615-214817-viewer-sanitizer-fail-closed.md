---
id: "20260615-214817"
title: El visor debe fallar cerrado si falta DOMPurify
type: bug
status: done
created: 2026-06-15T21:48:17Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Corregir la frontera de seguridad del visor: si DOMPurify no está disponible,
el visor no debe insertar HTML generado desde documentos del repo. Los cambios y
specs son input no confiable aunque vivan en local.

## Investigation

`src/viewer/public/app.js` centraliza el render Markdown en `safeHtml()`. Hoy
convierte Markdown con `marked.parse()` y, si `DOMPurify` existe, sanitiza el
resultado. Pero si DOMPurify no carga o la dependencia servida bajo `/vendor/`
falla, la función devuelve el HTML sin sanitizar.

Eso contradice `SECURITY.md`: "Untrusted content never executes". La degradación
actual es cómoda para desarrollo, pero no es segura para un visor que lee repos
clonados o documentos escritos por agentes.

Riesgo: XSS local en el origen del visor si un documento malicioso se abre cuando
DOMPurify no está presente.

## Specification

### CR1 — Markdown no se renderiza sin sanitizador
- **Given** `DOMPurify` no está definido en el entorno del visor
- **When** `safeHtml('<img src=x onerror=alert(1)>')` se invoca
- **Then** el resultado no contiene HTML activo ni atributos ejecutables
- **And** el visor muestra un fallo seguro o texto escapado en vez de HTML sin sanitizar

### CR2 — Markdown permitido sigue funcionando con DOMPurify
- **Given** `DOMPurify.sanitize()` está disponible
- **When** el visor renderiza Markdown normal como `**texto**`
- **Then** el HTML sanitizado conserva el formato permitido
- **And** scripts, handlers y `javascript:` siguen eliminándose

### CR3 — La carga de dependencias del visor falla de forma visible
- **Given** una dependencia crítica del visor no carga
- **When** el usuario abre `sl view`
- **Then** la UI muestra un error claro en lugar de degradar silenciosamente la seguridad

## Plan

- [x] Añadir tests en `test/viewer-sanitize.test.mjs` para el caso sin `DOMPurify` y para el camino sano con sanitizador (CR1, CR2) — 2026-06-15T22:02:51Z
- [x] Cambiar `safeHtml()` en `src/viewer/public/app.js` para fallar cerrado o renderizar texto escapado cuando falta DOMPurify (CR1, CR3) — 2026-06-15T21:55:07Z
- [x] Revisar `src/viewer/public/index.html` y `src/commands/view.mjs` para que las dependencias críticas del visor no parezcan opcionales (CR3) — 2026-06-15T21:55:07Z
- [x] Ejecutar `pnpm test -- test/viewer-sanitize.test.mjs` y `pnpm check` (CR1, CR2, CR3) — 2026-06-15T21:59:43Z

## Log
- **2026-06-15T21:52:24Z** — status: draft → approved
- **2026-06-15T21:53:14Z** — status: approved → in-progress
- **2026-06-15T21:53:14Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:00:05Z** — status: in-progress → in-review
- **2026-06-15T22:02:31Z** — review → in-progress (retry): Plan incompleto detectado por revisión independiente
- **2026-06-15T22:03:03Z** — status: in-progress → in-review
- **2026-06-15T22:07:19Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:08:03Z** — graduado a spec `architecture.md`
