---
id: "20261007-172322"
title: Incluir never y only entre los cuantificadores de la obligación de prosa
type: bug
status: in-review
created: 2026-10-07T17:23:22Z
depends_on: []
branch: bug/20261007-172322
related_to: ["20261007-135159", "20261002-133728"]
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

- [x] Probar con una guarda tolerante y añadir los ejemplos
  - **Target:** `templates/contract/implement.md, test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T12:46:12Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T12:46:13Z`

## Log
- **2026-10-07T17:23:22Z** `[version]` 0.18.0-dev
- **2026-10-12T11:14:40Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T12:44:13Z** `[status]` approved → in-progress
- **2026-10-12T12:44:13Z** `[branch]` set: bug/20261007-172322 (auto)
- **2026-10-12T12:46:13Z** `[note]` Implementado por el orquestador sin delegar, por ser trivialmente pequeño: la lista de ejemplos de la viñeta de prosa entregable de templates/contract/implement.md pasa a (every, all, no, never, only, cannot, always), y una fila nueva de DELEGATION_OBLIGATIONS en test/context.test.mjs la guarda con una mitad para never y otra para only, cada una en ambos órdenes y acotada a la frase por [^.;]. Rojo: implement.md no longer states the obligation con la mitad de never. Mutantes: quitar never y quitar only fallan cada uno su mitad; una reformulación (that uses never, only, every, all, no, cannot or always as a universal quantifier) pasa; el archivo se restauró y se comprobó por sha256 tras cada uno. pnpm verify en verde con 1815/1815; el contexto implement sigue en 227 de 300 líneas y los tests de presupuesto pasan. Frases cuantificadas añadidas: el comentario «Each example is its own half, held to the sentence that names quantifiers», cuyo borde son los mutantes M1 y M2 (cada uno falla sólo su mitad); los ejemplos del contrato son normativos.
- **2026-10-12T12:46:14Z** `[status]` in-progress → in-review
- **2026-10-12T12:46:19Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR2 y el Plan, con las reglas de AGENTS.md sobre la prosa del contrato (guardas tolerantes, sin fijar frases literales, presupuestos) y la frase cuantificada informada en la nota anterior como puntos de escrutinio.
