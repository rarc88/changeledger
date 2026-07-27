---
id: "20260727-194233"
title: Un solo límite por dimensión en los presupuestos de contexto
type: feature
status: done
created: 2026-07-27T19:42:33Z
depends_on: []
reviewed: true
owner: raruiz-hiberuscom
related_to: ["20260726-130728", "20260726-130727", "20260726-124835", "20260726-124837", "20260727-194234"]
---

## Request

`templates/contract/budgets.yml` declara hoy dos números por dimensión y una
bandera que decide cuál de los dos frena:

```json
"core": { "target": { "lines": 175, "bytes": 11000 }, "hard": { "lines": 200, "bytes": 12000 }, "strict_target": true }
```

Con `strict_target: true` el `target` falla y el `hard` también, así que el
segundo número es inalcanzable: precisión falsa. En las entradas sin la bandera
el `target` solo emite un aviso, y un aviso al final de una suite de 802 tests no
detiene a nadie — así es como el core derivó por encima de su propio target sin
que ninguna puerta lo dijera.

Los dos efectos observados, ambos con coste real:

- **Mover los límites cada vez que el contrato crece.** El pack `spec` obligó a
  subir su `hard` a mitad de otro change porque una sola frase de obligación
  reventaba el cap; `budgets.yml` no era superficie declarada de aquel change y
  la edición entró por autorización humana explícita.
- **Agentes que retiran contenido para caber.** Medido en `20260726-124835`: un
  primer intento a 173 líneas contra un target estricto de 175 reflowó la prosa
  a ~90 columnas y **retiró tres reglas normativas**, una de ellas huérfana
  (`never invent missing requirements`, cero dueños en `templates/` y `src/`).
  Un límite tratado como objetivo empuja a vaciar el contrato.

Se pide un solo umbral por dimensión, sin aviso previo ni bandera, y que la
ocupación sea visible en la propia captura para que nadie tenga que ejecutar la
suite para saber cuánto queda.

## Investigation

Verificado en el árbol de esta rama:

- **`budgets.yml` no lo consume `src/` en absoluto.** Sus únicos lectores son
  `test/context.test.mjs` y `test/agent-context.test.mjs`. El cambio no tiene
  superficie de producto salvo la línea BEGIN.
- `assertWithinBudget` en `test/context.test.mjs` mide
  `output.split('\n').length` y `Buffer.byteLength(output)` sobre **el mismo
  string**, y ese string es el retorno de `buildContext`, que incluye los
  delimitadores. Medido llamando a `buildContext`: core da `split-lines=173` y
  `bytes=9809`, la salida termina en `\n`, la línea BEGIN pesa **79 bytes** y la
  END **107**. Los delimitadores cuentan en las dos dimensiones. El texto del
  bootstrap solo lo declara para las líneas y calla sobre los bytes.
- **Dos convenciones de conteo conviven.** El test cuenta 173 líneas porque la
  salida acaba en `\n`; la línea BEGIN publica `lines:172`, que es lo realmente
  emitido y lo que cuenta el `head -200` del bootstrap. Los umbrales están, por
  tanto, expresados en una unidad que no es la que ve un consumidor.
- `assertWithinBudget` **está duplicado** en `test/agent-context.test.mjs`, sin
  conciencia de `strict_target`. Hoy su comportamiento es idéntico porque ninguna
  entrada medida allí declara la bandera; si alguna la declarara, divergirían en
  silencio.
- Medidas actuales, en líneas emitidas y bytes: core 172 / 9809, `spec`
  300 / 13563, `implement` 198 / 9882, `review` 70 / 3419, `release` 38 / 1995.
  Todas por debajo de su `hard` vigente, así que colapsar cada entrada a su
  `hard` no cambia el veredicto de ninguna medición de hoy.
- El `hard` de core en líneas **no es un número elegible**: el bootstrap
  publicado en cada repo consumidor es `changeledger context 2>&1 | head -200` y
  la validez de la captura depende de ver la línea `END`. Si el core pasa de 200
  líneas emitidas, toda captura de todo repo consumidor queda truncada e
  inválida.
- Los tests de política de presupuesto (`sizedOutput`, `captureBudget` y las
  aserciones que barren toda entrada buscando `strict_target`) fijan hoy las
  cuatro combinaciones de target/hard; son superficie de test a reescribir, no a
  ajustar.
- **Bytes y no tokens.** Lo que se paga son tokens, y los bytes son un proxy.
  Medido con `gpt-tokenizer` sobre `core.md`: 9550 B son 2046 tokens (4.67 B por
  token); la misma prosa con las tablas rellenadas por un formateador pasa a
  11594 B y solo 2112 tokens, o sea que los bytes sobreestiman el relleno por un
  factor ~6.6. Mientras el contrato no lleve relleno, los bytes son un proxy fiel
  y gratuito. Contar tokens exigiría un tokenizador de otro proveedor como
  dependencia de desarrollo para estimar el coste en Claude: precisión falsa de
  otra clase, que es justo lo que este change elimina.

## Proposal

**Un umbral por dimensión, y el umbral es el `hard` vigente.** Cada entrada de
`budgets.yml` pasa de cuatro números más una bandera a dos números planos:

```json
"core": { "lines": 200, "bytes": 12000 }
```

No hay recalibración: el número que se conserva es el que ya frenaba, así que
ninguna medida de hoy cambia de veredicto. `target`, `hard` y `strict_target`
desaparecen de todas las entradas — `base`, `agent` y `overlays`.

**La convención pasa a ser líneas emitidas.** El umbral se compara contra lo que
cuenta el `head` del bootstrap y contra lo que publica la línea BEGIN, no contra
`split('\n').length`. Es la unidad del consumidor y elimina la segunda
convención.

**La ocupación se publica en la línea BEGIN.** Su último segmento pasa de
`— lines:172` a `— lines:172/200 — bytes:9809/12000`, así que cualquier agente ve
en cada captura cuánto ha ocupado del límite sin ejecutar nada.

**El punto fijo de los bytes.** La cifra de bytes forma parte del texto cuyo
tamaño describe, así que se resuelve iterando: componer, medir, reformatear la
línea BEGIN y repetir hasta que la cifra publicada coincida con el tamaño real.
Converge porque el ancho del número solo cambia al cruzar una potencia de diez.
Si no converge en un número acotado de pasadas, la composición **falla
ruidosamente** en lugar de publicar una cifra falsa. El conteo de líneas no tiene
este problema: la línea BEGIN es siempre una línea.

**`assertWithinBudget` queda una sola vez**, en un módulo de soporte de test que
`test/agent-context.test.mjs` importa en lugar de mantener su copia.

**El límite es techo, no objetivo.** Queda escrito donde lo lee quien edita el
contrato: el comentario de `assertWithinBudget` y la nota de proyecto de
`AGENTS.md`. Ninguna retirada de normativa vale para caber en un presupuesto sin
un dueño nombrado y verificado por grep de la obligación, no de palabras
parecidas.

### Alternativas descartadas

- **Un solo número global en vez de uno por dimensión.** Descartado: las dos
  dimensiones miden restricciones distintas con dueños distintos — las líneas las
  impone el `head -200` del bootstrap, los bytes son el coste que se paga en cada
  mensaje y tras cada compactación. Y nada acota el ancho de línea en markdown
  (hay líneas de 263 y 313 caracteres en `close.md` y `spec.md`), así que contar
  solo líneas no acota el tamaño.
- **Conservar target-avisa más hard-falla en `spec` para su refactor
  pendiente.** Descartado: la señal de deriva la da mejor la ocupación publicada
  en cada captura que un aviso que nadie ve al final de la suite.
- **Medir tokens en lugar de bytes.** Descartado con los números de la
  Investigation.
- **Recalibrar los umbrales con aire nuevo en este mismo change.** Descartado:
  mezclaría dos decisiones y dejaría sin respuesta si el freno nuevo detiene de
  verdad.

### Fuera de alcance

- Tocar el texto del bootstrap o `BOOTSTRAP_VERSION`, que sigue en 4. La frase
  vigente ("the `BEGIN` line reports the exact `lines:` count of the full
  output, counting the `BEGIN` and `END` lines themselves") sigue siendo cierta
  con el formato nuevo: reporta ese conteo, y además el techo.
- Reordenar o consolidar contenido de cualquier fragmento del contrato para
  ganar margen: lo poseen `20260726-124837` y `20260727-194234`.
- Formatear los `.md` automáticamente: aparcado por decisión humana el
  2026-07-27 hasta que la gramática del Plan deje de anclar `(CRn)` al final de
  la línea física.

## Specification

### CR1 — `budgets.yml` declara un umbral plano por dimensión
- **Given** el fichero `templates/contract/budgets.yml` tras el cambio
- **When** se parsea como JSON y se recorren todas sus entradas de presupuesto
  (`base.core`, `base.spec`, `base.implement`, `base.review`, `base.release`,
  `agent` y las cuatro de `overlays`)
- **Then** cada entrada tiene exactamente las claves `lines` y `bytes`, ambas con
  valor numérico entero
- **And** ninguna entrada contiene las claves `target`, `hard` ni
  `strict_target`
- **And** el umbral de `base.core` es exactamente
  `{ "lines": 200, "bytes": 12000 }`

### CR2 — el umbral se mide en líneas emitidas
- **Given** una salida sintética de exactamente 200 líneas emitidas terminada en
  `\n`, es decir con `split('\n').length === 201`, y menos de 12000 bytes
- **When** se evalúa contra el umbral `{ lines: 200, bytes: 12000 }` con la
  etiqueta `core`
- **Then** la comprobación no lanza
- **And** la misma comprobación sobre una salida de 201 líneas emitidas lanza con
  el mensaje `core exceeds 200 lines: 201`

### CR3 — superar el umbral de bytes lanza
- **Given** una salida sintética de 50 líneas emitidas y exactamente 12001 bytes
- **When** se evalúa contra el umbral `{ lines: 200, bytes: 12000 }` con la
  etiqueta `core`
- **Then** lanza con el mensaje `core exceeds 12000 bytes: 12001`

### CR4 — ninguna ruta de presupuesto emite avisos
- **Given** `process.emitWarning` sustituido por un espía, y una salida sintética
  de 199 líneas emitidas y 11999 bytes
- **When** se evalúa contra el umbral `{ lines: 200, bytes: 12000 }`
- **Then** el espía no registra ninguna llamada
- **And** el fuente del módulo de soporte no contiene la cadena `emitWarning`

### CR5 — la línea BEGIN publica la ocupación de las dos dimensiones
- **Given** el repositorio de este proyecto
- **When** se ejecuta `changeledger context` y se lee la primera línea de su
  salida
- **Then** su último segmento tiene la forma
  `— lines:<emitidas>/200 — bytes:<bytes>/12000`
- **And** `<emitidas>` es igual a `split('\n').length - 1` de la salida completa
- **And** `<bytes>` es igual a `Buffer.byteLength(<salida completa>)`

### CR6 — la cifra de bytes publicada es la real, no una aproximación
- **Given** un fixture de contrato cuyo tamaño total de captura cruza una
  potencia de diez en bytes respecto al árbol actual, de `9xxx` a `1xxxx`
- **When** se compone el contexto core sobre ese fixture
- **Then** la cifra `bytes:` de la línea BEGIN sigue siendo exactamente
  `Buffer.byteLength(<salida completa>)`
- **And** si la composición no alcanza el punto fijo en 4 pasadas, lanza un error
  cuyo mensaje nombra la no convergencia, en vez de publicar una cifra distinta
  del tamaño real

### CR7 — `assertWithinBudget` tiene una sola definición
- **Given** el árbol de test tras el cambio
- **When** se busca la cadena `function assertWithinBudget` bajo `test/`
- **Then** aparece exactamente una vez
- **And** `test/agent-context.test.mjs` la obtiene por `import`

## Plan

- [x] Colapsar cada entrada de `templates/contract/budgets.yml` a `lines`/`bytes` planos con el valor del `hard` vigente y sin `strict_target`, extraer `assertWithinBudget` a un módulo de soporte compartido bajo `test/` que mida líneas emitidas y bytes contra el umbral único sin `emitWarning`, importarlo desde `test/context.test.mjs` y `test/agent-context.test.mjs`, y reescribir los fixtures de política de presupuesto (`sizedOutput`, `captureBudget` y las aserciones de target/hard/strict); verify: `node --test test/context.test.mjs test/agent-context.test.mjs` (CR1, CR2, CR3, CR4, CR7)
  - **Resolved:** `2026-07-27T20:05:35Z`
- [x] Publicar la ocupación `lines:<n>/<límite>` y `bytes:<n>/<límite>` en el último segmento de la línea BEGIN de `src/commands/context.mjs`, resolviendo el punto fijo de los bytes por iteración acotada y fallando ruidosamente si no converge; verify: `node --test test/context.test.mjs test/framing.test.mjs` (CR5, CR6)
  - **Resolved:** `2026-07-27T20:11:53Z`
- [x] Escribir en el comentario de `assertWithinBudget` y en la nota de proyecto de `AGENTS.md` que un límite es techo y no objetivo, y que retirar normativa para caber exige dueño nombrado y verificado por grep de la obligación; verify: `node --test test/cli.test.mjs` (support)
  - **Resolved:** `2026-07-27T20:12:45Z`
- [x] Ejecutar el gate completo del proyecto; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T20:14:04Z`

## Log

- **2026-07-27T19:42:33Z** `[note]` Draft: colapsa target/hard/strict_target a un umbral por dimensión con el valor del hard vigente, pasa la convención a líneas emitidas y publica la ocupación en la línea BEGIN. Decisiones humanas de esta sesión: bytes y no tokens; sin recalibrar umbrales; sin tocar el bootstrap ni `BOOTSTRAP_VERSION`.
- **2026-07-27T19:45:35Z** `[owner]` set: raruiz-hiberuscom
- **2026-07-27T19:46:34Z** `[note]` Primera tarea combina el esquema de `budgets.yml` con su único lector: `src/` no lo consume y el helper de test es quien interpreta el umbral, así que separarlos dejaría una tarea sin target válido en readiness (test/** está fuera de target_patterns a propósito). CR8 retirado: el gate verde ya lo cubre el hook pre-commit y como criterio no era falsable.
- **2026-07-27T19:58:04Z** `[status]` draft → approved
- **2026-07-27T19:59:35Z** `[status]` approved → in-progress
- **2026-07-27T20:05:35Z** `[note]` Tarea 1: umbral plano en budgets.yml (valor del hard vigente), helper unico en test/budget-support.mjs con conveniencia de lineas emitidas y sin emitWarning, importado por context y agent-context. Actualizados dos usos preexistentes que leian budget.hard.lines: el barrido de 130727 CR3 y el CR4 de 130728, cuyo enunciado pasa de 'clears the strict target' a 'clears its threshold' (misma cota, sin banda). Mutantes aislados verificados: sin asercion de bytes cae CR3; emittedLines contando el segmento vacio cae CR2; emitWarning en vez de fallo caen CR2 y CR4.
- **2026-07-27T20:11:53Z** `[note]` Tarea 2: la linea BEGIN publica lines:n/limite y bytes:n/limite via frameSections, que itera al punto fijo (max 4 pasadas) y lanza nombrando la no convergencia. Dos decisiones que el documento no especificaba: (a) src/ ahora SI lee budgets.yml —consecuencia necesaria de publicar el limite, y el documento ya lo anticipaba diciendo que la unica superficie de producto es la linea BEGIN; (b) una captura de change-id NO publica limite, solo su conteo, porque incrusta un documento de tamano arbitrario y reutiliza el modo del overlay: publicarlo daba 'lines:352/310', un techo que no le aplica. Lo cazo el propio CR5 al ejecutarlo. Actualizados cuatro pins preexistentes del formato de la linea BEGIN (124833 CR2 y 213931 CR4/CR5/CR6, mas dos regex de modo puro) y anadido un pin aparte para la forma sin limite. Mutantes aislados: una sola pasada caen CR5 y CR6; publicar limite en change-id cae CR5; no publicar bytes caen CR5 y CR6. Suite completa 814 verde.
- **2026-07-27T20:14:05Z** `[note]` Gate completo verde antes de pedir review: pnpm verify (814 tests, lint, check) y biome sin cambios pendientes. Ocupacion real publicada tras el cambio: core 172/200 lineas y 9834/12000 bytes; implement 198/205 y 9907/10000 (93 bytes de margen); spec 300/310 y 13589/13700 (111 bytes). El guard de commit de 20260726-141124 rechazo un indice que arrastraba el documento de 20260727-194234 por un git add -A: funciono en produccion real.
- **2026-07-27T20:21:35Z** `[status]` in-progress → in-review
- **2026-07-27T20:22:09Z** `[note]` [review mandate] Tamano del mandato: superficie que gobierna — el diff completo de 888a3ae1..HEAD mas todo consumidor de budgets.yml y de la linea BEGIN. Puntos de escrutinio explicitos que se pasan al revisor: (a) src/ pasa a leer budgets.yml, (b) la captura de change-id no publica limite, (c) los cuatro pins preexistentes del formato BEGIN que actualice, (d) el enunciado del CR4 de 130728 reescrito. Modelo: top tier por la sutileza del punto fijo y de la convencion de conteo.
- **2026-07-27T20:30:50Z** `[review]` in-review → in-progress (retry): Aserción vacua superviviente en test/context.test.mjs (cola del test 130728 CR4): filtra warnings que contengan 'core exceeds target' y exige lista vacía, cuando CR4 prohíbe emitWarning en budget-support.mjs y esa cadena ya no existe en ningún fuente del repo. Su comentario afirma comprobar un camino de aviso inexistente. Es exactamente el residuo que la tarea 1 prometía reescribir.
- **2026-07-27T20:32:16Z** `[note]` [review mandate] Segunda ronda, mandato minimo: spot check del diff de la correccion (6 lineas en test/context.test.mjs), sin auditar de nuevo la superficie ya verificada. Correccion sin commitear, como exige el aislamiento.
- **2026-07-27T20:32:23Z** `[status]` in-progress → in-review
- **2026-07-27T20:34:34Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-27T20:49:54Z** `[validation]` in-validation → done (human accepted)
- **2026-07-27T20:52:07Z** `[graduation]` spec: `contract-discovery.md`
