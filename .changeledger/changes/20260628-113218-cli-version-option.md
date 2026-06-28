---
id: "20260628-113218"
title: Exponer la versión instalada desde el CLI
type: bug
status: in-validation
created: 2026-06-28T11:32:18Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Un usuario que acaba de instalar o actualizar ChangeLedger necesita comprobar
qué versión ejecuta antes de migrar repositorios o reportar una fricción. El CLI
no ofrece hoy la convención estándar `--version`/`-V`; responde `unknown option
'--version'` aunque `package.json` contiene la versión publicada.

## Investigation

- `bin/changeledger.mjs` usa Commander, que ya proporciona `.version()` y las
  opciones estándar sin introducir un subcomando propio.
- `package.json` es la fuente publicada de la versión (`0.5.0` actualmente) y ya
  viaja dentro del tarball; duplicar un literal en el binario permitiría drift.
- `test/cli-bin.test.mjs` ya ejecuta el binario real y lee el `package.json`, por
  lo que puede verificar la relación exacta entre ambos.

## Specification

### CR1 — `--version` imprime la versión del paquete
- **Given** que `package.json` declara una versión concreta
- **When** ejecuto `changeledger --version`
- **Then** el proceso termina con código `0`
- **And** stdout contiene exactamente esa versión y un salto de línea, sin texto adicional

### CR2 — alias corto `-V`
- **Given** la misma instalación de ChangeLedger
- **When** ejecuto `changeledger -V`
- **Then** produce exactamente la misma salida exitosa que `changeledger --version`

### CR3 — una sola fuente de verdad
- **Given** que el binario se ejecuta desde el código fuente o desde el tarball instalado
- **When** resuelve la versión
- **Then** la obtiene del `package.json` de ese mismo paquete y no de un literal duplicado

### CR4 — ayuda descubrible
- **Given** el CLI instalado
- **When** ejecuto `changeledger --help`
- **Then** la ayuda enumera `-V, --version` como opción para mostrar la versión

## Plan

- [x] Escribir casos fallidos en `test/cli-bin.test.mjs` e implementar lectura de versión + Commander en `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs` (CR1, CR2, CR3, CR4) — 2026-06-28T11:47:56Z
- [x] Empaquetar e invocar `--version` desde una instalación aislada; verify: `pnpm test` pasa y el resultado coincide con el `package.json` del tarball (support) — 2026-06-28T11:47:57Z

## Log
- **2026-06-28T11:41:15Z** — status: draft → approved
- **2026-06-28T11:46:13Z** — status: approved → in-progress
- **2026-06-28T11:46:13Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-28T11:47:57Z** — Implemented .version() via Commander; reads version from package.json at runtime with createRequire. Tests CR1-CR4 pass, pnpm verify clean.
- **2026-06-28T11:48:13Z** — status: in-progress → in-review
- **2026-06-28T11:50:49Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-28T11:50:50Z** — Review passed after tightening CR1/CR3 assertions to exact newline match.
