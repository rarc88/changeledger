---
id: "20260615-222620"
title: Fortalecer el test concurrente de sl new
type: refactor
status: done
created: 2026-06-15T22:26:20Z
depends_on: [ "20260615-214828" ]
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Hacer que el test de concurrencia de `sl new` fuerce un arranque realmente
simultáneo, no solo dos procesos lanzados con `Promise.all`.

## Proposal

Mantener el test de procesos reales, pero añadir una barrera simple de
sincronización en el fixture temporal. Cada child process espera a que exista un
archivo "go" antes de invocar `newChange()`. El test padre lanza ambos procesos,
espera a que ambos indiquen "ready" y recién entonces libera la barrera.

Esto no cambia comportamiento de producción; reduce falsos negativos del test y
hace más confiable la cobertura de la carrera que ya se corrigió.

Alternativas descartadas:

- Usar solo llamadas síncronas en el mismo proceso: no reproduce contención real
  de filesystem entre procesos.
- Dormir con timeouts fijos: más flaky y menos explícito que una barrera.

## Plan

- [x] Extraer un helper de child process en `test/cli.test.mjs` solo si evita duplicación real — 2026-06-15T22:46:33Z
- [x] Implementar barrera `ready/go` en el test concurrente sin depender de sleeps fijos — 2026-06-15T22:46:33Z
- [x] Verificar que el test sigue comprobando ids únicos, no overwrite y coherencia `created`/`id` — 2026-06-15T22:46:33Z
- [x] Ejecutar `pnpm test -- test/cli.test.mjs` varias veces si es razonable y luego `pnpm check` — 2026-06-15T22:46:33Z

## Log
- **2026-06-15T22:38:30Z** — status: draft → approved
- **2026-06-15T22:45:38Z** — status: approved → in-progress
- **2026-06-15T22:45:38Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:46:36Z** — status: in-progress → in-review
- **2026-06-15T22:47:27Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:51:10Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:24Z** — archived
