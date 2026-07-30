---
id: "20260730-214503"
title: Guards de obligación a evidencia de fragmento y semántica de confirmación
type: feature
status: in-validation
created: 2026-07-30T21:45:03Z
depends_on: []
related_to:
  - "20260722-124655"
  - "20260730-165310"
  - "20260730-183520"
owner: raruiz-hiberuscom
---

## Request

Autorizado por Roberto (2026-07-30) tras su observación «parece que seguimos
con ciclos de review», con el coste medido el mismo día: los 2 retries del
ciclo de `20260722-124655` no tocaron prosa — fueron combinatoria de los guards
de obligación, y en ambos la parte defectuosa fue **la mitad compuesta de la
doble evidencia** (el coattail de `handoff.md` en la captura compuesta, dos
veces, dos sedes). Además, el segundo retry lo forzó un hallazgo **latente**
(no puede morder con la composición actual) en una confirmación de mandato
mínimo. Dos palancas:

1. **Los guards de obligación cargan evidencia de fragmento única.** La mitad
   compuesta se retira de las tablas de obligaciones: su valor real —que el
   fragmento viaje en su pack— ya lo garantiza el test estructural de
   composición, y su coste real es la clase co-traveller entera (cada patrón
   nuevo debe probarse contra todo fragmento que viaje en el mismo pack).
2. **La confirmación falla solo por el defecto nombrado o por regresión.** Una
   confirmación con mandato mínimo que encuentra algo latente o adyacente lo
   reporta como follow-up sin tumbar la ronda; el orquestador lo juzga.
   Aplicada por prompt en la tercera confirmación de ese mismo ciclo: salió
   limpia y costó ~82k.

## Investigation

Hechos verificados hoy contra HEAD (2026-07-30), por ejecución:

- **La composición ya tiene guard estructural propio**: el test
  `234939 structural remnant: pack composition and owned headings`
  (`test/context.test.mjs`) compone las diez capturas (core, modos, overlays
  por status, cápsula de delegado) y asserta qué pack porta qué encabezados y
  que ninguno porta uno ajeno. Si un fragmento cayera de su pack, ese test
  muere — la mitad compuesta de las tablas de obligaciones no es quien lo
  detecta.
- **Las dos tablas afectadas**: `DELEGATION_OBLIGATIONS` (4 filas, modos) y
  `CLASSIFICATION_OBLIGATIONS` (3 filas, fixtures por status), ambas en
  `test/context.test.mjs`, ambas assertando hoy fragmento + captura compuesta
  por patrón. Los 2 retries de `124655` y la ronda de corrección del patrón 4
  de `165310` — tres rondas pagadas hoy — nacieron todas de la mitad compuesta
  o de su combinatoria de direcciones, ninguna de la mitad de fragmento.
- **La clase co-traveller es estructural, no un descuido**: `handoff.md` viaja
  en los packs de implement y review y en el overlay de blocked; cualquier
  obligación futura sobre esos packs paga la prueba contra su prosa. Retirar
  la mitad compuesta la mata para siempre.
- **La semántica de confirmación no está escrita**: `review.md` manda que un
  revisor fresco confirme la corrección, sin decir qué falla una confirmación.
  El mandato acotado (`165310`) acota el alcance de la inspección, no el
  criterio del veredicto. La tercera confirmación de `124655` la aplicó por
  prompt con el resultado citado en el Request.
- Presupuesto de la sede: `base.review` 1000/2500 tras `124655` — una frase
  cabe con holgura.
- Relacionados: `20260722-124655` (el ciclo que midió el coste),
  `20260730-165310` (el mandato y la regla de cuantificadores),
  `20260730-183520` (la cápsula condicional — la confirmación barata que estas
  palancas completan). Cerrados → `related_to`.

## Proposal

**Palanca 1**: las filas de `DELEGATION_OBLIGATIONS` y
`CLASSIFICATION_OBLIGATIONS` assertan solo el fragmento dueño; el assert sobre
la captura compuesta se retira. El comentario de cada tabla nombra al test
estructural de composición como quien garantiza el transporte. La evidencia de
que no queda hueco se ejecuta, no se afirma: un mutante que saca un fragmento
de su pack debe morir por el test estructural.

**Palanca 2**: una frase en `review.md`, junto al párrafo de la corrección
confirmada: la confirmación falla solo si el defecto nombrado no quedó cerrado
o la corrección introdujo una regresión; lo latente o adyacente se reporta como
follow-up y lo juzga el orquestador. Guard de fragmento único — el primer guard
del régimen nuevo, dogfood de la palanca 1.

Alternativas descartadas: (a) mantener la doble evidencia con checks
co-traveller obligatorios por patrón — es exactamente la combinatoria cuyo
coste se midió (3 rondas hoy); (b) la palanca 3 discutida (máximo un guard
grueso por obligación) — más contundente pero pierde granularidad de fallo
nombrado sin necesidad: retirar la mitad compuesta ya elimina la clase cara;
(c) un CR de presupuesto — redundante con `assertWithinBudget`.

Escenarios: (1) una obligación futura sobre el pack de review se guarda con un
patrón sobre `review.md` a secas — sin barrido co-traveller que ejecutar ni
mantener; (2) una confirmación de mandato mínimo encuentra un hueco latente en
otra sede — lo reporta, el orquestador lo encola como follow-up, la ronda pasa
y el defecto nombrado queda confirmado; (3) un refactor saca `handoff.md` del
pack de review — el test estructural muere nombrando la composición, no una
tabla de obligaciones.

## Specification

### CR1 — Los guards de obligación assertan solo el fragmento dueño
- **Given** las tablas `DELEGATION_OBLIGATIONS` y `CLASSIFICATION_OBLIGATIONS`
- **When** sus bucles corren
- **Then** cada patrón se asserta contra el fragmento dueño y contra ninguna
  captura compuesta, y el comentario de cada tabla nombra al test estructural
  de composición (`234939`) como garante del transporte
- **And** un delete-mutante por tabla (una obligación retirada de su fragmento)
  muere nombrando la sede, y un mutante de composición (un fragmento retirado
  de su pack en `MODE_CONTEXT`) muere por el test estructural — ambos
  ejecutados con su rojo literal

### CR2 — La confirmación falla solo por el defecto nombrado o por regresión
- **Given** el pack compuesto por `buildContext('review', root)`
- **When** el orquestador delega la confirmación de una corrección
- **Then** contiene la regla: la confirmación falla solo si el defecto nombrado
  no quedó cerrado o la corrección introdujo una regresión; los hallazgos
  latentes o adyacentes se reportan como follow-ups y los juzga el orquestador
- **And** un guard de fragmento único la fija (el primero del régimen de CR1),
  y los guards existentes del pack de review siguen verdes sin editarse

## Plan

- [x] Retirar la mitad compuesta de las dos tablas, renombrar su evidencia en
  los comentarios y ejecutar los dos mutantes de CR1
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-30T22:02:45Z`
- [x] Escribir la regla de confirmación en review.md con su guard de fragmento
  - **Target:** `templates/contract/review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T22:02:45Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T22:02:46Z`

## Log
- **2026-07-30T21:47:12Z** `[owner]` set: raruiz-hiberuscom
- **2026-07-30T21:50:27Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T21:51:27Z** `[status]` approved → in-progress
- **2026-07-30T22:02:46Z** `[note]` Selección única resuelta. Los tres mutantes de CR1 ejecutados con rojo literal — el de composición (handoff fuera de MODE_CONTEXT.review) murió por el test estructural 234939, no por las tablas, que es la evidencia que la palanca exigía. Paridad de conteo de matches para la frase de CR2: idéntica antes y después en los 13 patrones que leen review.md. El guard de CR2 se rediseñó durante su propio ciclo TDD (la cadena ordenada ingenua murió con un reword legítimo — cazado por el mutante antes de shippear). base.review 1048/2500.
- **2026-07-30T22:03:19Z** `[status]` in-progress → in-review
- **2026-07-30T22:03:19Z** `[note]` Mandato del review, declarado antes de delegar: la superficie que el change gobierna — las dos tablas de test/context.test.mjs y la frase nueva de review.md contra sus 2 CR. Escrutinio: que los comentarios reescritos no afirmen evidencia del régimen viejo como vigente, y la deformación de la regla de confirmación.
- **2026-07-30T22:15:33Z** `[review]` in-review → in-progress (retry): D1: comentario promete co-traveller 'reported as data below' inexistente; D2: 'a confirmation pass fails' colisiona con 'pass' como veredicto en el mismo párrafo — regla de veredicto ambigua; D3: guard con fails? estrecho frente a fail\w* y orden faltante, interactúa con el fix de D2
- **2026-07-30T22:21:54Z** `[status]` in-progress → in-review
- **2026-07-30T22:21:54Z** `[note]` Mandato del review de confirmación, declarado antes de delegar: spot check del diff nombrado — la corrección sin commitear (frase reescrita a vocabulario review/round, guard ensanchado con la orden nueva, comentarios D1 y los 4 menores). Semántica de la confirmación: la de la propia frase corregida — falla solo el defecto nombrado no cerrado o regresión.
- **2026-07-30T22:26:11Z** `[review]` in-review → in-validation (delegated subagent, clean context)
