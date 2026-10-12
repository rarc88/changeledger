---
id: "20261012-174925"
title: Recortar los guards de concepto de las entradas 16 a 22
type: refactor
status: in-review
created: 2026-10-12T17:49:25Z
depends_on: []
branch: refactor/20261012-174925
related_to: ["20261007-135159", "20261007-172322", "20261012-174407", "20260730-002730", "20260730-214503", "20260729-143656", "20261002-113320", "20261002-113435", "20261002-152555", "20261002-181346", "20261002-181428"]
owner: rarc88
---

## Request

El PR #8 (merge `0e7a5cc9`) hizo crecer `CONCEPT_GUARDS` en `test/context.test.mjs` de 15 a 22 entradas: las siete nuevas (16 a 22) suman 33 llamadas `assert.*` sintácticas (la entrada 18 las ejecuta en dos bucles, unas 41 en ejecución) frente a las 38 de las 15 anteriores. `AGENTS.md` (notas del proyecto) limita los tests sobre `templates/contract/` a «un pequeño set curado de guards de concepto con patrones tolerantes a la redacción» y rechaza el pin de oraciones literales: «guarda la obligación, nunca su fraseo». Varias de las siete entradas nuevas verifican cláusula a cláusula el párrafo que acaban de añadir al fragmento, que es el coste que la decisión de `20260730-002730` quiso eliminar.

Se pide reducir esas siete entradas a una obligación portadora por patrón tolerante, retirar la que duplica un test de comportamiento, y comprobar por mutación que cada obligación conservada sigue cayendo cuando se borra de su fragmento y sigue en verde cuando se reformula. No cambia prosa del contrato ni comportamiento del producto.

Interfaces externas: ninguna. Superficie enteramente en `test/context.test.mjs`.

## Proposal

**Política vigente.** No existe una spec dedicada al set de guards. La regla vive en tres sitios: las notas de proyecto de `AGENTS.md` (cuatro clases de test permitidas, entre ellas «un pequeño set curado»), el párrafo de `contract-discovery` que describe los tres niveles de protección regresiva (matriz semántica, guards de obligación por grep «en la sede de su fragmento dueño», presupuestos) y el change `20260730-002730` (decisión de Roberto, 2026-07-29), cuya Proposal fijó «una docena curada» y la doble evidencia por entrada (el mutante que borra la obligación pone el guard en rojo, la reformulación que la conserva lo deja en verde). `20260730-214503` retiró después la mitad compuesta de la doble evidencia en las tablas de obligaciones: cada guard asserta el fragmento dueño y el transporte al pack lo garantiza el test estructural de composición (`234939 structural remnant: pack composition and owned headings`). `20260729-143656` retiró los pins de hash. Ni `AGENTS.md` ni `contract-discovery` fijan un número de entradas; «una docena» es una cifra de la Proposal de `002730`, no un criterio normativo.

**Medición (baseline `0e7a5cc9`, `pnpm test`: 1941 pass, 0 fail).** Las entradas 16 a 22 entraron con los changes `20261002-113320` (16), `20261002-113435` (17), `20261002-152555` (18, 19), `20261002-181346` (20) y `20261002-181428` (21, 22). Fuera de `context.test.mjs`, un grep de `contract|templates` sobre el diff de `test/` del PR solo encuentra la ruta de la cápsula en `agent-context.test.mjs` y un comentario sobre `templates/config.yml`; los asserts nuevos de `agent-context` y `agent-prompt` fijan salidas del código (mensajes de error con la lista de roles, la línea `Effective policy:`), el marcador estructural `{{spec_diff_source}}` y la extensión a `graduation-review` de los bucles existentes `do not modify any file` y `do not change Git state` (cinco palabras o menos por frase, bajo el umbral de seis que usó `002730`).

**Criterio de selección.** Una obligación merece guard de concepto si su pérdida silenciosa es de la clase «hallazgo 38» y nada más la detecta: una puerta de autoridad humana, un orden de flujo cuyo incumplimiento no falla ruidosamente o el confinamiento de solo lectura de un delegado. No lo merece si un test de comportamiento ya falla al romperla, si es consejo de redacción que el review del change que toque la prosa ve, o si repite en otra sede una regla que ya tiene dueño.

| Entrada | Obligación | Fragmento dueño | Literalidad | Propuesta |
|---|---|---|---|---|
| 16 | El tipo `documentation` escribe sus reglas de ejecución como CRs propios, cita ruta y símbolo en cada afirmación y deja que decida el humano cada divergencia antes de `in-review`; y `types.<type>.tdd` pisa el `tdd` global | `spec.md` (y `readiness.md` para el override) | Alta: 11 asserts para un solo párrafo, uno por cláusula (perímetro por llamadores, «sin código de aplicación», correcciones dentro del change, fallback a `blocked`) | Conservar 3 patrones ya tolerantes: reglas como CRs propios, cita de ruta y símbolo, puerta humana de divergencias (`human` + `divergen` + `` `in-review` `` en una cláusula). Retirar los otros 8: la definición, el perímetro y las correcciones los ve el review del change que toque el párrafo; el override lo publica la línea `Effective policy:` (`113320 CR4`, `113320 CR5` cubren `tdd=off`) |
| 17 | `graduate --new` siembra desde el `seed_stage` del tipo, y si falta desde Specification y luego Proposal | `close.md` | Media: 2 asserts con ventanas `(?=...)` sobre una oración del recipe | Retirar. Duplica comportamiento: `113435 CR1`, `CR2` y `CR5` en `test/graduate.test.mjs` ejercen la siembra real; medido: ignorar `seed_stage` en `src/commands/graduate.mjs` pone en rojo `CR1` y `CR5` |
| 18 | El delegado `graduation-review` es de solo lectura, contrasta el diff de cada spec con el código y el change, y recomienda aplicar o corregir | `agent-contexts/graduation-review.md` | Alta: 6 asserts sintácticos, ~14 ejecutados: cuatro prohibiciones en bucle, cuatro reglas de spec reenunciadas («verdad actual», «sin cronología», «sin estructura CR», «universales verificados»), hallazgos con evidencia | Conservar 4: solo lectura sobre ficheros, Git y ledger en una ventana de oración; ningún comando de ciclo de vida nombrado (barrido, sin literal); contraste diff-código-change; recomendación apply/correct. Retirar las cuatro reglas de spec (las dueñas son `close.md` y `changeledger check`, que rechaza CRs en specs) y «hallazgos con evidencia» |
| 19 | Un cierre `review_required` que toca specs delega `graduation-review` antes del primer `--into`, y tras corregir hallazgos vuelve a delegar en un revisor fresco | `close.md` | Alta: una ventana de 7 lookaheads que reproduce la oración, más Log y exención de `--skip` | Conservar 2: `review_required` + `` `graduation-review` `` + «antes del primer `--into`» (3 términos); hallazgos, corrección y revisor fresco. Retirar registrar en el Log y la exención de `--skip`: su omisión no deja pasar una spec sin revisar, porque el orden previo a `--into` sigue guardado |
| 20 | Nunca se implementa en la rama de integración ni en la de release; las ramas de change nacen de `integration_branch` del contexto y se integran en ella | `implement.md` | Alta: 4 asserts con 3 a 5 lookaheads cada uno, términos como `change context ... publish` copiados de la oración | Conservar 2: prohibición de implementar en esas ramas (orden libre `never`/`implement`) y ramas de change desde y hacia `integration_branch`. Retirar «la rama de release se reserva para releases» (contrapartida de la prohibición que sí se guarda) y la base de `check --commits` (el propio `check` es el verificador; queda como residuo) |
| 21 | Ante un defecto con `release_types=` publicado, el agente pregunta al humano entre fix normal y tipo de release, y no crea el draft hasta que responda | `spec.md` | Alta: 5 asserts, fixture que fabrica un repo con rama de release y comprueba la línea de política (ya cubierta por `181428 CR7`) | Conservar 2: preguntar al humano entre fix normal y release; sin draft hasta la respuesta. Retirar el fixture, «nunca inferir» (queda implícito en «preguntar»; residuo) y la rama «sin `release_types=` ni preguntar ni proponer» |
| 22 | Con `back_merge_branch` publicado, el resultado integrado se lleva también a esa rama | `implement.md` | Media: 1 assert con 4 lookaheads | Conservar 1 con 2 términos (`` `back_merge_branch` `` + llevar el resultado). Retirar «contexto publica» y el registro en el Log |

**Cambio de sede de la evidencia.** Las entradas 17, 18, 19 y 21 se juzgan hoy sobre una captura compuesta (`buildContext` de un change `done`, `buildAgentContext`, un repo fabricado con `setConfig`): es la mitad compuesta que `20260730-214503` retiró en las tablas por su coste de co-traveller. La propuesta las juzga sobre `contractFragment(<dueño>)` aplanado, como ya hace la entrada 13; el transporte lo cubren `234939 structural remnant` y `152555 CR1` (`base.includes(capsule)`).

**Residuo declarado (trade aceptado por `002730`).** Pasan a descansar solo en review: el perímetro y las correcciones de spec del tipo `documentation`; el override `types.<type>.tdd` en `readiness.md`; las cuatro reglas de spec que repite la cápsula; el registro en el Log y la exención `--skip` del review de graduación; «rama de release reservada» y la base de `check --commits` en `implement.md`; «nunca inferir» y la rama sin `release_types=` en `spec.md`; el registro en el Log del back-merge. Y, como en `002730`, una reformulación que debilita sin borrar sigue en verde.

**Fuera de este change, para decisión humana.** `DELEGATION_OBLIGATIONS` (otra tabla, régimen de `214503`) creció en el PR con cinco filas o extensiones de `20261007-135159` y `20261007-172322`. Sus patrones son tolerantes y de fragmento único; la fila «los ejemplos de cuantificadores universales nombran never y only» fija una lista de palabras, el candidato más cercano a un pin de fraseo. No se incluye aquí: es otra tabla, otro régimen y otra decisión.

**Evidencia de la propuesta (no escrita en el repo).** Probada en una copia aparte con el bloque sustituido: `biome check` limpio, 21 entradas en verde, 16 mutantes de borrado (cada uno cae en su entrada y no en otra) y 13 reformulaciones (todas en verde). La copia está en `fixtures/guards-work` del scratchpad de la sesión, con el diff completo en `fixtures/concept-guards-proposal.diff` y el arnés en `fixtures/mutate.mjs`.

## Specification

### CR1 — El set curado queda en 21 entradas y la 17 desaparece
- **Given** `test/context.test.mjs` tras el change
- **When** se leen las entradas de `CONCEPT_GUARDS`
- **Then** hay 21 con `entry` 1 a 16 y 18 a 22, ninguna con `entry: 17`, la numeración de las demás no cambia y el comentario de cabecera del bloque dice «Twenty-one carrier obligations»

### CR2 — La entrada 17 se retira porque el comportamiento ya está cubierto
- **Given** la entrada 17 retirada y `src/commands/graduate.mjs` con la línea `const declared = config.types?.[change.frontmatter.type]?.seed_stage;` sustituida por `const declared = undefined;`
- **When** corre `node --test --test-name-pattern "113435" test/graduate.test.mjs`
- **Then** `113435 CR1` y `113435 CR5` fallan, y con el fichero restaurado los tres tests `113435` pasan

### CR3 — Las entradas 16 y 18 a 22 juzgan solo el fragmento dueño
- **Given** las entradas 16, 18, 19, 20, 21 y 22 tras el change
- **When** se lee el `verify` de cada una
- **Then** lee `flattened(contractFragment(...))` de `spec.md`, `agent-contexts/graduation-review.md`, `close.md`, `implement.md`, `spec.md` e `implement.md` respectivamente, y ninguno invoca `repo()`, `addChange`, `setConfig`, `buildContext` ni `buildAgentContext`

### CR4 — Cada obligación conservada cae cuando se borra de su fragmento
- **Given** la copia de los fragmentos con una sola obligación borrada cada vez: la regla de CRs propios, la cita de ruta y símbolo, la puerta de divergencias (`spec.md`); la prohibición sobre ficheros, la prohibición sobre Git, la prohibición sobre el ledger, un comando de ciclo de vida nombrado, el contraste con código y change, la recomendación apply/correct (cápsula `graduation-review`); la delegación antes del primer `--into` y el bucle de revisor fresco (`close.md`); la prohibición de implementar en rama de integración o release y las ramas de change desde y hacia `integration_branch`, y el back-merge (`implement.md`); la pregunta entre fix normal y release y el draft retenido hasta la respuesta (`spec.md`)
- **When** corre `node --test --test-name-pattern "concept guard" test/context.test.mjs` con cada mutante, uno por vez
- **Then** falla exactamente la entrada dueña de esa obligación (16, 18, 19, 20, 21 o 22) con el mensaje que nombra lo perdido, y ninguna otra entrada falla; son 16 mutantes

### CR5 — Cada obligación conservada sobrevive a una reformulación
- **Given** la copia de los fragmentos con una sola oración reescrita con otras palabras y la misma obligación, una por cada patrón conservado salvo el barrido negativo de comandos de ciclo de vida (13 reformulaciones, p. ej. «Implementation of approved changes never happens on the integration or release branches»)
- **When** corre `node --test --test-name-pattern "concept guard" test/context.test.mjs`
- **Then** las 21 entradas pasan

### CR6 — Ni prosa ni comportamiento cambian
- **Given** el árbol tras el change comparado con el baseline `0e7a5cc9`
- **When** se ejecuta `git diff --stat 0e7a5cc9 -- templates src bin AGENTS.md` y después `pnpm test` y `pnpm lint`
- **Then** el diff está vacío, `pnpm test` pasa sin fallos (1941 pass en el baseline, menos el test de la entrada 17) y `pnpm lint` termina sin diagnósticos

### CR7 — Las siete entradas pierden aserciones, no cobertura de obligaciones portadoras
- **Given** `test/context.test.mjs` tras el change
- **When** se cuentan las llamadas `assert.match|doesNotMatch|ok|equal|notEqual` en las entradas 16, 18, 19, 20, 21 y 22
- **Then** suman 14 (3, 4, 2, 2, 2 y 1; eran 33 con la 17 incluida)

### CR8 — El residuo queda declarado en el Log
- **Given** el change en `in-progress` al cerrar la implementación
- **When** se lee su Log
- **Then** una nota lista las obligaciones que pasan a descansar solo en review (las de «Residuo declarado») y la reformulación-que-debilita que sigue en verde, para que el review las juzgue

## Plan

- [x] Retirar la entrada 17 y ajustar la cabecera del bloque a 21 entradas
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test --test-name-pattern "113435" test/graduate.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T18:04:31Z`
- [x] Reducir las entradas 16, 18, 19, 20, 21 y 22 a los patrones conservados, juzgando `contractFragment(<dueño>)` aplanado y sin fixtures de repo
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test --test-name-pattern "concept guard" test/context.test.mjs`
  - **Criteria:** CR3, CR7
  - **Resolved:** `2026-10-12T18:04:32Z`
- [x] Ejecutar los 16 mutantes de borrado, uno por vez sobre una copia de `templates/contract/` (borrar la oración o cláusula de la obligación, comprobar que solo cae su entrada) y registrar cada resultado en el Log
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test --test-name-pattern "concept guard" test/context.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-12T18:04:32Z`
- [x] Ejecutar las 13 reformulaciones, una por patrón conservado, y comprobar que las 21 entradas pasan; registrar el resultado
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test --test-name-pattern "concept guard" test/context.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-12T18:04:33Z`
- [x] Comprobar que ni prosa ni comportamiento cambian: diff vacío contra el baseline en `templates`, `src`, `bin` y `AGENTS.md`, y suite y lint en verde
  - **Target:** `test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-12T18:04:33Z`
- [x] Registrar en el Log el residuo que pasa a descansar en review
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-12T18:04:34Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo
  - **Resolved:** `2026-10-12T18:04:34Z`

## Log
- **2026-10-12T17:49:25Z** `[version]` 0.18.0-dev
- **2026-10-12T17:58:17Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T17:58:42Z** `[status]` approved → in-progress
- **2026-10-12T17:58:42Z** `[branch]` set: refactor/20261012-174925 (auto)
- **2026-10-12T18:04:31Z** `[note]` Mutantes de borrado (CR4): 16 de 16 caen solo en su entrada dueña, con el mensaje de la obligación perdida (16a-c, 18a/18a2/18a3 —ficheros, Git y ledger comparten un mensaje—, 18b-d, 19a-b, 20a-b, 21a-b, 22). Reformulaciones (CR5): 13 de 13 dejan las 21 entradas en verde. Mutante de graduate.mjs (CR2): `const declared = undefined;` hace fallar 113435 CR1 y CR5; restaurado, los tres pasan. Todo sobre una copia en el scratchpad; templates/, src/, bin/ y AGENTS.md sin cambios.
- **2026-10-12T18:04:31Z** `[note]` Implementación cerrada: la entrada 17 se retira (duplica 113435 CR1/CR5) y las entradas 16 y 18-22 quedan en 14 asserts (eran 33 con la 17), juzgando solo contractFragment(<dueño>) aplanado; pnpm verify en verde (1940 tests). Pasan a descansar solo en review: el perímetro y las correcciones de spec del tipo documentation; el override types.<type>.tdd en readiness.md (lo publica la línea Effective policy:); las cuatro reglas de spec que repite la cápsula graduation-review (verdad actual, sin cronología, sin estructura CR, universales verificados) y los hallazgos con evidencia; el registro en el Log y la exención --skip del review de graduación; en implement.md, la rama de release reservada para releases, la base de check --commits y el registro en el Log del back-merge; en spec.md, «nunca inferir» y la rama sin release_types= que ni pregunta ni propone. Caveat: una reformulación que debilita una obligación sin borrarla sigue en verde, igual que bajo 20260730-002730. Residuos fuera de alcance: el bucle de CONCEPT_GUARDS sigue construyendo repo() y pack para entradas que ya no los usan; el helper de oración está repetido en las entradas 20-22; DELEGATION_OBLIGATIONS queda para decisión humana.
- **2026-10-12T18:04:39Z** `[status]` in-progress → in-review
