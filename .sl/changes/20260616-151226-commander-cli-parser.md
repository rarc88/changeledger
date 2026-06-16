---
id: "20260616-151226"
title: Migrar el parser CLI manual a commander
type: refactor
status: done
created: 2026-06-16T15:12:26Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Eliminar la deuda del parser manual de `bin/sl.mjs`. El CLI ya tiene suficientes
subcomandos, flags y combinaciones (`--json`, `--owner`, `--skip`, `--into`,
`--pending`) como para que seguir parseando con arrays y filtros ad hoc aumente
el riesgo de flags ignorados, usage inconsistente y errores difíciles de
mantener.

## Proposal

Migrar `bin/sl.mjs` a `commander` como dependencia runtime.

Razones:

- Es una dependencia madura y enfocada exactamente en CLIs Node.
- Rechaza opciones desconocidas por defecto, cerrando el hueco actual de flags
  silenciosamente ignorados.
- Genera help por comando desde la definición real del comando.
- Permite mantener `src/commands/*` como capa de aplicación testable; el cambio
  debe limitarse al binario y tests de wiring.

Alternativas descartadas:

- Mantener parser propio: conserva bajo el número de dependencias, pero la lógica
  ya está creciendo y duplica problemas resueltos.
- `cac`: más pequeño, pero con menos inercia de mantenimiento/comunidad para una
  herramienta que se publicará globalmente.
- `yargs`: potente, pero más pesado y más opinado de lo necesario para `sl`.

## Plan

- [x] Añadir `commander` a `dependencies` en `package.json` y actualizar `pnpm-lock.yaml` — 2026-06-16T15:38:01Z
- [x] Reescribir `bin/sl.mjs` con `Command`, subcomandos, argumentos y opciones equivalentes — 2026-06-16T15:38:01Z
- [x] Mantener mensajes de salida y exit codes existentes cubiertos por `test/cli-bin.test.mjs` — 2026-06-16T15:38:01Z
- [x] Añadir tests para flags desconocidos y argumentos requeridos en `test/cli-bin.test.mjs` — 2026-06-16T15:38:01Z
- [x] Actualizar `README.md` solo si cambia algún texto de help visible — 2026-06-16T15:38:01Z
- [x] Ejecutar `pnpm verify` y registrar el resultado en `## Log` — 2026-06-16T15:38:01Z

## Log
- **2026-06-16T15:15:16Z** — status: draft → approved
- **2026-06-16T15:35:22Z** — status: approved → in-progress
- **2026-06-16T15:35:22Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T15:38:01Z** — Migrated bin/sl.mjs to commander and added unknown-option coverage; pnpm verify passed.
- **2026-06-16T15:38:02Z** — status: in-progress → in-review
- **2026-06-16T15:40:25Z** — review → in-progress (retry): CLI bin lost executable mode and commander 15 requires Node >=22.12 while the package declares Node >=20.
- **2026-06-16T15:41:57Z** — Addressed review findings: pinned commander to Node 20-compatible v14 and restored executable bin mode; pnpm verify passed.
- **2026-06-16T15:41:57Z** — status: in-progress → in-review
- **2026-06-16T15:43:48Z** — review → done (delegated subagent, clean context)
- **2026-06-16T15:43:49Z** — graduado a spec `architecture.md`
