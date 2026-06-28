---
title: Releases portables
updated: 2026-06-28T22:02:31Z
tags: [ releases ]
---

## Releases portables

`changeledger release init <version>` crea el baseline de adopción con todos los changes
que ya están `done`. A partir de ahí, `changeledger release plan [--json]` selecciona los
`done` ausentes del historial, resuelve el impacto desde
`release_impact` o `release.impacts.<type>` y calcula el siguiente SemVer por el
impacto máximo. Los changes con impacto `none` acompañan una entrega cuando otro
change exige bump; si todos son `none`, el plan es un no-op exitoso.

`changeledger release record <version>` recalcula bajo un lock global del historial y crea
atómicamente el manifiesto solo si la versión coincide. El CLI no conoce ni
modifica manifests de Node, Flutter, Rust u otras tecnologías, y tampoco crea
commits, tags, releases remotas, pushes o publicaciones. La salida JSON es el
contrato para que el agente aplique la versión y ejecute el delivery propio del
repositorio.

La preparación rutinaria de una entrega es trabajo operativo: bump de versión,
manifiesto de release, gates de calidad, empaquetado, commits, tags y publicación
no requieren un change por sí solos ni deben agruparse en un chore. Si durante
la preparación aparece una corrección funcional, un cambio del workflow de
publicación o documentación persistente, se captura como un change independiente,
se completa y se vuelve a ejecutar `changeledger release plan` antes de
`changeledger release record <version>`. El flujo se mantiene agnóstico del stack.
