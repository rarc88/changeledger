---
id: "20260721-124530"
title: Cobertura SHA-256 en mutate, sync y cutover del almacén de estado
type: quick
status: approved
created: 2026-07-21T12:45:30Z
depends_on: []
related_to: ["20260720-124231"]
---

## Request

La primera revisión independiente de `20260720-124231` confirmó que la
inicialización del almacén (`state init`) funciona sobre un repositorio
Git SHA-256, pero señaló que las rutas de mutación — `state-store.mjs`'s
mutate/publish, `syncStateStore` y el cutover en `state-migration.mjs` — solo
tienen prueba explícita en SHA-1. No hay evidencia de un bug concreto; es un
gap de cobertura conocido, quedó registrado en el Log de `20260720-124231` sin
CR ni Plan. Este change lo cierra: agregar regresión SHA-256 a esas rutas, y
si algo falla, corregirlo dentro del mismo alcance (mismo patrón que ya usa
`zeroFor(oid)`/regex `{40,64}` para la inicialización).

## Log

- **2026-07-21T12:45:30Z** `[note]` Creado a partir del gap de cobertura
  registrado en el Log de `20260720-124231`; ese gap no bloqueaba su
  validation por sí solo, pero el humano decidió cerrarlo con un change propio
  en vez de dejarlo como riesgo aceptado implícito.
- **2026-07-21T12:49:18Z** `[status]` draft → approved
