---
id: "20260726-130728"
title: Endurecer el presupuesto del contexto core
type: feature
status: in-progress
created: 2026-07-26T13:07:28Z
depends_on: []
related_to: ["20260726-124835", "20260726-130727"]
owner: raruiz-hiberuscom
release_impact: none
---

## Request

El contexto core es el único texto contractual que se paga en cada sesión y otra
vez tras cada compactación. Su presupuesto vive en `templates/contract/budgets.yml`
y hoy vale target 125 líneas / 7500 bytes y hard 140 líneas / 9000 bytes, mientras
la composición real ya está por encima del target y cerca del límite duro, sin que
nada se haya detenido nunca. (Medida el 2026-07-26 al redactar: 138 líneas y 8478
bytes, a dos líneas del hard. Ver la actualización de la Investigation para la
medida vigente.)

Se pide subir la entrada `core` a target 175 líneas / 11000 bytes y hard 200
líneas / 12000 bytes, y que **solo para esa entrada** el test de presupuesto falle
al pasar el target en vez de avisar, porque core es la única entrada cuyo coste es
recurrente en cada sesión. El resto de entradas conserva el comportamiento actual:
aviso en target, fallo en hard.

Este change es únicamente el mecanismo: no toca el texto de `templates/contract/core.md`
ni ningún otro fragmento. Debe aterrizar antes de la reescritura del core
(`20260726-124835`), para que esa reescritura tenga una puerta objetiva desde su
primer commit en vez de una promesa.

## Investigation

El presupuesto se aplica en `assertWithinBudget` (`test/context.test.mjs:16-26`),
que hoy trata todas las entradas por igual:

- si `lines > budget.target.lines || bytes > budget.target.bytes`, emite
  `process.emitWarning` con el mensaje `<label> exceeds target (<lines>/<target.lines> lines, <bytes>/<target.bytes> bytes)`;
- después afirma el límite duro con `assert.ok`, con mensajes
  `<label> exceeds <hard.lines> lines: <lines>` y `<label> exceeds <hard.bytes> bytes: <bytes>`.

Un aviso no detiene nada: es exactamente el mecanismo por el que el core pudo
derivar 13 líneas por encima de su target sin que ningún gate lo señalara.

`budgets.yml` se lee con `JSON.parse` (`test/context.test.mjs:12-14`), así que es
un objeto JSON plano: añadir una clave a `base.core` es inerte para las demás
entradas y no exige tocar el formato ni el parser.

La entrada `core` se mide en varios puntos ya existentes: las llamadas con label
`core` de `test/context.test.mjs` (139, 162, 265, 493, 851, 929, 1273) y el barrido
`225213 CR6: every base composition stays within its explicit budget` (1098-1106),
que itera `contextBudgets.base` y compone `buildContext(undefined, root)` para
`core`. El barrido gemelo de overlays (1108-1121) y las medidas de `implement`
(686) y `spec` (1302) son las que deben seguir avisando en target.

Con target 175/11000, el texto actual del core queda en verde incluso con el fallo
estricto activado. Por eso este change es independiente y puede aterrizar antes de
cualquier reescritura del texto.

**Actualización 2026-07-27 — medidas y punteros re-verificados.** Las cifras y las
referencias de línea de arriba se tomaron el 2026-07-26 y envejecieron al aterrizar
`141119`–`141124`, `124833`, `130727` y `124834`. Medido de nuevo hoy, en la misma
convención que usa el test de presupuesto (`output.split('\n').length`):

- **core = 133 líneas y 8133 bytes**, frente a target 125/7500 y hard 140/9000. Es
  decir: sigue por encima del target, y a 7 líneas del límite duro en vez de a 2.
  Con el target propuesto de 175/11000 queda holgadamente en verde, así que la
  conclusión del Request no cambia.
- Cuidado con la convención: el test de presupuesto cuenta un elemento vacío final,
  así que sus 133 son 132 líneas realmente emitidas — el mismo número que
  `20260726-130727` publica en `lines:<N>`. Las cifras de `budgets.yml` están
  expresadas en la convención del test, no en la del consumidor.

Referencias de línea vigentes, todas comprobadas con `grep -n` hoy (ninguna de las
que citaba este documento sobrevivió):

- `assertWithinBudget` en `test/context.test.mjs:19` (el documento decía 16-26).
- Llamadas con label `core`: `235`, `258`, `361` y siguientes (decía 139, 162, 265,
  493, 851, 929, 1273).
- Barrido `225213 CR6: every base composition…` en `1203`; el gemelo de overlays en
  `1213` (decía 1098-1106 y 1108-1121).
- Medida de `implement` en `808` (decía 686); medidas de `spec` en `1407`, `1523` y
  `1543` (decía 1302).
- La copia de `assertWithinBudget` en `test/agent-context.test.mjs:20` (decía 19).

Existe una copia de `assertWithinBudget` en `test/agent-context.test.mjs:20`, que
solo mide cápsulas de agente contra `agent`. Ninguna entrada medida allí declarará
estrictez, luego su comportamiento es idéntico; la duplicación es previa a este
change y se deja fuera de alcance para no ampliar la superficie.

## Proposal

Dos movimientos, ambos dirigidos por datos:

1. La entrada `base.core` de `templates/contract/budgets.yml` pasa a
   `{ "target": { "lines": 175, "bytes": 11000 }, "hard": { "lines": 200, "bytes": 12000 } }`.
   Las cifras de bytes suben de forma coherente con las de líneas: a la densidad
   actual del contrato (~61 bytes por línea), 175 líneas son ~10,7 KB, así que
   11000 es el target coherente y 12000 el techo duro.
2. La misma entrada declara `strict_target: true`, y `assertWithinBudget` lee esa
   bandera: cuando está presente, el exceso de target se afirma con `assert.ok`
   —falla— en lugar de emitirse como aviso; cuando no está, el comportamiento es
   el actual. Los límites duros se afirman igual en ambos casos. Así la política
   vive junto a las cifras que gobierna y es revisable en un solo sitio.

Ninguna otra entrada de `base`, `overlays` ni `agent` declara `strict_target`.

Alternativas descartadas:

- Decidir en el test con `label === 'core'`: funciona, pero esconde la política en
  el código de test, lejos de las cifras que la motivan.
- Hacer que el fallo en target aplique a todas las entradas: convierte el margen
  de cada overlay en un bloqueo sin justificación, cuando solo core se paga en
  cada sesión.
- Extraer `assertWithinBudget` a un helper compartido con
  `test/agent-context.test.mjs`: la duplicación es previa a este change y ninguna
  entrada medida allí declara `strict_target`, luego el comportamiento sería
  idéntico; se deja fuera de alcance.
- Bajar el texto del core para caber en el presupuesto vigente: es el trabajo de
  `20260726-124835`, y sin este mecanismo aterrizaría sin puerta objetiva.

Escenario principal: la reescritura del core añade contenido, la composición pasa
de 175 líneas y la suite falla de inmediato con el exceso de target, en vez de
dejar un aviso que nadie lee. Escenario de no regresión: un overlay o el modo
`spec` pasa su target y sigue avisando sin romper la suite.

## Specification

### CR1 — La entrada core declara los nuevos límites y su estrictez
- **Given** `templates/contract/budgets.yml`
- **When** se lee la entrada `base.core`
- **Then** vale `{ "target": { "lines": 175, "bytes": 11000 }, "hard": { "lines": 200, "bytes": 12000 } }`
- **And** declara además `"strict_target": true`
- **And** ninguna otra entrada de `base`, `overlays` ni `agent` declara `strict_target`

### CR2 — El presupuesto estricto falla al pasar el target
- **Given** `assertWithinBudget` de `test/context.test.mjs` y una salida sintética de 176 líneas y 9000 bytes
- **When** se evalúa con label `core` contra `{ target: { lines: 175, bytes: 11000 }, hard: { lines: 200, bytes: 12000 }, strict_target: true }`
- **Then** lanza `AssertionError` cuyo mensaje contiene `core exceeds target (176/175 lines`
- **And** no emite ningún `process.emitWarning`
- **And** una salida de 201 líneas contra el mismo presupuesto estricto sigue lanzando con `core exceeds 200 lines: 201`

### CR3 — Sin estrictez, el target sigue avisando y no rompe
- **Given** `assertWithinBudget` y una salida sintética de 300 líneas y 12500 bytes
- **When** se evalúa con label `spec` contra `{ target: { lines: 280, bytes: 12000 }, hard: { lines: 310, bytes: 13500 } }`, sin `strict_target`
- **Then** no lanza
- **And** emite un `process.emitWarning` cuyo mensaje contiene `spec exceeds target (300/280 lines, 12500/12000 bytes)`
- **And** una salida de 311 líneas contra ese mismo presupuesto lanza `AssertionError` con `spec exceeds 310 lines: 311`

### CR4 — La composición core vigente queda en verde con el presupuesto estricto
- **Given** un repo ChangeLedger inicializado
- **When** se mide `buildContext(undefined, root)` contra `base.core`
- **Then** su recuento de líneas y de bytes queda **estrictamente por debajo** del
  target 175 / 11000, de modo que activar el fallo estricto no exige tocar
  `templates/contract/core.md` y este change es independiente de su reescritura
- **And** el barrido `225213 CR6` no lanza ni emite ningún aviso con
  `core exceeds target`
- **Nota de forma (2026-07-27, autorizada por el humano):** este criterio **no**
  fija cifras exactas a propósito. Hacerlo lo rompería en cuanto
  `20260726-124835` reescriba `core.md`, que es el change inmediatamente
  siguiente; el pin exacto sería un criterio que otro change de la misma tanda
  invalida. La medida fechada vive en la Investigation como línea base, no como
  aserción.

## Plan

- [x] Elevar la entrada `core` de `templates/contract/budgets.yml` a target 175/11000 y hard 200/12000 sin tocar el resto de entradas ni el texto del contrato; verify: `node --test test/context.test.mjs` (CR1, CR4)
  - **Resolved:** `2026-07-27T13:25:21Z`
- [x] Añadir `strict_target: true` a `base.core` en `templates/contract/budgets.yml` y hacer que `assertWithinBudget` de `test/context.test.mjs` afirme el target cuando la entrada lo declara, con el caso rojo-verde de la rama estricta y su límite duro; verify: `node --test test/context.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-27T13:25:21Z`
- [x] Cubrir la rama no estricta de `assertWithinBudget` (aviso en target, fallo en hard) frente a las entradas sin bandera de `templates/contract/budgets.yml`; verify: `node --test test/context.test.mjs` (CR3)
  - **Resolved:** `2026-07-27T13:25:21Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T13:25:21Z`

## Log

- **2026-07-26T13:20:00Z** `[note]` Draft creado al separar el mecanismo de presupuesto de la reescritura del texto core (`20260726-124835`): aquí viven las cifras 175/200 y el fallo estricto en target solo para `core`. Tipo `feature` en vez de `refactor` porque el contrato de este repo solo activa `## Specification` para `feature` y `bug`, y los criterios son obligatorios; `release_impact: none` conserva la semántica de release de un refactor.
- **2026-07-26T14:05:49Z** `[status]` draft → approved
- **2026-07-27T13:14:02Z** `[note]` Caducidades corregidas antes de implementar, autorizadas por Roberto el 2026-07-27. (1) CR4 CAMBIA DE FORMA con su autorizacion explicita: pineaba '138 lineas y 8478 bytes' y hoy la medida es 133/8133, pero el arreglo no es actualizar el numero — es dejar de fijarlo. 20260726-124835 es el change inmediatamente siguiente y su trabajo es reescribir core.md, asi que un pin exacto seria un criterio que otro change de la misma tanda invalida, la misma clase que ya nos mordio en 141121. CR4 ahora afirma que la medida queda estrictamente por debajo del target 175/11000 y que el barrido no emite aviso; el proposito (probar que este change es independiente de la reescritura) queda intacto y deja de romperse cuando el contrato cambia una linea. La medida fechada vive en la Investigation como linea base. (2) Cifras del Request y de la Investigation actualizadas: 133 lineas y 8133 bytes, sigue sobre el target y a 7 lineas del hard, no a 2.
- **2026-07-27T13:14:02Z** `[note]` SEXTA aparicion de la clase de puntero inexacto, y la primera total: NINGUNA referencia de linea de la Investigation sobrevivio. assertWithinBudget estaba citado en 16-26 y esta en 19; los sitios con label core en 139/162/265/493/851/929/1273 y estan en 235/258/361...; el barrido 225213 CR6 en 1098-1106 y esta en 1203, su gemelo de overlays en 1213; implement en 686 y esta en 808; spec en 1302 y esta en 1407/1523/1543; la copia en agent-context.test.mjs en 19 y esta en 20. Todas re-verificadas con grep -n y reescritas. Son prosa y no criterios, asi que no rompen tests, pero habrian desorientado al implementador. Anotado tambien en la Investigation el aviso de convencion: los 133 del test de presupuesto son 132 lineas realmente emitidas, el mismo numero que 130727 publica en lines:<N>; budgets.yml esta expresado en la convencion del test, no en la del consumidor.
- **2026-07-27T13:14:46Z** `[status]` approved → in-progress
- **2026-07-27T13:25:21Z** `[note]` Verificado por el orquestador, no aceptado por el informe. (1) Alcance del diff: solo budgets.yml y test/context.test.mjs; src/** y test/agent-context.test.mjs intactos. (2) strict_target aparece exactamente UNA vez en budgets.yml, sobre core, y los valores son los que pide CR1. (3) Gate: lint limpio, 802/802, check 18 valid. (4) La afirmacion mas valiosa del informe reproducida en copia aislada: el mutante ciego a bytes (overTarget reducido a 'lines > budget.target.lines') falla ahora 2 tests con 'strict byte-only target overflow did not throw'. Antes de que el implementador anadiera los casos byte-only dejaba la suite ENTERA en verde, con entradas reales que revientan solo por bytes (overlay in-validation, 2022/1700). Encontro y cerro el hueco por su cuenta; es la misma clase que en 124834 tuve que suspender para que se cerrara.
- **2026-07-27T13:25:21Z** `[note]` Unidad de commit: las tareas 1, 2 y 3 van combinadas. La 1 y la 2 modifican LA MISMA LINEA de budgets.yml — las cifras elevadas y strict_target viven en la entrada core, un solo renglon (git diff --stat: 1 insercion, 1 borrado) — asi que son fisicamente inseparables. La 3 anade los casos de la rama no estricta al mismo assertWithinBudget que introduce la 2, y sin la 2 no hay rama que contrastar. La tarea 4 es soporte y no produce artefacto.
