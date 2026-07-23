---
id: "20260723-170611"
title: Emisión única de errores en comandos state sin --json
type: bug
status: draft
created: 2026-07-23T17:06:11Z
depends_on: []
related_to: ["20260721-193103", "20260722-203029", "20260722-202101"]
release_impact: patch
---

## Request

La doble auditoría del 2026-07-23 confirmó (reproducción en vivo con `changeledger state doctor` sin `--activation-ref`) que un fallo de cualquier subcomando `state` sin `--json` emite el mismo error dos veces: primero el receipt por stderr y después la línea `Error: <mensaje>` del wrapper exterior del CLI.

## Investigation

Causa raíz: `stateAction` en `bin/changeledger.mjs` (~línea 182). En el catch, la rama sin `--json` imprime `stateReceiptDetails(receipt)` por `console.error` y **relanza** el error; el wrapper de acción exterior lo captura e imprime su propia línea `Error: ...` — doble emisión para un único fallo. La rama `--json` hace lo correcto: imprime el receipt, fija `process.exitCode = 1` y no relanza.

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

- [ ] Actualizar `stateAction` en `bin/changeledger.mjs` para no relanzar en la rama sin `--json`, emitiendo el error una vez y fijando `process.exitCode = 1`, escribiendo primero en `test/state-command.test.mjs` el test rojo que captura stderr y cuenta una única emisión de receipt y de mensaje; verify: `node --test test/state-command.test.mjs` (CR1, CR2)
- [ ] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)

## Log
