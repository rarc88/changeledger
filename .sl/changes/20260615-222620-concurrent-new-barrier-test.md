---
id: "20260615-222620"
title: Fortalecer el test concurrente de sl new
type: refactor
status: draft
created: 2026-06-15T22:26:20Z
depends_on: ["20260615-214828"]
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

- [ ] Extraer un helper de child process en `test/cli.test.mjs` solo si evita duplicación real
- [ ] Implementar barrera `ready/go` en el test concurrente sin depender de sleeps fijos
- [ ] Verificar que el test sigue comprobando ids únicos, no overwrite y coherencia `created`/`id`
- [ ] Ejecutar `pnpm test -- test/cli.test.mjs` varias veces si es razonable y luego `pnpm check`

## Log
