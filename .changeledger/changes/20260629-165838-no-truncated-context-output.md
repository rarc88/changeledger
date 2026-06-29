---
id: "20260629-165838"
title: Forbid truncated context output
type: bug
status: in-review
created: 2026-06-29T16:58:38Z
depends_on: []
owner: Roberto Ruiz
---

## Request

Se observó que algunos agentes ejecutan `changeledger context` mediante
pipelines que truncan la salida, como `changeledger context 2>&1 | head -100`, y
luego tratan esa salida parcial como contexto válido. El bootstrap y el contrato
core deben declarar explícitamente que eso no es válido.

## Investigation

El endurecimiento anterior de descubrimiento de contexto exige leer la salida
completa y detenerse cuando la salida está truncada o incompleta. Eso cubre la
truncación accidental o impuesta por la herramienta, pero no prohíbe
explícitamente que el propio agente cree la truncación al usar pipes, filtros o
límites de líneas.

La corrección debe ser acotada:

- mantener `changeledger context` como comando obligatorio de descubrimiento;
- no agregar un comando rápido/corto separado;
- exigir explícitamente que se ejecute directamente;
- prohibir explícitamente pipes, filtros, resúmenes y límites de líneas antes de
  que el agente lea la salida.

## Specification

### CR1: Bootstrap forbids truncated context commands

- **Given** un bootstrap generado o del repositorio con la instrucción
  ChangeLedger
- **When** un agente lo lee antes de modificar archivos
- **Then** le indica ejecutar `changeledger context` directamente
- **And** prohíbe usar pipes, filtros, resúmenes, límites o truncamiento de la
  salida

### CR2: Core contract forbids self-created truncation

- **Given** `changeledger context` compone el contrato core
- **When** se muestra el fast path no negociable
- **Then** declara que debe obtenerse contexto completo antes de trabajar
- **And** prohíbe explícitamente formas de comando como `head`, `tail`, `sed` o
  `grep` que limitan o filtran la salida antes de leerla

### CR3: Contract tests cover the prohibition

- **Given** el contrato y el bootstrap se generan desde código fuente
- **When** los tests inspeccionan esas salidas
- **Then** fallan si desaparece la instrucción de no truncar/no filtrar

## Plan

- [x] Target src/contract.mjs; verify: pnpm test test/contract.test.mjs (CR1) — 2026-06-29T17:09:47Z
- [x] Target templates/contract/core.md; verify: pnpm test test/context.test.mjs test/cli.test.mjs (CR2) — 2026-06-29T17:09:50Z
- [x] Target .changeledger/specs/contract-discovery.md; verify: node bin/changeledger.mjs check 20260629-165838 (CR2) — 2026-06-29T17:09:56Z
- [x] Target src/contract.mjs templates/contract/core.md .changeledger/specs/contract-discovery.md; verify: pnpm test test/contract.test.mjs test/context.test.mjs test/cli.test.mjs (CR1, CR2, CR3) — 2026-06-29T17:10:01Z
- [x] Target src/contract.mjs templates/contract/core.md .changeledger/specs/contract-discovery.md; verify: node bin/changeledger.mjs check 20260629-165838 (CR1, CR2, CR3) — 2026-06-29T17:10:24Z

## Log

- 2026-06-29T16:58:38Z — Se redactó el change tras observar agentes ejecutando
  `changeledger context` mediante `head -100`.
- 2026-06-29T17:02:00Z — Se corrigió la narrativa del draft a español según
  `config.language: es`.
- **2026-06-29T17:03:15Z** — status: draft → approved
- 2026-06-29T17:05:00Z — Se ajustaron los criterios y tareas para cumplir las
  keywords estructurales y trazabilidad requeridas por `changeledger check`.
- **2026-06-29T17:07:27Z** — status: approved → in-progress
- **2026-06-29T17:07:27Z** — owner → Roberto Ruiz (auto)
- **2026-06-29T17:10:29Z** — Implementado: bootstrap y core ahora exigen ejecutar changeledger context directamente, sin pipes/filtros/resúmenes/límites/truncamiento; tests enfocados y pnpm verify pasan.
- **2026-06-29T17:11:19Z** — status: in-progress → in-review
