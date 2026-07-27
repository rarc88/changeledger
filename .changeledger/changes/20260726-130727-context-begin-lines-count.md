---
id: "20260726-130727"
title: Publicar el tamaño exacto del contexto en la línea BEGIN
type: feature
status: approved
created: 2026-07-26T13:07:27Z
depends_on: ["20260726-124833"]
related_to: ["20260726-124834"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El bloque de bootstrap (change `20260726-124834`, relacionado con este) va a
sustituir su regla negativa actual ("no pipes, filters, summaries, previews or
voluntary output limits") por un comando acotado exacto
(`changeledger context 2>&1 | head -200`) más una condición de validez
positiva. Ese comando fijo con límite `200` solo es determinista para el
contexto **core**: los contextos de modo (`spec`, `implement`, ...) y los
contextos de change-id (que incrustan el documento completo del change) no
tienen un tamaño fijo y pueden superar 200 líneas, o pueden ser más pequeños,
volviendo el límite fijo inútil o insuficiente según el caso.

Se pide publicar en la propia línea `BEGIN` de cualquier contexto (core, modo
o change-id) el conteo exacto de líneas de la salida completa, para que
cualquier consumidor —humano, agente o el propio texto de bootstrap— pueda
construir un `head -<N>` determinista sin importar el tamaño real del
contexto.

Diseño decidido por el humano (no rediseñar, documentar):

- La línea `BEGIN` de cualquier contexto publica `lines:<N>`, el conteo exacto
  de líneas de la salida completa (incluyendo las propias líneas BEGIN y END).

Fuera de alcance explícito:

- Cualquier endurecimiento del CLI frente a `EPIPE`. Formaba parte del diseño
  original y se retiró el 2026-07-27 con autorización humana explícita: el
  supuesto defecto no es reproducible en el runtime soportado (ver
  Investigation). Tocar `bin/changeledger.mjs` para instalar un handler de
  `EPIPE` o de `process.stdout.on('error', ...)` queda fuera de alcance.
- Reescribir el texto de `REFERENCE`/bootstrap en `src/contract.mjs` o subir
  `BOOTSTRAP_VERSION` — lo posee el change `20260726-124834` (relacionado;
  consume el campo `lines:<N>` que este change publica, y depende de que este
  change aterrice primero).
- Eliminar el flag `--have` o cualquier mención a `rev:` — lo posee el change
  `20260726-124833` (dependencia de este). El mecanismo de `lines:<N>` no
  reintroduce ninguno de los dos.

## Investigation

**Tamaños reales medidos** (`node bin/changeledger.mjs context ... | wc -l`):
core = 137 líneas, `spec` = 299, `implement` = 198. Los presupuestos en
`templates/contract/budgets.yml` confirman que solo el contexto **core**
(`hard.lines: 140`) cabe siempre bajo un límite fijo de 200 líneas; `spec`
tiene `hard.lines: 310` y puede superarlo. Esto confirma que un `head -200`
fijo solo sirve para el comando sin argumento (contexto core); los modos y el
contexto de change-id (tamaño no acotado, incrusta el documento del change)
necesitan el campo `lines:<N>` dinámico para que `head -<N>` sea determinista.

**Composición de la línea BEGIN** (`src/commands/context.mjs`):
`beginDelimiter(mode, changeId, rev, extra)` construye
`beginSentinel('CONTEXT', "mode: ${mode}${change} — v${VERSION}${revPart}${extra}")`
(`beginSentinel` en `src/framing.mjs:17-19`). `composeResult` arma el `body`,
calcula `rev = contentRev(body.join('\n\n'))` sobre el cuerpo (nunca sobre las
líneas de framing) y solo entonces construye `sections = [beginDelimiter(...),
...body, END_DELIMITER]` y el texto final
`text = \`${sections.join('\n\n')}\n\`` (`src/commands/context.mjs:137-156`).
Publicar `lines:<N>` exige el mismo orden: componer el cuerpo, calcular el
recuento total de líneas de `sections.join('\n\n') + '\n'` **incluyendo** la
propia línea BEGIN que llevará el número, e inyectarlo recién entonces en
`beginDelimiter`. La circularidad es solo aparente: el número de dígitos de
`N` nunca añade ni quita una línea (solo caracteres dentro de la misma línea
BEGIN), así que el conteo de líneas no cambia al inyectar el valor — no hace
falta un punto fijo iterativo, basta un único cálculo posterior a la
composición del cuerpo. Verificado con una fixture que cruza el límite de 3
dígitos (999 → 1000 líneas totales): el conteo se mantiene exacto en ambos
lados del cruce.

`composeInput` (`src/commands/context.mjs:164-201`) confirma que el contexto
de change-id (`STATUS_CONTEXT`) siempre incrusta `changeText` completo
(`changeText: text` en la línea 195) sin límite de tamaño — de ahí que el
`lines:<N>` dinámico, no un `head -200` fijo, sea el único mecanismo que
funciona también para ese caso.

**Nota de dependencia (change `20260726-124833`):** ese change elimina el flag
`--have` y retira `rev:` de la línea `BEGIN` junto con `contentRev()` de
`src/framing.mjs` (confirmado muerto). La firma actual
`beginDelimiter(mode, changeId, rev, extra)` documentada arriba es la que
existe **antes** de que `20260726-124833` aterrice; la implementación de este
change debe partir de la firma ya sin `rev` que deja ese prerrequisito, y no
debe reintroducir `--have` ni `rev:` en ningún texto o parámetro. Confirmado el
2026-07-27: ese change está `done`, la firma vigente es
`beginDelimiter(mode, changeId)` y `contentRev` ya no existe en
`src/framing.mjs`.

**EPIPE — refutado el 2026-07-27, retirado del alcance.** El párrafo original
de esta Investigation afirmaba que canalizar `context` hacia `head` provoca un
error de escritura no capturado (traza + salida no-cero) salvo que se instale
un handler. Es falso en el runtime soportado. Medido en Node v24.18.0 / macOS,
sin ninguna implementación en el árbol:

- `node bin/changeledger.mjs context 2>&1 | head -1` termina con `pipestatus
  0 0`; el stream combinado contiene solo la línea `BEGIN`, sin la cadena
  `EPIPE` y sin ninguna línea de traza `    at `. Un test escrito contra el
  criterio retirado pasaba en verde **antes** de cualquier fix, así que no era
  falsable.
- La causa es que `console.log` se construye sobre un `Console` con
  `ignoreErrors: true`, que traga los errores de escritura de stdout. Probado
  también por la vía cruda: un bucle de ~20 MB con `process.stdout.write`
  contra un pipe cerrado termina con exit 0 y sin `EPIPE`.
- El disparador concreto que se citaba —`changeledger context 2>&1 | head
  -200`— no puede cerrar el pipe antes de tiempo: el contexto core tiene 133
  líneas, así que `head -200` lee hasta EOF. Publicar `lines:<N>` refuerza esto
  en vez de crear el escenario: el consumidor canónico pasa `head -<N>` con `N`
  exacto y también lee hasta EOF.

Instalar el handler sería código defensivo muerto, contra la regla de fallar
rápido y sin fallbacks silenciosos. No hay defecto que arreglar; el criterio y
su tarea de Plan se retiran.

**Corrección de medidas (2026-07-27).** Las cifras de tamaño citadas arriba se
tomaron el 2026-07-26 y quedaron desfasadas al aterrizar los changes que editan
fragmentos del contrato. Medidas de hoy sobre `buildContext`, como las mide el
test de presupuesto: core 133/140 líneas y 8119/9000 bytes, `spec` 301/310 y
13522/13700, `implement` 199/205 y 9841/10000. La conclusión no cambia: solo el
core cabe bajo un límite fijo de 200 líneas. El margen en bytes es el dato a
vigilar al añadir el segmento `lines:<N>` a la línea `BEGIN`.

**Changes relacionados** (clasificados vía `changeledger search` y lectura
directa, ninguno reutilizable para este alcance):

- `20260726-124833` (*Eliminar el flag --have del contexto*, `refactor`,
  `draft`) — edita el mismo `beginDelimiter`/línea `BEGIN`; es prerrequisito
  de ejecución (`depends_on`) para no pisar su edición y para que `lines:<N>`
  no reintroduzca `--have`/`rev:`.
- `20260726-124834` (*Bootstrap con captura acotada y verificable*, `feature`,
  `draft`) — su nuevo texto de bootstrap referencia el campo `lines:<N>` que
  este change publica; relación informativa (`related_to`); ese change
  depende de este (orden de ejecución: este change aterriza primero).

## Proposal

Publicar `lines:<N>` en `beginDelimiter` desde `composeResult`
(`src/commands/context.mjs`): calcular el número total de líneas de
`sections.join('\n\n') + '\n'` (incluida la propia línea `BEGIN`) e inyectar
ese valor como token `lines:<N>` al construir la línea `BEGIN`, para los tres
casos — core, modo y change-id. El cálculo es un único paso posterior a la
composición del cuerpo, sin iteración de punto fijo, porque el número de
dígitos de `N` nunca cambia el conteo total de líneas (solo caracteres dentro
de la misma línea).

Alternativas descartadas:

- **Calcular `lines:<N>` con un cálculo de punto fijo (recomponer hasta que
  el conteo se estabilice)**. Descartada: el número de dígitos de `N` no
  añade líneas, así que un único cálculo posterior a la composición del
  cuerpo ya es exacto y estable; el punto fijo sería complejidad sin
  beneficio (verificado con la fixture de cruce 999→1000).
- **Endurecer el CLI frente a `EPIPE`**. Retirada el 2026-07-27 con
  autorización humana explícita tras refutar su premisa: el fallo no es
  reproducible y su criterio no podía fallar (ver Investigation).

Escenarios cubiertos por la especificación: contexto core (tamaño acotado por
`budgets.yml`), contexto de modo (`spec`, tamaño variable pero acotado),
contexto de change-id (tamaño no acotado por incrustar el documento del
change) y cruce del límite de dígitos de `N` (999 → 1000).

## Specification

### CR1 — `lines:<N>` exacto en el contexto core, verificable con `head`

- **Given** un repo ChangeLedger inicializado
- **When** se ejecuta `changeledger context` y se lee su primera línea (la
  línea `BEGIN`)
- **Then** la línea `BEGIN` matchea `/lines:(\d+)/` con un valor `N` igual al
  número total de líneas de la salida completa (incluyendo `BEGIN` y `END`)
- **And** ejecutar `changeledger context 2>&1 | head -<N>` produce una salida
  cuya última línea es exactamente
  `===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====`

### CR2 — `lines:<N>` exacto en un contexto de modo (`spec`)

- **Given** el mismo repo
- **When** se ejecuta `changeledger context spec` y se lee su línea `BEGIN`
- **Then** matchea `/lines:(\d+)/` con `N` igual al número total de líneas de
  esa salida completa
- **And** `changeledger context spec 2>&1 | head -<N>` conserva la línea
  `CHANGELEDGER CONTEXT END` como última línea de la salida

### CR3 — `lines:<N>` exacto en un contexto de change-id (tamaño no acotado)

- **Given** un change `draft` cuyo documento embebido tiene un cuerpo largo
  (p. ej. una Investigation extensa) de forma que `changeledger context
  <id>` produce una salida mayor que cualquier presupuesto fijo de
  `budgets.yml`
- **When** se ejecuta `changeledger context <id>` y se lee su línea `BEGIN`
- **Then** matchea `/lines:(\d+)/` con `N` igual al número total de líneas de
  esa salida (incluido el documento embebido)
- **And** `changeledger context <id> 2>&1 | head -<N>` conserva la línea
  `CHANGELEDGER CONTEXT END` como última línea

### CR4 — El conteo de líneas no se rompe al cruzar un límite de dígitos

- **Given** dos changes fixture cuyo contexto de change-id produce salidas de
  exactamente 999 y 1000 líneas totales respectivamente (cruzando el límite
  de 3 a 4 dígitos en `N`)
- **When** se ejecuta `changeledger context <id>` para cada fixture y se lee
  `lines:<N>` en la línea `BEGIN`
- **Then** el valor de `N` reportado es exactamente 999 y 1000 respectivamente
- **And** en ambos casos `head -<N>` conserva la línea `CHANGELEDGER CONTEXT
  END` como última línea

## Plan

- [ ] En `src/commands/context.mjs`, calcular el número total de líneas de `sections.join('\n\n') + '\n'` (incluida la propia línea `BEGIN`) e inyectarlo como `lines:<N>` en `beginDelimiter` (`src/framing.mjs`) dentro de `composeResult`, para los tres casos (core, modo, change-id); verify: `node --test test/context.test.mjs` (CR1, CR2, CR3)
- [ ] Añadir fixtures en `test/context.test.mjs` que ejerciten el conteo de `lines:<N>` de `src/commands/context.mjs` con changes `draft` cuyo cuerpo produce salidas de exactamente 999 y 1000 líneas totales, para cubrir el cruce del límite de dígitos; verify: `node --test test/context.test.mjs` (CR4)
- [ ] Ejecutar la suite completa tras la implementación; verify: `pnpm verify` (support)

## Log

- **2026-07-26T14:00:00Z** `[note]` Change creado a partir del split de
  `20260726-124834`: este documento se queda con la superficie CLI OUTPUT
  (`lines:<N>` en la línea BEGIN para core/modo/change-id, la nota de
  circularidad, el criterio verificable con `head` y el endurecimiento EPIPE),
  sin pérdida de sustancia respecto al documento original. La superficie
  CONTRACT (texto de bootstrap, `BOOTSTRAP_VERSION`) queda en
  `20260726-124834`, que ahora depende de este change.
- **2026-07-26T14:05:48Z** `[status]` draft → approved
- **2026-07-27T10:27:42Z** `[note]` [note] CR5 (endurecimiento EPIPE) y su tarea de Plan retirados con autorizacion humana explicita de Roberto el 2026-07-27. Motivo: el criterio no era falsable — su comando exacto (node bin/changeledger.mjs context 2>&1 | head -1) termina con pipestatus 0 0, sin la cadena EPIPE y sin traza, sin ninguna implementacion en el arbol; console.log usa un Console con ignoreErrors: true. Refutacion completa y medidas en la Investigation. El alcance queda solo lines:<N> (CR1-CR4).
