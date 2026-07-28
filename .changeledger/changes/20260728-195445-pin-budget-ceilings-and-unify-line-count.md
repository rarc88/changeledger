---
id: "20260728-195445"
title: "Higiene del mecanismo de presupuestos: techos pinneados y un solo contador"
type: bug
status: in-progress
created: 2026-07-28T19:54:45Z
depends_on: []
related_to: ["20260728-170429", "20260728-194157"]
owner: raruiz-hiberuscom
release_impact: none
---

## Request

El mecanismo de presupuestos de contexto quedó correcto en su unidad —tokens como
coste, líneas como transporte del `head`— pero su propia higiene tiene dos defectos
que lo dejan sin la garantía que aparenta dar:

1. **Un techo se puede subir en silencio.** El gate comprueba que el contenido de
   hoy *cabe*, no que el techo siga valiendo lo que se decidió. Subir el número es
   la forma más fácil de "arreglar" un fallo de presupuesto, y es exactamente la que
   el techo existe para impedir: `AGENTS.md` ya obliga a que *"a ceiling is never a
   goal"* y a parar y preguntar cuando el contenido correcto no cabe.
2. **La regla de contar líneas emitidas tiene dos sedes** que no coinciden. Es la
   clase 19/48 —una regla con más de un dueño— dentro del mecanismo que se acaba de
   construir.

Alcance **reducido** a esos dos. Los otros dos puntos de la lista original los
cerró de paso `#20260728-170429`, verificado en la Investigation.

## Investigation

### Estado verificado el 2026-07-28

`templates/contract/budgets.yml` declara hoy **11 entradas** por **dos dimensiones**
cada una: **22 números**.

| grupo | entradas |
|---|---|
| `base` | `core`, `spec`, `implement`, `review`, `release` |
| `agent` | entrada única compartida por `agent-prompt` y `agent-context` |
| `overlays` | `blocked`, `in-validation`, `done`, `discarded` |
| `blocks` | `core-commits` |

**Defecto 1 — 21 de los 22 números no están pinneados.** El único pinneado por valor
es `base.core.tokens`, en `170429 CR4` (`test/context.test.mjs`), con el comentario
*"Roberto's number, pinned by value"*. Ese mismo criterio recorre todas las entradas,
pero sólo aplica `assertWithinBudget`, que comprueba que la salida de hoy **cabe**.
`194233 CR1` comprueba la **forma** (dos dimensiones, enteras), no el valor.
`budgetEntries()` afirma `entries.length >= 11`, así que **quitar** una entrada falla
con un mensaje genérico y **añadir** una pasa. Consecuencia: subir cualquiera de los
21 números restantes deja el árbol entero en verde, y el mecanismo no distingue
"cabe" de "sigue costando lo que decidimos".

**Defecto 2 — dos sedes de la misma regla.** El contador de líneas emitidas está
implementado dos veces:

| sede | implementación | resultado con `"a\nb"` |
|---|---|---|
| `emittedLines` privada de `src/commands/context.mjs` | cuenta saltos de línea | **1** |
| `emittedLines` exportada por `test/budget-support.mjs` | descarta el último segmento sólo si está vacío | **2** |

Coinciden en todo texto terminado en salto de línea y **sólo** ahí. `render()` en
`src/commands/context.mjs` cierra siempre con un salto, así que hoy no hay
discrepancia observable en producción: la deuda es estructural, no un fallo vivo.
Por eso este change es de higiene y no de comportamiento, y por eso el criterio que
fija la semántica tiene que apoyarse en la entrada **sin** salto final, que es la
única que separa las dos implementaciones.

El comentario de `test/budget-support.mjs` ya declara la semántica correcta —*"a text
without that newline still ends in a real line"*—, así que la sede que sobrevive es
la de `budget-support`; la de `src` es la que se corrige.

`src/commands/context.mjs` es la **única** sede de `src/` que cuenta el tamaño de una
captura. Los demás `split('\n')` del árbol (`src/fix.mjs`, `src/writer.mjs`,
`src/task.mjs`, `src/check.mjs`, `src/metrics.mjs`, `src/change.mjs`,
`src/contract.mjs`, `src/git.mjs`, `src/yaml.mjs`) iteran líneas para parsear, no
miden una captura: **no entran** en el alcance.

### Decisión que este documento toma, para que no se re-decida al implementar

La sede canónica es **`src/commands/context.mjs`**, exportando el contador, y
`test/budget-support.mjs` lo importa y re-exporta. Razones:

- Es donde el contador tiene un consumidor de producción; `test/` no puede ser sede
  de una función que `src/` necesita.
- Ese módulo ya exporta helpers que los tests consumen (`buildContext`,
  `frameSections`), así que no se abre una superficie nueva.
- Un módulo propio para una función de tres líneas es la sobre-ingeniería que
  `AGENTS.md` descarta.

Los sitios que hoy importan `emittedLines` de `test/budget-support.mjs`
—`test/context.test.mjs` entre ellos— **no cambian su import**: la re-exportación
mantiene la superficie de test intacta, y eso acota el diff.

### Lo que `#20260728-170429` ya cerró — no está en este alcance

Comprobado contra el árbol, no heredado del acta:

- El techo del bloque `## Commits` es una entrada nombrada, `blocks.core-commits`.
- La aserción de convergencia con `maxPasses=1` desapareció con el punto fijo
  iterado, retirada con argumento por el implementador de ese change.
- `head ≥ base.core.lines` **sí** está pinneado: `124837 CR7` compara
  `contextBudgets.base.core.lines` con el corte que `bootstrapHeadCut()` **parsea**
  del bloque `REFERENCE` publicado, así que las dos cifras no pueden derivar.

### Relaciones

- `related_to: 20260728-170429` (CH-0): construyó el mecanismo y redujo este
  alcance. Cerrado y archivado, así que no impone orden.
- `related_to: 20260728-194157` (CH-19): comparte superficie de escritura
  (`test/context.test.mjs`) y reclama el residuo de `bootstrapHeadCut()`, que este
  change **no toca**. CH-19 está en `draft` y bloqueado por otra causa, así que no
  es prerequisito; la nota existe para que las dos ediciones no se solapen.

## Specification

### CR1 — Cada techo declarado está pinneado por valor

- **Given** `templates/contract/budgets.yml` con sus 11 entradas y 22 números, y el
  pin de valores en `test/context.test.mjs`
- **When** `base.spec.tokens` pasa de `3450` a `3451`
- **Then** `node --test test/context.test.mjs` falla, y el mensaje del fallo contiene
  `base.spec` y `tokens`
- **And** con `base.spec.tokens` a `3449` falla igual: un techo no se mueve en
  silencio en **ninguna** de las dos direcciones
- **And** el mismo par de mutaciones sobre `blocks.core-commits.lines` (`28` → `29` y
  `28` → `27`) falla nombrando `core-commits` y `lines`

### CR2 — Una entrada que el pin no cubre falla

- **Given** el pin de CR1, que cubre exactamente las 11 entradas de hoy
- **When** se añade a `budgets.yml` la entrada `blocks.core-lifecycle` con
  `{ "tokens": 100, "lines": 10 }`
- **Then** `node --test test/context.test.mjs` falla, y el mensaje contiene
  `core-lifecycle`
- **And** al **quitar** la entrada `overlays.discarded` el fallo nombra `discarded`,
  no sólo un conteo de entradas

### CR3 — El contador de líneas emitidas tiene una sola sede

- **Given** `src/commands/context.mjs`, que exporta el contador canónico, y
  `test/budget-support.mjs`, que lo re-exporta
- **When** se importa el contador desde cada uno de los dos módulos
- **Then** las dos importaciones son **la misma referencia de función**
  (`assert.strictEqual` sobre los dos valores importados, no sobre su resultado)
- **And** el import de `emittedLines` desde `test/budget-support.mjs` que ya usa
  `test/context.test.mjs` sigue resolviendo sin cambiar

### CR4 — La semántica canónica cuenta la última línea sin salto final

- **Given** el contador canónico exportado por `src/commands/context.mjs`
- **When** se le pasa `"a\nb\n"` y después `"a\nb"`
- **Then** devuelve `2` en los dos casos
- **And** devuelve `0` con `""` y `1` con `"\n"`
- **And** la captura del core que emite el CLI publica en su línea `BEGIN` el mismo
  número que devuelve el contador canónico sobre ese mismo texto

## Plan

- [x] Exportar el contador canónico de líneas emitidas desde `src/commands/context.mjs` con la semántica del último segmento y re-exportarlo desde `test/budget-support.mjs` sin tocar los imports existentes; verify: `node --test test/context.test.mjs` (CR3, CR4)
  - **Resolved:** `2026-07-28T20:27:26Z`
- [ ] Pinnear por valor las 11 entradas de `templates/contract/budgets.yml` en una sede única, que falle al mover, añadir o quitar un número nombrando la entrada y la dimensión; verify: `node --test test/context.test.mjs` (CR1, CR2)
- [ ] Correr el gate completo `pnpm verify` tras la implementación (support)

## Log
- **2026-07-28T20:16:52Z** `[status]` draft → approved
- **2026-07-28T20:19:31Z** `[status]` approved → in-progress
- **2026-07-28T20:27:40Z** `[note]` Tarea 1: el contador de líneas emitidas queda con sede única en src/commands/context.mjs, exportado con la semántica de último segmento; test/budget-support.mjs lo re-exporta y ningún import de test cambia. CR3 assertea identidad de función, no igualdad de resultado. Mutante A (revertir la semántica) mata CR4 con 1 !== 2 sobre "a\\nb"; mutante B (copia local en vez de re-export) mata CR3 por identidad; probados por separado y restaurados editando.
- **2026-07-28T20:27:55Z** `[note]` Fricción del flujo, no defecto del change: el delegado paró antes de escribir porque mi instrucción de baseline exigía árbol limpio, y mi propia transición a in-progress deja el documento modificado. El contrato obliga a que la transición viaje dentro del commit de tarea, así que entre 'status in-progress' y el primer commit de tarea el árbol NO puede estar limpio. La cláusula de baseline debe descontar ese delta. Error mío, no del delegado.
