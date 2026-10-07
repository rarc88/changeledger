---
id: "20261007-172322"
title: Incluir never y only entre los cuantificadores de la obligación de prosa
type: bug
status: draft
created: 2026-10-07T17:23:22Z
depends_on: []
related_to: ["20261007-135159"]
owner: rarc88
---

## Request

La obligación sobre prosa entregable de `templates/contract/implement.md` da
como ejemplos de cuantificadores universales «every, all, no, cannot, always».
Faltan `never` y `only`, que aparecen en las frases que fallaron en las
revisiones de esta serie (por ejemplo «never blocks the commit» en
`20261002-133728` y el «sólo» que el corrector de `20261007-135159` no listó). Se
pide que la lista de ejemplos los incluya.

## Investigation

La viñeta vive en la sección `## Evidence obligations` de
`templates/contract/implement.md` y la guarda la tabla `DELEGATION_OBLIGATIONS`
de `test/context.test.mjs`. `templates/contract/review.md` habla de «a universal
quantifier» sin ejemplos. El presupuesto de `implement` es 3000 tokens y 300
líneas; la composición mide 2796 tokens y 227 líneas desde `20261007-135159`.

Interfaces externas: ninguna.

## Specification

### CR1 — Los ejemplos incluyen never y only
- **Given** `changeledger context implement`
- **When** se lee la obligación sobre cuantificadores universales en prosa entregable
- **Then** sus ejemplos incluyen `never` y `only` además de los actuales

### CR2 — El contexto sigue dentro de su presupuesto
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** `implement` sigue dentro de sus límites

## Plan

- [ ] Probar con una guarda tolerante y añadir los ejemplos
  - **Target:** `templates/contract/implement.md, test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T17:23:22Z** `[version]` 0.18.0-dev
