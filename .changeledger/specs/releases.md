---
title: Releases portables
updated: 2026-06-27T21:37:15Z
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
