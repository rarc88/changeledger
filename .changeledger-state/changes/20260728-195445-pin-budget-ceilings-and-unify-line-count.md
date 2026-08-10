---
id: "20260728-195445"
title: "Higiene del mecanismo de presupuestos: techos pinneados y un solo contador"
type: bug
status: done
created: 2026-07-28T19:54:45Z
depends_on: []
archived: true
reviewed: true
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

- [x] Exportar el contador canónico de líneas emitidas desde `src/commands/context.mjs` con la semántica del último segmento y re-exportarlo desde `test/budget-support.mjs` sin tocar los imports existentes
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-28T20:27:26Z`
- [x] Pinnear por valor las 11 entradas de `templates/contract/budgets.yml` en una sede única, que falle al mover, añadir o quitar un número nombrando la entrada y la dimensión
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-07-28T20:40:20Z`
- [x] Correr el gate completo `pnpm verify` tras la implementación
  - **Support:**
  - **Resolved:** `2026-07-28T20:42:44Z`

## Log
- **2026-07-28T20:16:52Z** `[status]` draft → approved
- **2026-07-28T20:19:31Z** `[status]` approved → in-progress
- **2026-07-28T20:27:40Z** `[note]` Tarea 1: el contador de líneas emitidas queda con sede única en src/commands/context.mjs, exportado con la semántica de último segmento; test/budget-support.mjs lo re-exporta y ningún import de test cambia. CR3 assertea identidad de función, no igualdad de resultado. Mutante A (revertir la semántica) mata CR4 con 1 !== 2 sobre "a\\nb"; mutante B (copia local en vez de re-export) mata CR3 por identidad; probados por separado y restaurados editando.
- **2026-07-28T20:27:55Z** `[note]` Fricción del flujo, no defecto del change: el delegado paró antes de escribir porque mi instrucción de baseline exigía árbol limpio, y mi propia transición a in-progress deja el documento modificado. El contrato obliga a que la transición viaje dentro del commit de tarea, así que entre 'status in-progress' y el primer commit de tarea el árbol NO puede estar limpio. La cláusula de baseline debe descontar ese delta. Error mío, no del delegado.
- **2026-07-28T20:40:35Z** `[note]` Tarea 2: pin de valores en sede única en test/context.test.mjs. declaredCeilings() DERIVA las 11 rutas de budgets.yml parseado; PINNED_CEILINGS es la única enumeración literal de los 22 numeros. CR1 compara valor a valor nombrando ruta y dimension; CR2 compara conjuntos de rutas, asi que caza adicion y eliminacion. Agujero reproducido antes del pin: con base.spec.tokens subido a 3451 la suite daba 81/81 en verde.
- **2026-07-28T20:40:45Z** `[note]` Decision del orquestador con evidencia: retirada la asercion duplicada 'Roberto's number' (base.core.tokens == 4000) de 170429 CR4, porque el pin nuevo cubre ese numero y mantenerla dejaba una regla con dos duenos, el defecto que este change existe para matar. Verificado por mi, no solo por el delegado: con base.core.tokens en 2000 (por debajo del contenido real) 170429 CR4 sigue fallando por su propio proposito, 'a declared ceiling is not met today: core exceeds 2000 tokens: 2571', en el assert.ok(!sweep.thrown) del barrido, no en una comparacion de valor. Con 4001 muere 195445 CR1. Ambos tests siguen vivos por razones propias. Mutantes aislados y restaurados editando; budgets.yml byte-identico a HEAD.
- **2026-07-28T20:40:54Z** `[note]` Punto de escrutinio para el revisor, no defecto: un grupo NUEVO de primer nivel en budgets.yml (p.ej. capsules) no lo ve declaredCeilings(), que solo recorre base, overlays, blocks y agent. Lo caza budgetEntries() con su deepEqual de claves de primer nivel, verificado por el delegado anadiendo capsules temporalmente: falla nombrando 'capsules' y rompe en cascada 194233 CR1, 194233 CR4 y 170429 CR1. El agujero esta cerrado por la suite, aunque no por 195445 CR2 en si. Deliberadamente sin tocar.
- **2026-07-28T20:42:44Z** `[note]` Tarea 3: gate local completo antes de pedir review. 'pnpm verify' EXIT=0 -- biome check 86 ficheros sin fixes aplicados, node --test 923/923, changeledger check 0 errores. Los 4 warnings que quedan son todos de 20260728-194157 (CH-19), preexistentes y ajenos a este change.
- **2026-07-28T20:43:05Z** `[status]` in-progress → in-review
- **2026-07-28T20:43:30Z** `[note]` Commit de handoff: el trabajo se detiene para delegar el review y el unico delta pendiente es document-only (casilla de la tarea 3 de support, notas de Log y el status a in-review). No hay codigo que lo acompanie, asi que no cabe en una clase de tarea; se commitea como handoff para que el revisor reciba baseline..HEAD coherente y ninguna edicion del entregable quede sin rastro.
- **2026-07-28T20:54:49Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T20:55:01Z** `[note]` Review PASS con mandato acotado a la superficie que el change gobierna, no auditoria completa. Ataque de vacuidad corrido contra los cuatro CR: cada uno muere con un mutante aislado, y en tres de los cuatro es el UNICO test del arbol que cae, lo que descarta que pase de rebote. CR3 confirmado como el instrumento correcto: una copia local conductualmente identica solo la caza la identidad de funcion, una asercion por igualdad de resultados no habria podido. Revisor verifico las cuatro cifras que le pase como reclamaciones, incluida la restauracion byte-identica de budgets.yml (mismo blob 4a781574).
- **2026-07-28T20:55:12Z** `[note]` O1, no bloqueante, y es defecto de MI redaccion del documento: la ultima clausula de CR4 (la captura publica en BEGIN el mismo numero que el contador canonico) es redundante. 194233 CR5 ya assertea published.lines === emittedLines(composed) para todos los modos base, y una vez CR3 prueba identidad de referencia esa asercion ES la de CR5. Desincronizar el contador publicado mata nueve tests preexistentes. No es vacua sino redundante, y el implementador la puso porque el documento la pedia. Ironia registrada: un change cuyo Request cita 'una regla con dos sedes' como el defecto anadio un dueno redundante mas de otra regla.
- **2026-07-28T20:55:25Z** `[note]` O2, correccion a mi encuadre, verificada por mi: 'ten ceilings' NO es una decision pendiente entre packs y entradas. En aa5b8e1f~1 budgets.yml tenia exactamente 10 entradas (base x5 + agent + overlays x4) y el propio aa5b8e1f anadio blocks.core-commits dejandolas en 11, asi que el comentario contaba entradas y nacio rancio en su mismo commit. Es falso bajo cualquier lectura. Dejarlo fuera de este change sigue siendo correcto: ninguna de las dos lineas esta en bfc61045..a6f9e711 y CH-19 comparte ese fichero. Follow-up de una linea, no decision humana. O3, menor: el comentario nuevo de src/commands/context.mjs nombra un modulo de test, lo que invierte levemente la direccion de dependencia en prosa; ninguna obligacion depende de ello.
- **2026-07-28T21:04:44Z** `[validation]` in-validation → done (human accepted)
- **2026-07-28T21:27:12Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-28T21:27:33Z** `[archive]` archived
