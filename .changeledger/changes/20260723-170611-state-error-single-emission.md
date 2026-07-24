---
id: "20260723-170611"
title: Emisión única de errores en comandos state sin --json
type: bug
status: done
created: 2026-07-23T17:06:11Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193103", "20260722-203029", "20260722-202101"]
release_impact: patch
---

## Request

La doble auditoría del 2026-07-23 confirmó (reproducción en vivo con `changeledger state doctor` sin `--activation-ref`) que un fallo de cualquier subcomando `state` sin `--json` emite el mismo error dos veces: primero el receipt por stderr y después la línea `Error: <mensaje>` del wrapper exterior del CLI.

## Investigation

Causa raíz: `stateAction` en `bin/changeledger.mjs` (~línea 182). En el catch, la rama sin `--json` imprime `stateReceiptDetails(receipt)` por `console.error` y **relanza** el error hacia el wrapper de acción exterior, que imprime la línea `Error: ...` y termina con `process.exit(1)` duro.

Corrección del diagnóstico durante la implementación: la reproducción pre-fix mostró exactamente un `Receipt:` y un `Error:` — `stateReceiptDetails` no incluye el mensaje de error, así que la «doble emisión» reportada por ambas auditorías era un falso positivo textual. El defecto real es arquitectural: la rama sin `--json` delega su emisión de error en el wrapper genérico y en un `process.exit(1)` duro, mientras la rama `--json` posee su salida completa y termina de forma ordenada con `process.exitCode = 1`. Los CRs siguen siendo el contrato correcto (una emisión de cada cosa, exit 1) y quedan fijados por tests de regresión.

Cambios relacionados (contexto): [20260721-193103] introdujo la línea; [20260722-203029] amplió la procedencia de los receipts; [20260722-202101] acotó los diagnósticos que alimentan el receipt.

Decisión: paridad con la rama `--json` — imprimir receipt más una única línea de error, fijar `process.exitCode = 1` y no relanzar, conservando el exit code distinto de cero.

## Specification

### CR1 — Fallo sin --json emite receipt y error una sola vez
- **Given** un repo donde `changeledger state doctor` falla por falta de activation ref
- **When** se ejecuta el comando sin `--json`
- **Then** stderr contiene exactamente una vez el receipt y exactamente una vez el mensaje de error del fallo
- **And** el proceso termina con exit code 1

### CR2 — La rama --json no cambia
- **Given** el mismo repo y fallo
- **When** se ejecuta el comando con `--json`
- **Then** stderr contiene exactamente un objeto JSON de receipt y ningún texto adicional
- **And** el proceso termina con exit code 1

## Plan

- [x] Actualizar `stateAction` en `bin/changeledger.mjs` para no relanzar en la rama sin `--json`, emitiendo el error una vez y fijando `process.exitCode = 1`, escribiendo primero en `test/state-command.test.mjs` el test rojo que captura stderr y cuenta una única emisión de receipt y de mensaje; verify: `node --test test/state-command.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-23T17:52:13Z`
- [x] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T17:57:14Z`

## Log
- **2026-07-23T17:41:38Z** `[status]` draft → approved (human via conversation)
- **2026-07-23T17:41:38Z** `[status]` approved → in-progress
- **2026-07-23T17:41:38Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T17:41:59Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T17:52:13Z** `[note]` Implementación delegada: rama sin --json ya no relanza; emite receipt + una línea Error y fija exitCode=1 (paridad estructural con --json). Diagnóstico corregido en Investigation: la duplicación textual era falso positivo; el defecto era rethrow + process.exit(1) duro. 23/23 en test/state-command.test.mjs.
- **2026-07-23T17:57:15Z** `[status]` in-progress → in-review
- **2026-07-23T17:58:54Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:45:53Z** `[validation]` in-validation → done (human accepted)
