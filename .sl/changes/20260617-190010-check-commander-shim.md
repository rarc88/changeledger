---
id: "20260617-190010"
title: check action reconstruye args array legacy en vez de usar Commander
type: refactor
status: done
created: 2026-06-17T19:00:10Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
---

## Request

La migración a Commander (`c224fa3`) dejó el comando `check` con dos inconsistencias:

1. El `action` handler reconstruye manualmente un array `args` desde los argumentos
   parseados por Commander, para pasárselo a `check(args)`. Esto es un shim que
   existe porque `check()` acepta `(args: string[])` como API legada. Todos los
   demás comandos usan el helper `action()` y pasan parámetros tipados.

2. El comando `check` no usa el wrapper `action()` — es el único comando que llama
   `process.exit()` directamente, sin manejo de error uniforme.

## Proposal

Hay dos opciones:

**Opción A** — Cambiar firma de `check()` a `(id?, opts?)`. Alínea la API con Commander.
Requiere actualizar todos los callers (tests incluidos). Alto blast radius.

**Opción B** — Mantener la reconstrucción de args, pero envolver el handler con el
helper `action()` que unifica manejo de errores. Conservar `process.exit(check(args))`
ya que `check()` retorna el exit code entero y ese contrato debe preservarse.
`action()` no debe reemplazar `process.exit(check(...))` — debe envolver solo los
errores inesperados, igual que en los demás comandos.

Recomendación: Opción B. Blast radius mínimo, resuelve la inconsistencia estructural.

## Plan

- [x] Leer `action()` wrapper en `bin/sl.mjs` para entender qué excepciones captura — 2026-06-17T20:16:05Z
- [x] Envolver el handler de `check` en `action()` en `bin/sl.mjs` preservando `process.exit(check(args))` para mantener el exit code, verificar con `test/cli.test.mjs` (Opción B) — 2026-06-17T20:16:05Z
- [x] Correr `pnpm test -- test/cli.test.mjs test/check.test.mjs` — 2026-06-17T20:16:05Z

## Log

- **2026-06-17T19:00:10Z** — Detectado en auditoría. `c224fa3` migró a Commander pero dejó `check` como excepción. Deuda técnica MED.
- **2026-06-17T20:04:29Z** — status: draft → approved
- **2026-06-17T20:15:29Z** — status: approved → in-progress
- **2026-06-17T20:15:29Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T20:16:05Z** — status: in-progress → in-review
- **2026-06-17T20:16:19Z** — review → done (delegated subagent, clean context)
- **2026-06-17T20:16:19Z** — graduation skipped: bin-layer shim; no persistent spec truth
