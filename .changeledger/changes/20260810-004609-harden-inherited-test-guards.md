---
id: "20260810-004609"
title: Endurecer dos guards de tests que pueden dar falso verde
type: quick
status: in-validation
created: 2026-08-10T00:46:09Z
depends_on: []
branch: quick/20260810-004609
related_to: ["20260808-171107", "20260808-234920"]
owner: rarc88
---

## Request

Dos guards heredados del lote de adopción pueden dar falso verde (remates de
los post-reviews de `20260808-171107` y `20260808-234920`, autorizados por el
humano el 2026-08-10). Uno: el guard del literal CAS `state changed since
load` en `test/cli-bin.test.mjs` escanea tres archivos nombrados con un regex
en forma de comillas — un duplicado reintroducido en un cuarto archivo o como
template literal lo evade; derivar el barrido de todos los `src/**` y `bin/**`
y cubrir backticks. Dos: `applyMigration` tiene un `repoRoot` por defecto solo
correcto para el layout canónico; producción siempre lo pasa explícito y cinco
tests legacy de `test/config-migration.test.mjs` dependen del default, que en
un runner cuyo tmpdir viva dentro de un repo git sondearía la activación de un
repo ajeno — retirar el default (fail fast) y pasar el root explícito en esos
tests. Trabajo test-only más un recorte de API interna sin caller que lo use
implícitamente; sin superficie pública ni verdad persistente.

## Log
- **2026-08-10T00:51:30Z** `[status]` draft → approved
- **2026-08-10T12:42:46Z** `[status]` approved → in-progress
- **2026-08-10T12:42:46Z** `[branch]` set: quick/20260810-004609 (auto)
- **2026-08-10T12:55:19Z** `[note]` Implementación completada: barrido estructural del literal CAS sobre todo src/** y bin/** cubriendo backticks (duplicados plantados en 4º archivo y variante backtick cazados en la demo, luego retirados); default de repoRoot retirado con fail-fast pinneado y los cinco tests legacy con root explícito; único caller de producción ya pasaba repoRoot. Gate 1352/1352.
- **2026-08-10T12:55:19Z** `[status]` in-progress → in-validation
