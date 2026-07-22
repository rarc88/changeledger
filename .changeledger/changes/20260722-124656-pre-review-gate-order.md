---
id: "20260722-124656"
title: Evitar que un gate local fallido cuente como review
type: bug
status: draft
created: 2026-07-22T12:46:56Z
depends_on: []
related_to: ["20260615-150510", "20260629-234939", "20260704-114323", "20260721-193102"]
---

## Request

El gate local debe decidir si existe un candidato revisable. Hoy el contrato
mueve primero el change a `in-review` y después ejecuta formatter, suite completa
y `changeledger check`. Si uno falla, el lifecycle ya afirma que comenzó review
aunque ningún reviewer haya inspeccionado el resultado.

Se necesita mantener el change en `in-progress` hasta que el candidato pase sus
gates, sin ejecutar comandos externos como efecto lateral de una mutación de
ChangeLedger.

## Investigation

La receta ordenada de `templates/contract/implement.md` líneas 73–82 indica:
completar tareas, ejecutar `changeledger status <id> in-review` y solo después
aplicar formatter y gates completos. `templates/contract/review.md` declara en
cambio que el candidato llega a review después de esos gates. Las dos fuentes
son semánticamente incompatibles.

Cuando el gate posterior falla, no existe una transición agente directa de
`in-review` a `in-progress` por fallo local. El camino disponible
`review fail --retry` registra un veredicto que nunca ocurrió, contamina Log y
métricas, y puede iniciar un ciclo de review artificial. En el extremo, una
mutación de lifecycle inválida también puede dejar un intento transitorio que el
validador reconstruye desde un Log incompleto.

La causa raíz es el orden contractual, no falta de hooks. ChangeLedger evita
deliberadamente ejecutar formatter o tests configurables dentro de comandos de
mutación; por tanto el agente debe ejecutar el gate host antes de solicitar la
transición y el CLI debe mantener atómica su propia escritura estructural.

## Specification

### CR1 — Gate host ocurre antes de review
- **Given** implementación y tareas completas mientras el change sigue en `in-progress`
- **When** el agente prepara el candidato para review
- **Then** ejecuta formatter, verificaciones de cada tarea, suite completa y `changeledger check` antes de `status <id> in-review`
- **And** solo si todas terminan correctamente solicita la transición

### CR2 — Fallo previo no crea historia de review
- **Given** cualquier comando del gate host falla antes de la transición
- **When** termina la preparación
- **Then** el change permanece en `in-progress`
- **And** el Log no recibe eventos `review` ni `in-review`
- **And** las métricas de intentos de review no cambian

### CR3 — Transición estructural atómica
- **Given** un candidato cuyo gate host pasó
- **When** `changeledger status <id> in-review` intenta escribir status y Log
- **Then** valida el documento candidato completo antes de reemplazar la fuente de verdad
- **And** ante error conserva byte por byte el documento anterior y reporta la causa

### CR4 — Post-transición solo valida la mutación
- **Given** una transición exitosa a `in-review`
- **When** el agente prepara delegación
- **Then** reaplica formatter al documento y ejecuta `changeledger check`
- **And** no repite la suite host completa si ningún archivo de implementación cambió
- **And** cualquier alteración adicional del candidato obliga a repetir las verificaciones afectadas antes del reviewer

### CR5 — Tipos sin review usan el mismo orden
- **Given** un type sin `review_required`
- **When** completa implementación y tareas
- **Then** pasa el gate host mientras continúa `in-progress`
- **And** solo después transiciona a `in-validation` y valida la mutación estructural

## Plan

- [ ] Actualizar en `templates/**` (`templates/contract/implement.md` y `templates/contract/review.md`) el orden normativo y eliminar la contradicción; verify: `node --test test/context.test.mjs` (`test/**`) (CR1, CR2, CR4, CR5)
- [ ] Blindar escritura transaccional de status+Log en `src/lifecycle.mjs` y comandos de lifecycle; verify: `node --test test/lifecycle.test.mjs test/cli.test.mjs` (CR3)
- [ ] Verificar que métricas cuentan solo verdicts reales en `src/metrics.mjs`; verify: `node --test test/metrics.test.mjs` (CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T12:46:56Z** `[note]` Draft separa fallo de preparación y fallo de review: gates externos antes del lifecycle, validación estructural atómica durante la transición.
