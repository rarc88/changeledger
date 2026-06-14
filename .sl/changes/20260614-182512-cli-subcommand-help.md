---
id: "20260614-182512"
title: Help por subcomando en el CLI
type: feature
status: approved
created: 2026-06-14T18:25:12Z
depends_on: []
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

- [ ] Definir mapa `HELP` por comando en `bin/sl.mjs`, reutilizado por los `Usage:` (CR1, CR2, CR3) — `bin/sl.mjs`
- [ ] Atajo pre-`switch`: `--help`/`-h` + cmd conocido imprime `HELP[cmd]`, exit 0 (CR1, CR2) — `bin/sl.mjs`
- [ ] Conservar `--help`/`-h` global (CR4) — `bin/sl.mjs`
- [ ] Tests de proceso: `sl graduate --help`, `sl task -h`, `sl graduate` (uso/exit) en `test/cli-bin.test.mjs` (CR1, CR2, CR3, CR4)

## Log
- **2026-06-14T18:31:06Z** — status: draft → approved
