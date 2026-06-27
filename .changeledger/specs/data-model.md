---
title: Modelo de datos e identidad
updated: 2026-06-27T21:25:58Z
tags: [ data-model ]
---

## Modelo de datos

- **change**: un archivo markdown. Frontmatter estructurado (`id`, `title`,
  `type`, `status`, `created`, `depends_on`, `owner` opcional, `archived` opcional,
  `reviewed` opcional, `release_impact` opcional) + etapas (`## Request`…`## Log`) según el tipo. Tiene ciclo
  de vida (ver **Ciclo de vida y gate de revisión**). Tareas en `## Plan` como
  checklist (`[ ]`/`[x]`/`[!]`).
- **spec**: un archivo markdown sin ciclo de vida. Frontmatter mínimo (`title`,
  `updated`, `tags`) + cuerpo libre. Es la verdad persistente; un change `done`
  gradúa su verdad aquí.
- **release**: manifiesto YAML inmutable en `.changeledger/releases/<version>.yml` con
  versión SemVer estable, timestamp y ids de changes. La pertenencia se deriva
  solo de estos manifiestos y no se duplica en cada change.

## Identidad

`id` = instante UTC de creación `YYYYMMDD-HHMMSS`, derivado de `created`. Único
sin coordinación central; `changeledger new` incrementa 1s ante colisión en el mismo
segundo. La reserva se hace de forma atómica por id (`wx` sobre un lock temporal
y escritura exclusiva del archivo final), de modo que dos procesos concurrentes
no pueden escribir el mismo id. El lock incluye metadata del proceso propietario:
si queda huérfano por una terminación abrupta, `changeledger new` lo puede recuperar; si el
lock desaparece durante la comprobación, el comando reintenta sin fallar. El slug
estructural se normaliza a kebab ASCII y se rechaza si queda vacío. Ordenable
cronológicamente.

La normalización de slugs vive en un helper compartido por `changeledger new` y
`changeledger graduate`: minúsculas, diacríticos fuera, separadores no alfanuméricos a
guiones y rechazo cuando no queda ninguna letra o número ASCII. Así los nombres
estructurales mantienen la misma política en changes y specs.
