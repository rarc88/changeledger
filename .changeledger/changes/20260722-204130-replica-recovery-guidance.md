---
id: "20260722-204130"
title: Orientar la recuperación desde comandos de réplica
type: bug
status: in-progress
created: 2026-07-22T20:41:30Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260722-203031"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` encontró dos fallos LOW
de orientación operacional: `state abort --pending` puede dejar la réplica
`stale` sin avisarlo en el receipt, y ejecutar `state doctor` para diagnosticar
la réplica falla exigiendo `--activation-ref` con un mensaje de migración ajeno.
El estado interno permanece recuperable, pero el operador no recibe el siguiente
comando correcto.

## Investigation

`stateAbort` devuelve el resultado de la réplica, pero la acción del CLI no
convierte la condición `stale` posterior al abort en una instrucción de
`state sync`. Por separado, `stateDoctor` valida siempre `activationRef` antes
de distinguir si el usuario busca diagnosticar migración o réplica. Crear un
nuevo modo de doctor ampliaría innecesariamente la superficie; la corrección
mínima es conservar el doctor de migración y dirigir explícitamente el triage de
réplica a `changeledger state status`.

## Specification

### CR1 — Abort stale indica el siguiente paso
- **Given** `state abort --pending` elimina pending pero deja la réplica `stale`
- **When** el CLI emite el receipt humano o JSON
- **Then** conserva `stale: true` y declara que se requiere `changeledger state
  sync`
- **And** una réplica no stale no recibe esa instrucción

### CR2 — Doctor dirige el triage de réplica
- **Given** se invoca `state doctor` sin `--activation-ref`
- **When** el CLI rechaza la invocación
- **Then** explica que doctor valida una activación y dirige el diagnóstico de
  réplica a `changeledger state status`
- **And** no emite un error de manifest ni crea un modo nuevo de doctor

## Plan

- [ ] Añadir tests fallidos de abort stale/no-stale y extender el receipt en `src/commands/state.mjs`/`bin/changeledger.mjs`; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` comprueba stale y la instrucción de sync en humano/JSON (CR1)
- [ ] Añadir un test fallido de doctor sin activation-ref y reemplazar el mensaje en `src/commands/state.mjs`; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` exige la orientación literal a `changeledger state status` (CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:41:30Z** `[note]` Draft separado de 20260722-203031 para concentrar la orientación operacional de comandos de réplica y elegir el mensaje mínimo hacia state status en lugar de ampliar doctor.
- **2026-07-23T09:28:30Z** `[status]` draft → approved
- **2026-07-23T13:13:07Z** `[status]` approved → in-progress
- **2026-07-23T13:13:07Z** `[owner]` set: raruiz-hiberuscom (auto)
