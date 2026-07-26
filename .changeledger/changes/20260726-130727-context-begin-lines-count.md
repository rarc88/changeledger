---
id: "20260726-130727"
title: Publicar el tamaño exacto del contexto en la línea BEGIN
type: feature
status: draft
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
- Endurecer el CLI frente a `EPIPE`: como el comando documentado en el
  bootstrap canaliza stdout hacia `head`, el proceso puede escribir en un pipe
  ya cerrado; no debe imprimir traza ni reportar fallo en ese caso.

Fuera de alcance explícito:

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
debe reintroducir `--have` ni `rev:` en ningún texto o parámetro.

**EPIPE — hueco real, no hipotético:** no existe manejo de `EPIPE` ni de
`process.stdout.on('error', ...)` en `bin/changeledger.mjs` ni en
`src/commands/context.mjs` (`grep -rn EPIPE src bin` no arroja resultados). El
comando `context` escribe con `output(...)` → `console.log` por defecto
(`src/commands/context.mjs:221-223`). Cuando stdout se canaliza a `head` y
`head` cierra el pipe antes de que el proceso termine de escribir, Node
levanta un error de escritura no capturado en el stream de stdout, que se
propaga como excepción no controlada (traza + salida no-cero) salvo que se
instale un handler. El comando documentado en el bootstrap del change
`20260726-124834` (`changeledger context 2>&1 | head -200`) dispara
exactamente este caso en la práctica, así que el endurecimiento es una `CR`
real, no defensiva de más.

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

Endurecer `bin/changeledger.mjs` para que un `EPIPE` al escribir en stdout
(pipe cerrado por un consumidor como `head`) no se propague como excepción no
controlada: ni traza de pila ni salida no-cero por esa causa.

Alternativas descartadas:

- **Calcular `lines:<N>` con un cálculo de punto fijo (recomponer hasta que
  el conteo se estabilice)**. Descartada: el número de dígitos de `N` no
  añade líneas, así que un único cálculo posterior a la composición del
  cuerpo ya es exacto y estable; el punto fijo sería complejidad sin
  beneficio (verificado con la fixture de cruce 999→1000).

Escenarios cubiertos por la especificación: contexto core (tamaño acotado por
`budgets.yml`), contexto de modo (`spec`, tamaño variable pero acotado),
contexto de change-id (tamaño no acotado por incrustar el documento del
change), cruce del límite de dígitos de `N` (999 → 1000), y endurecimiento
`EPIPE` del propio CLI.

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

### CR5 — El CLI no falla ni imprime traza ante un pipe cerrado (EPIPE)

- **Given** el binario `bin/changeledger.mjs` de este repo
- **When** se ejecuta `node bin/changeledger.mjs context 2>&1 | head -1` en un
  shell (`head` cierra el pipe tras leer la primera línea antes de que el
  proceso termine de escribir)
- **Then** el stream de error combinado del pipeline no contiene la cadena
  `EPIPE`
- **And** el stream de error combinado no contiene ninguna traza de pila de
  Node (sin líneas que empiecen con `    at `)

## Plan

- [ ] En `src/commands/context.mjs`, calcular el número total de líneas de `sections.join('\n\n') + '\n'` (incluida la propia línea `BEGIN`) e inyectarlo como `lines:<N>` en `beginDelimiter` (`src/framing.mjs`) dentro de `composeResult`, para los tres casos (core, modo, change-id); verify: `node --test test/context.test.mjs` (CR1, CR2, CR3)
- [ ] Añadir fixtures en `test/context.test.mjs` que ejerciten el conteo de `lines:<N>` de `src/commands/context.mjs` con changes `draft` cuyo cuerpo produce salidas de exactamente 999 y 1000 líneas totales, para cubrir el cruce del límite de dígitos; verify: `node --test test/context.test.mjs` (CR4)
- [ ] Endurecer `bin/changeledger.mjs` para no propagar `EPIPE` como excepción no controlada al escribir en stdout; crear `test/cli-epipe.test.mjs` que lance el CLI real vía `child_process` en un pipeline con `head -1` y verifique la ausencia de `EPIPE` y de traza en el stderr combinado; verify: `node --test test/cli-epipe.test.mjs` (CR5)
- [ ] Ejecutar la suite completa tras la implementación; verify: `pnpm verify` (support)

## Log

- **2026-07-26T14:00:00Z** `[note]` Change creado a partir del split de
  `20260726-124834`: este documento se queda con la superficie CLI OUTPUT
  (`lines:<N>` en la línea BEGIN para core/modo/change-id, la nota de
  circularidad, el criterio verificable con `head` y el endurecimiento EPIPE),
  sin pérdida de sustancia respecto al documento original. La superficie
  CONTRACT (texto de bootstrap, `BOOTSTRAP_VERSION`) queda en
  `20260726-124834`, que ahora depende de este change.
