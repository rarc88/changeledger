---
id: "20260721-124530"
title: Cobertura SHA-256 en mutate, sync y cutover del almacén de estado
type: quick
status: done
created: 2026-07-21T12:45:30Z
depends_on: []
owner: raruiz-hiberuscom
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
- **2026-07-21T12:52:51Z** `[status]` approved → in-progress
- **2026-07-21T12:52:51Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-21T12:53:01Z** `[note]` Rama creada desde codex/global-state-branch, no desde dev: dev todavía no tiene el código de 20260720-124231 (done, sin graduar/mergear). Desviación intencional del formato estándar, documentada aquí por trazabilidad.
- **2026-07-21T12:59:30Z** `[note]` Added SHA-256 regression coverage for mutate/CAS retry and syncStateStore's disjoint-retry path (test/state-store.test.mjs), and for the cutover flow preview/init/activate plus abort/recover (test/state-command.test.mjs). All new tests pass on the first run; no SHA-256 bug found in state-store.mjs/state-migration.mjs/commands/state.mjs, so this closes the coverage gap with no code fix needed. pnpm test (794 pass), pnpm lint and changeledger check all clean.
- **2026-07-21T12:59:36Z** `[status]` in-progress → in-validation
- **2026-07-21T15:50:25Z** `[validation]` in-validation → done (human accepted)
