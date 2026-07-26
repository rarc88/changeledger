---
id: "20260726-130728"
title: Endurecer el presupuesto del contexto core
type: feature
status: approved
created: 2026-07-26T13:07:28Z
depends_on: []
related_to: ["20260726-124835"]
owner: raruiz-hiberuscom
release_impact: none
---

## Request

El contexto core es el único texto contractual que se paga en cada sesión y otra
vez tras cada compactación. Su presupuesto vive en `templates/contract/budgets.yml`
y hoy vale target 125 líneas / 7500 bytes y hard 140 líneas / 9000 bytes, mientras
la composición real mide 138 líneas y 8478 bytes: ya está por encima del target y
a dos líneas del límite duro, sin que nada se haya detenido nunca.

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

Con target 175/11000, el texto actual del core (138 líneas, 8478 bytes) queda en
verde incluso con el fallo estricto activado. Por eso este change es independiente
y puede aterrizar antes de cualquier reescritura del texto.

Existe una copia de `assertWithinBudget` en `test/agent-context.test.mjs:19`, que
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
- **Given** un repo ChangeLedger inicializado y `templates/contract/core.md` sin cambios
- **When** se mide `buildContext(undefined, root)` contra `base.core`
- **Then** la medición es 138 líneas y 8478 bytes, ambas por debajo del target 175/11000
- **And** el barrido `225213 CR6` no lanza ni emite ningún aviso con `core exceeds target`

## Plan

- [ ] Elevar la entrada `core` de `templates/contract/budgets.yml` a target 175/11000 y hard 200/12000 sin tocar el resto de entradas ni el texto del contrato; verify: `node --test test/context.test.mjs` (CR1, CR4)
- [ ] Añadir `strict_target: true` a `base.core` en `templates/contract/budgets.yml` y hacer que `assertWithinBudget` de `test/context.test.mjs` afirme el target cuando la entrada lo declara, con el caso rojo-verde de la rama estricta y su límite duro; verify: `node --test test/context.test.mjs` (CR1, CR2)
- [ ] Cubrir la rama no estricta de `assertWithinBudget` (aviso en target, fallo en hard) frente a las entradas sin bandera de `templates/contract/budgets.yml`; verify: `node --test test/context.test.mjs` (CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-26T13:20:00Z** `[note]` Draft creado al separar el mecanismo de presupuesto de la reescritura del texto core (`20260726-124835`): aquí viven las cifras 175/200 y el fallo estricto en target solo para `core`. Tipo `feature` en vez de `refactor` porque el contrato de este repo solo activa `## Specification` para `feature` y `bug`, y los criterios son obligatorios; `release_impact: none` conserva la semántica de release de un refactor.
- **2026-07-26T14:05:49Z** `[status]` draft → approved
