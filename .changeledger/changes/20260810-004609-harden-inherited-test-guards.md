---
id: "20260810-004609"
title: Endurecer dos guards de tests que pueden dar falso verde
type: quick
status: draft
created: 2026-08-10T00:46:09Z
depends_on: []
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
