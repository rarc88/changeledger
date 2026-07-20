---
id: "20260703-232754"
title: pnpm test abre pestañas reales del navegador
type: bug
status: done
created: 2026-07-03T23:27:54Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

`pnpm test` abre pestañas reales del navegador en cada corrida. El humano lo
reporta como molesto y quiere que `pnpm verify`/`pnpm test` dejen de disparar
efectos secundarios fuera del proceso de test.

## Investigation

`view()` en `src/commands/view.mjs` llama `openBrowser(url)` incondicionalmente
tras levantar el servidor (línea 57). `test/view.test.mjs` invoca `view(['.',
'0'], root)` in-process (no como subproceso CLI aparte) para probar el servidor
real, por lo que cada corrida de test ejecuta de verdad `spawn('open', [url])`
en macOS. No hay forma de optar por no abrir el navegador al llamar `view()`
directamente.

## Specification

### CR1 — El CLI real sigue abriendo el navegador por defecto
- **Given** una persona ejecutando `changeledger view` desde la terminal
- **When** el servidor arranca correctamente
- **Then** `view()` sigue invocando `openBrowser(url)` como hoy, sin cambiar el
  comportamiento por defecto del comando

### CR2 — Los llamadores pueden optar por no abrir el navegador
- **Given** un llamador de `view(args, cwd, options)` que pasa
  `{ openBrowser: false }`
- **When** el servidor arranca correctamente
- **Then** `view()` no invoca `openBrowser` en absoluto
- **And** el resto del comportamiento (arranque, URL, log, valor de retorno)
  permanece igual

### CR3 — El test suite no abre un navegador real
- **Given** `test/view.test.mjs` ejerciendo el servidor real vía `view(['.',
  '0'], root, { openBrowser: false })`
- **When** se ejecuta `pnpm test` o `pnpm verify`
- **Then** ningún proceso `open`/`xdg-open`/`start` se genera como efecto de la
  corrida de tests

## Plan

- [x] Add an `{ openBrowser }` option (default `true`) to `view()` in `src/commands/view.mjs`, only calling `openBrowser(url)` when truthy, and pass `{ openBrowser: false }` from the real-server assertion in `test/view.test.mjs`; verify: `node --test test/view.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-03T23:30:31Z`
- [x] Run the complete quality gate after implementation; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-03T23:30:31Z`

## Log

- **2026-07-03T23:27:54Z** `[note]` Se autorizó corregir el efecto secundario de abrir
  pestañas reales durante `pnpm test`, manteniendo intacto el comportamiento
  del CLI real para personas usuarias.
- **2026-07-03T23:29:16Z** `[status]` draft → approved
- **2026-07-03T23:29:16Z** `[status]` approved → in-progress
- **2026-07-03T23:29:16Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-03T23:30:14Z** `[note]` Fix: view() acepta { openBrowser: false } y sólo abre el navegador si shouldOpen es true (default true, sin cambios para el CLI real). test/view.test.mjs pasa openBrowser:false en la aserción de servidor real. pnpm verify: 535 tests OK, 158 changes válidos, biome sin warnings.
- **2026-07-03T23:30:14Z** `[status]` in-progress → in-review
- **2026-07-03T23:31:21Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-03T23:32:11Z** `[validation]` in-validation → done (human accepted)
- **2026-07-03T23:33:02Z** `[graduation]` skipped: fix interno de aislar efecto secundario en test, sin cambio de comportamiento documentado en specs
- **2026-07-03T23:33:11Z** `[archive]` archived
