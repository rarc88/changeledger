---
id: "20260730-213353"
title: Ejecutar los scripts pnpm en Windows
type: quick
status: draft
created: 2026-07-30T21:33:53Z
depends_on: []
related_to: []
owner: rarc88
release_impact: none
---

## Request

Corregir el gate `pnpm verify` para que los scripts que fijan
`CHANGELEDGER_NO_GH=1` se ejecuten también en Windows. El ajuste debe conservar
el kill-switch que impide accesos de red durante la suite, no añadir
dependencias y dejar que la matriz existente ejecute lint, tests y check en
Node 24 y 26.

## Log

- **2026-07-30T21:33:53Z** `[note]` Draft creado tras observar que pnpm usa `cmd.exe` en Windows y rechaza los prefijos POSIX de `test` y `verify`; se propone habilitar el emulador de shell propio de pnpm.
