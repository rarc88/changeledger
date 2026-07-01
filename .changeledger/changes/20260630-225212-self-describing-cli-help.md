---
id: "20260630-225212"
title: Hacer autocontenida la ayuda de los comandos CLI
type: feature
status: in-review
created: 2026-06-30T22:52:12Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Hacer que la ayuda de cada comando sea suficiente para descubrir su sintaxis,
valores finitos, restricciones importantes y ejemplos seguros sin tener que
provocar un error, leer el código o ejecutar primero la operación.

El caso inicial es `changeledger context -h`: muestra
`[mode-or-change-id]`, pero no enumera `spec`, `implement`, `review`, `release`,
no explica la ausencia de argumento ni aclara que los overlays de lifecycle se
infieren exclusivamente al pasar un change id.

## Investigation

Commander genera correctamente Usage, Arguments y Options, pero la mayoría de
las declaraciones solo tienen una descripción de una línea. `review` y
`graduate` ya demuestran el patrón deseado con enums y Examples.

La auditoría encontró además:

- `new` no enumera tipos ni explica el slug inglés;
- `view` oculta `.` y el puerto detrás de `[args...]`;
- `status` no muestra estados, actores ni verbos terminales;
- `owner` no explica que `-` limpia el valor;
- `task` no explica que `n` es el índice de la tarea ni cuándo se exige reason;
- `archive` no explicita la relación entre `--graduated` y `--dry-run`;
- `list` no aclara que status/type salen de la configuración.

La referencia larga añadida únicamente al help raíz contiene parte de esta
información, pero duplica el listado de Commander y no vuelve autocontenida la
ayuda del subcomando consultado.

## Proposal

Tratar cada `--help` como contrato público local. Usar descriptions de argumentos,
options y bloques Examples consistentes, manteniendo el resumen raíz corto. Los
enums configurables se describen como configurados y los enums canónicos se
enumeran literalmente.

Para `context`, la ayuda distinguirá:

- sin argumento → core obligatorio del bootstrap;
- `spec|implement|review|release` → pack incremental explícito;
- `<change-id>` → pack inferido desde status + documento seleccionado;
- `blocked|validation|close|discarded` → overlays inferidos, no modos aceptados.

No se añade un camino que salte el bootstrap: los agentes de repos consumidores
siguen descubriendo ChangeLedger mediante `AGENTS.md`, ejecutan primero
`changeledger context` y solo después usan modos o ids.

## Specification

### CR1 — Context help enumera todo el dominio aceptado
- **Given** cualquier repo ChangeLedger
- **When** se ejecuta `changeledger context -h`
- **Then** muestra `spec`, `implement`, `review` y `release` con su propósito
- **And** explica el comportamiento sin argumento y con un change id
- **And** aclara que los overlays de lifecycle se infieren por id y no son modos explícitos

### CR2 — Context help conserva el bootstrap obligatorio
- **Given** la ayuda de `context`
- **When** describe modos e ids
- **Then** declara que son incrementales respecto al core ya leído
- **And** no recomienda ejecutar `context <id>` antes del `context` base exigido por `AGENTS.md`

### CR3 — Los comandos con dominios finitos los publican
- **Given** `new`, `status`, `task`, `owner`, `archive` y `list`
- **When** se consulta su help
- **Then** cada argumento u opción explica valores, origen configurable y restricciones relevantes
- **And** los estados terminales remiten a `discard` o validación humana en lugar de sugerir `status done|discarded`

### CR4 — View deja de aceptar argumentos opacos
- **Given** `changeledger view -h`
- **When** el usuario busca modo local o puerto
- **Then** ve sintaxis y ejemplos explícitos para `view`, `view .` y un puerto
- **And** argumentos desconocidos fallan en vez de ignorarse silenciosamente

### CR5 — La ayuda raíz no compite con los subcomandos
- **Given** `changeledger --help`
- **When** se renderiza la referencia general
- **Then** ofrece un índice conciso sin una segunda tabla manual divergente
- **And** dirige al help autocontenido de cada comando para el detalle

### CR6 — La ayuda queda protegida como interfaz pública
- **Given** cada comando público y sus subcomandos
- **When** se ejecutan tests de help
- **Then** todos salen con código 0, muestran Usage y documentan los valores/ejemplos contractuales que les corresponden

## Plan

- [x] Reestructurar las declaraciones Commander y el help raíz en `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs` (CR1, CR2, CR3, CR4, CR5) — 2026-07-01T22:30:06Z
- [x] Hacer explícita la gramática de `view` en `bin/changeledger.mjs`/`src/commands/view.mjs` y rechazar argumentos desconocidos; verify: `node --test test/cli-bin.test.mjs test/view.test.mjs` (CR4) — 2026-07-01T22:30:06Z
- [x] Añadir en `test/cli-bin.test.mjs` una matriz que cubra las declaraciones de `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6) — 2026-07-01T22:30:06Z
- [x] Alinear `templates/contract/**` y `README.md` con la interfaz de `bin/changeledger.mjs`; verify: `pnpm test` (CR1, CR2, CR3, CR4, CR5, CR6) — 2026-07-01T22:30:10Z

## Log

- **2026-06-30T22:52:12Z** — Draft creado tras auditar el help real de todos los comandos; `review` y `graduate` se conservaron como referencia positiva.
- **2026-07-01T21:51:36Z** — status: draft → approved
- **2026-07-01T22:24:48Z** — status: approved → in-progress
- **2026-07-01T22:24:48Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T22:30:17Z** — README.md and templates/contract/** already matched the new CLI syntax (view/context/status/task/owner/list); no edits needed, verified by full pnpm test pass.
- **2026-07-01T22:30:28Z** — status: in-progress → in-review
