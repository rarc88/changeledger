---
id: "20260711-162556"
title: migrate no propaga el tipo quick a repos schema 1
type: bug
status: in-review
created: 2026-07-11T16:25:56Z
depends_on: [ "20260711-103756" ]
release_impact: minor
owner: raruiz-hiberuscom
---

## Request

En repos consumidores ya migrados, `changeledger config migrate` responde
`Config is already at schema 1. No changes needed.` y el tipo `quick`
(introducido en #20260711-103756) nunca llega a sus `config.yml`: la matriz
nueva solo la reciben los repos creados con `init`. Reportado por el humano el
2026-07-11 tras intentar migrar `ionic-app`/`backend-laravel`.

## Investigation

- Causa raíz: `buildMigration` (`src/config-migration.mjs`) retorna `null`
  cuando `getSchemaVersion(config) === SUPPORTED_SCHEMA_VERSION` (1). Toda la
  lógica de actualización — estructura y comentarios administrados — vive solo
  en el camino 0 → 1.
- #20260711-103756 añadió `quick` a `templates/config.yml` (stages
  `request, log` e `impacts.quick: patch`) sin subir
  `SUPPORTED_SCHEMA_VERSION` ni añadir una migración 1 → 2: no existe ningún
  mecanismo que lo propague a configs schema 1.
- El motor ya cumple los invariantes necesarios (AST de YAML, preserva
  decisiones y extensiones propias, escribe atómico, no-op byte-idéntico al
  repetir): falta solo el paso de versión con su transformación aditiva.
- El viewer comparte el motor (`Migration required` + preview), así que un
  1 → 2 correcto llega gratis a ambas superficies.

## Specification

### CR1 — Migración 1 → 2 añade quick
- **Given** un `config.yml` schema 1 sin tipo `quick`
- **When** se ejecuta `changeledger config migrate`
- **Then** el resultado declara `schema_version: 2`, añade `quick` con `stages: [ request, log ]` sin `review_required` y añade `release.impacts.quick: patch`
- **And** el resumen lista ambas adiciones

### CR2 — Preserva decisiones propias
- **Given** un schema 1 que ya define un tipo `quick` propio o impacts personalizados
- **When** se ejecuta la migración
- **Then** el `quick` existente y los impacts propios quedan byte a byte intactos
- **And** solo se actualiza `schema_version`

### CR3 — Idempotencia y frontera de versión
- **Given** un config ya en schema 2
- **When** se ejecuta `changeledger config migrate`
- **Then** responde que no hay cambios y no reescribe el archivo
- **And** un schema mayor que 2 sigue fallando cerrado

### CR4 — Detección y preview en ambas superficies
- **Given** un repo schema 1
- **When** `changeledger check` o el viewer cargan el config
- **Then** ofrecen la migración pendiente 1 → 2 con dry-run/preview antes de aplicar

## Plan

- [x] Añadir en `test/config-migration.test.mjs` los casos 1 → 2: adición de quick, preservación, idempotencia y schema futuro para `src/config-migration.mjs`; verify: `node --test test/config-migration.test.mjs` (CR1, CR2, CR3) — 2026-07-11T21:25:29Z
- [x] Implementar la migración 1 → 2 y subir `SUPPORTED_SCHEMA_VERSION` en `src/config-migration.mjs` y `templates/config.yml`; verify: `node --test test/config-migration.test.mjs` (CR1, CR3) — 2026-07-11T21:25:29Z
- [x] Cubrir la detección/preview compartida CLI+viewer en `src/viewer/domain.mjs` con test en `test/view.test.mjs`; verify: `node --test test/view.test.mjs` (CR4) — 2026-07-11T21:25:29Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T21:25:29Z

## Log
- **2026-07-11T21:05:23Z** — status: draft → approved
- **2026-07-11T21:08:41Z** — status: approved → in-progress
- **2026-07-11T21:08:41Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T21:25:29Z** — Integrada implementación delegada (e1f8f30, 3712162): schema 2 con migración 1→2 aditiva (quick + impacts.quick), idempotente, byte-intacta para config custom, falla cerrado en schema 3; viewer usa el schema del payload en vez del duplicado hardcodeado. Nota: el delegado tocó src/viewer/domain.mjs y src/viewer/public/app.js más allá del ownership declarado, reportado y justificado por CR4 (región disjunta de la corrección pendiente de 20260711-155719). pnpm verify 638/638.
- **2026-07-11T21:25:29Z** — status: in-progress → in-review
