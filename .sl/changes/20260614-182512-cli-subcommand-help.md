---
id: "20260614-182512"
title: Help por subcomando en el CLI
type: feature
status: done
created: 2026-06-14T18:25:12Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Comandos con varias opciones (`graduate` con `<spec>`/`--skip`/`--pending`,
`task`, `new --owner`, `list`/`show` con flags) no tienen ayuda propia. Hoy solo
existe el `--help`/`-h` global. Queremos `sl <cmd> --help` (y `-h`) que muestre el
uso específico y salga 0.

## Investigation

- `bin/sl.mjs` ya tiene un `USAGE` global y un `switch (cmd)`. Falta un mapa de
  uso por comando y un atajo que lo imprima cuando el primer arg es `--help`/`-h`.
- Los `throw new Error('Usage: …')` de cada caso ya contienen el uso; conviene
  centralizarlos en un mapa `HELP` reutilizado por el error y por `--help`.
- Testeable por proceso: `execFileSync('node', ['bin/sl.mjs', <cmd>, '--help'])`
  (no hay test del bin aún; se añade `test/cli-bin.test.mjs`).

## Proposal

- Mapa `HELP = { graduate: '…', task: '…', new: '…', status: '…', … }` en `bin/sl.mjs`.
- Antes del `switch`, si `args[0]` es `--help`/`-h` y `cmd` está en `HELP`:
  imprime `HELP[cmd]` y termina con código 0.
- Los `Usage:` de cada caso pasan a leer de `HELP[cmd]` (fuente única).
- Sin flag, comportamiento intacto.

Descartado:
- `sl help <cmd>` como forma aparte — `--help`/`-h` es la convención esperada.

## Specification

### CR1 — help de un subcomando
- **Given** el CLI instalado
- **When** corro `sl graduate --help`
- **Then** la salida contiene `--skip` y `--pending`
- **And** el código de salida es 0

### CR2 — alias -h
- **Given** el CLI
- **When** corro `sl task -h`
- **Then** la salida contiene `done|block`
- **And** el código de salida es 0

### CR3 — sin flag no cambia
- **Given** el CLI
- **When** corro `sl graduate` sin args válidos
- **Then** falla (código ≠ 0) con el mismo texto de uso de `graduate`

### CR4 — help global intacto
- **Given** el CLI
- **When** corro `sl --help`
- **Then** lista todos los comandos (comportamiento actual)

## Plan

- [x] Mapa `HELP` por comando en `bin/sl.mjs` + `usage(cmd)` reutilizado por los throws (CR1, CR2, CR3) — 2026-06-14T18:36:00Z
- [x] Atajo pre-`switch` en `bin/sl.mjs`: `--help`/`-h` + cmd conocido imprime `HELP[cmd]`, exit 0 (CR1, CR2) — 2026-06-14T18:36:00Z
- [x] `--help`/`-h` global conservado en `bin/sl.mjs` (CR4) — 2026-06-14T18:36:00Z
- [x] Tests de proceso en `test/cli-bin.test.mjs` (`graduate --help`, `task -h`, `graduate` sin args, `--help` global) (CR1, CR2, CR3, CR4) — 2026-06-14T18:36:00Z

## Log
- **2026-06-14T18:31:06Z** — status: draft → approved
- **2026-06-14T18:34:57Z** — status: approved → in-progress
- **2026-06-14T18:34:57Z** — owner → Roberto Ruiz (auto)
- **2026-06-14T18:36:58Z** — status: in-progress → done
- **2026-06-14T18:36:58Z** — graduation skipped: ayuda CLI; el spec no enumera flags por comando
