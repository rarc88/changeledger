---
id: "20260713-124934"
title: Evitar corrupción del render al actualizar filtros
type: quick
status: in-progress
created: 2026-07-13T12:49:34Z
depends_on: []
owner: Test
---

## Request

Corregir el error intermitente `Cannot set properties of null (setting 'data')`
que aparece después de limpiar filtros o al cambiar entre proyectos en el viewer.
Los resúmenes y controles de filtros deben actualizarse sin alterar manualmente
el DOM administrado por Lit, y los cambios de proyecto posteriores deben renderizar
sin excepciones y conservar el estado de filtros correspondiente a cada proyecto.

Añadir una regresión automatizada que reproduzca limpiar un filtro y volver a
renderizarlo con valores distintos antes de aplicar la corrección.

## Log

- 2026-07-13T12:49:34Z — Se reprodujo la excepción exacta: asignar `textContent`
  a un resumen elimina el marcador hijo de Lit; el siguiente render intenta
  actualizar `node.data` cuando `nextSibling` ya es `null`.
- 2026-07-13T12:49:34Z — Alcance limitado a los filtros de tipo, owner y estado;
  la solución hará que Lit reconcilie tanto el resumen como los checkboxes.
- **2026-07-13T12:50:31Z** — status: draft → approved
- **2026-07-13T12:51:10Z** — status: approved → in-progress
- **2026-07-13T12:51:10Z** — owner → Test (auto)
