---
id: "20260615-222618"
title: Reemplazar HTML manual del visor por templates seguros
type: refactor
status: draft
created: 2026-06-15T22:26:18Z
depends_on: ["20260615-214817", "20260615-214819"]
---

## Request

Reducir la superficie de `innerHTML` del visor usando un paquete pequeño de
templates DOM en lugar de construir grandes strings HTML a mano. La meta no es
adoptar un framework, sino hacer más difícil introducir XSS accidental en vistas
estructuradas.

## Proposal

Usar `lit-html` como dependencia runtime deliberada del visor. Es una librería
standalone de templates, madura, pequeña para este caso y usable sin `LitElement`
ni framework de componentes. Las vistas del visor deberían renderizar nodos con
`html`/`render`, dejando `innerHTML` solo para fronteras justificadas.

Reglas de la migración:

- UI estructurada: board, table, graph wrapper, specs, metrics, detalles y
  resultados globales se expresan como templates `lit-html`.
- Markdown de documentos: sigue pasando por `safeHtml()` y DOMPurify. Si se usa
  una directiva equivalente a HTML crudo, queda encapsulada en un helper único
  que solo acepta HTML ya sanitizado.
- Mermaid/SVG: se conserva la inicialización estricta; cualquier SVG generado
  desde datos del repo debe escapar atributos/texto o pasar por templates.
- No se introduce router, build step, bundler ni framework de aplicación.

Alternativas descartadas:

- Mantener strings manuales: funciona, pero mantiene demasiada presión sobre
  `esc()` y revisiones humanas.
- `uhtml`: es atractivo por tamaño, pero `lit-html` tiene documentación y adopción
  más amplias para una dependencia de seguridad indirecta.
- Framework grande: no corresponde al tamaño del visor.

## Plan

- [ ] Añadir `lit-html` como dependencia runtime documentada del viewer
- [ ] Crear un módulo de render base que exporte helpers de templates y el wrapper único para HTML Markdown sanitizado
- [ ] Migrar primero `view-parts.js` y `view-renderers.js`, manteniendo selectores/IDs usados por tests y eventos
- [ ] Migrar `app.js` para usar `render()` en contenedores principales en vez de asignar grandes strings a `innerHTML`
- [ ] Mantener DOMPurify como dependencia obligatoria para Markdown y añadir tests que fallen si HTML no sanitizado llega al wrapper
- [ ] Ejecutar `pnpm test -- test/viewer-sanitize.test.mjs test/viewer-metadata.test.mjs test/view.test.mjs` y `pnpm check`

## Log
