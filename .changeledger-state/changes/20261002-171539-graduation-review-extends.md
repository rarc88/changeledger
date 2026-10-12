---
id: "20261002-171539"
title: La revisión de la reconciliación cubre también ampliar una spec
type: feature
status: done
created: 2026-10-02T17:15:39Z
depends_on: []
archived: true
reviewed: true
branch: feature/20261002-171539
related_to: ["20261002-152555"]
owner: Carlos Rodríguez
release_impact: patch
---

## Request

`#20261002-152555` hizo obligatoria la revisión `graduation-review` cuando el
cierre «crea o corrige» specs. El mismo overlay de cierre reconoce un tercer
modo de tocar una spec: ampliarla con verdad nueva («One change may create,
correct or extend several specs»). Leída al pie de la letra, la regla deja sin
revisar un cierre que sólo amplía una spec existente, y ese texto pasa a ser
verdad persistente igual que una corrección. Lo señalaron las revisiones de
`#20261002-152555`.

Se pide que la obligación cubra los tres modos: crear, corregir y ampliar.

Fuera de alcance:

- Cambiar qué hace el revisor.
- Imponer la revisión en `check` o `graduate`.
- Los tipos sin `review_required` y `--skip`.

## Investigation

Estado actual, verificado en `dev`:

- **Overlay de cierre.** `templates/contract/close.md` dice «In a type with
  `review_required`, when closure creates or corrects specs, delegate
  `graduation-review` …». Unas líneas antes, la lista de modos dice «One change
  may create, correct or extend several specs».
- **Esqueleto de prompt.** `templates/contract/agent-prompts/graduation-review.md`
  describe el hueco `{{specs}}` como «each spec slug the closure creates or
  corrects».
- **Guard.** La entrada 19 de `CONCEPT_GUARDS` en `test/context.test.mjs`
  formula la obligación como «creates or corrects specs». Su regex acepta
  `(creat|correct)\w*` antes de `specs`, así que no exige que se nombre la
  ampliación.
- **Spec.** `lifecycle` (sección `## Graduación`, párrafo «Revisión de la
  reconciliación») repite «cuando el cierre crea o corrige specs».
- **Presupuesto.** El overlay `done` mide 1224 de 1250 tokens
  (`templates/contract/budgets.yml`).

## Proposal

- En `close.md`, la condición pasa a «when closure creates, corrects or extends
  specs». Son unos pocos tokens.
- En el esqueleto, `{{specs}}` pasa a «each spec slug the closure creates,
  corrects or extends».
- La entrada 19 del guard exige los tres verbos en la condición, de modo que
  quitar cualquiera la haga fallar.

No cambia ningún comando ni el recorrido del cierre, así que el recorrido de
extremo a extremo de `#20261002-152555` (su CR8) sigue siendo el primer uso
real.

**Alternativa descartada:** «when closure writes any spec». Es más corta, pero
pierde el paralelismo con la lista de modos del mismo overlay.

## Specification

### CR1 — El cierre exige la revisión también al ampliar
- **Given** un change `done` de un tipo con `review_required`
- **When** se ejecuta `changeledger context <id>`
- **Then** la obligación de delegar `graduation-review` antes del primer `--into` se aplica cuando el cierre crea, corrige o amplía specs
- **And** la entrada 19 de `CONCEPT_GUARDS` falla si se quita cualquiera de los tres modos de la condición

### CR2 — El esqueleto nombra los tres modos
- **Given** cualquier repo ChangeLedger
- **When** se ejecuta `changeledger agent-prompt graduation-review`
- **Then** el hueco `{{specs}}` se describe como las specs que el cierre crea, corrige o amplía

### CR3 — Presupuesto respetado
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** el overlay `done` y el esqueleto quedan dentro de sus techos, sin quitar prosa normativa

## Plan

- [x] Condición de los tres modos en `close.md` y guard 19 que los exige
  - **Target:** `templates/contract/close.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-10-02T17:19:29Z`
- [x] Descripción de `{{specs}}` en el esqueleto
  - **Target:** `templates/contract/agent-prompts/graduation-review.md`
  - **Verify:** `node --test test/agent-prompt.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-10-02T17:19:30Z`
- [x] Gate completo: `biome check`, `node --test` y `changeledger check`
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T17:19:32Z`

## Log
- **2026-10-02T17:16:19Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T17:16:21Z** `[status]` approved → in-progress
- **2026-10-02T17:16:21Z** `[branch]` set: feature/20261002-171539 (auto)
- **2026-10-02T17:19:27Z** `[note]` Implementado por el orquestador (edición pequeña). Guard 19 en rojo antes de editar close.md ('close no longer delegates graduation-review before the first --into') y en verde después; tres mutantes —quitar creates, corrects o extends de la condición— fallan el guard y cada fichero se restauró idéntico (sha). CR2 se verifica ejecutando agent-prompt graduation-review, sin test que fije la frase (AGENTS.md). Esqueleto: 528 tokens. La tarea 3 (pnpm verify) se cumple con biome check, node --test (1549/1549) y changeledger check, porque el pnpm instalado (v11.13.0) no cumple el >=12.6.0.
- **2026-10-02T17:19:39Z** `[status]` in-progress → in-review
- **2026-10-02T17:19:46Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR3 sobre dev..bf1fc11 (templates/contract/close.md, templates/contract/agent-prompts/graduation-review.md, test/context.test.mjs). La implementación la hizo el orquestador.
- **2026-10-02T17:25:48Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T17:25:49Z** `[note]` Seguimientos de la revisión (no bloquean): los huecos del guard 19 (40/30/20) toleran la redacción actual pero no un reordenamiento como «extends, creates or corrects specs»; el comentario «in any order» describe el rol y --into, no los verbos. La spec lifecycle sigue diciendo «crea o corrige» y se reconcilia al cerrar.
- **2026-10-02T17:30:51Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T17:32:17Z** `[note]` graduation-review de la reconciliación (lifecycle): recomienda aplicar; la frase coincide con la condición de close.md y ninguna otra spec conserva «crea o corrige».
- **2026-10-02T17:32:18Z** `[graduation]` spec: `lifecycle.md`
- **2026-10-12T21:17:02Z** `[version]` 0.18.0-dev
- **2026-10-12T21:17:02Z** `[archive]` archived
