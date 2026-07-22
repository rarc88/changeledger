---
id: "20260722-163409"
title: Cubrir los guards de migración sin tests
type: chore
status: in-validation
created: 2026-07-22T16:34:09Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193103", "20260721-193106"]
release_impact: none
---

## Request

Una auditoría adversarial externa de `20260721-193103` encontró tres guards de
seguridad implementados pero sin ninguna cobertura en
`test/state-migration.test.mjs`. No hay bug conocido: es deuda de evidencia que
la calificación de producción (`20260721-193106`) contaría como `fail` por
invariante sin prueba. Sin cambios de comportamiento; solo tests.

Guards descubiertos sin cobertura:

- `state baseline already exists with different content`
  (`src/state-migration.mjs:640`): el rechazo de un remoto divergente en
  `--create`; solo el camino idempotente de árbol idéntico está probado.
- `doctor --online` con baseline remoto ausente o no descendiente
  (`src/state-migration.mjs:1186-1193`): el test online existente solo cubre
  el avance de source heads.
- `authorityProblems` (`src/state-migration.mjs:1060-1081`): la clasificación
  compatibility vs data_divergence nunca se alimenta con una activation ref
  cuyo `authority.yml` no coincide con el baseline.

## Plan

- [x] Añadir test de `--create` contra un remoto con state ref existente y árbol distinto: rechaza con `state baseline already exists with different content` sin escribir; verify: `node --test test/state-migration.test.mjs` (support)
  - **Resolved:** `2026-07-22T17:40:00Z`
- [x] Añadir tests de `doctor --online` con baseline remoto ausente y con baseline no descendiente; verify: `node --test test/state-migration.test.mjs` (support)
  - **Resolved:** `2026-07-22T17:40:00Z`
- [x] Añadir tests de doctor con authority divergente (project_id e inventory_digest incorrectos) verificando la categoría reportada; verify: `node --test test/state-migration.test.mjs` (support)
  - **Resolved:** `2026-07-22T17:40:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T17:45:00Z`

## Log

- **2026-07-22T16:49:05Z** `[status]` draft → approved
- **2026-07-22T17:11:42Z** `[status]` approved → in-progress
- **2026-07-22T17:11:42Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T17:45:00Z** `[note]` Añadidos los tres tests de cobertura. Cada uno mutation-tested manualmente: neutralizado temporalmente el guard correspondiente (comparación de árbol divergente, ambas ramas de `doctor --online`, bucle de comparación de `authorityProblems`) y confirmado que el test falla sin él, antes de restaurar el código y confirmar verde. Gate completo: pnpm verify.
- **2026-07-22T17:24:03Z** `[status]` in-progress → in-validation
