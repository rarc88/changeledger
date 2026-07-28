---
id: "20260728-212043"
title: Los techos de líneas se derivan del techo de tokens
type: feature
status: draft
created: 2026-07-28T21:20:43Z
depends_on: []
related_to: ["20260728-170429", "20260728-195445", "20260728-164620"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

`20260728-170429` decidió que **tokens son el coste y líneas el transporte del
`head`**, y puso el techo del `core` en 4000 tokens. El alivio nunca llegó: el techo
de **líneas** siguió fijado a mano en 195, así que es él quien bloquea.

Medido el 2026-07-28:

| sujeto | líneas | tokens |
|---|---|---|
| `core` | **193/195** | 2577/4000 |
| bloque `## Commits` | **28/28** | 549/650 |

**2 líneas de margen frente a 1423 tokens que nadie puede gastar.** Toda prosa
normativa nueva negocia contra esas 2 líneas, y quedan 17 changes, la mayoría de
prosa. Roberto lo priorizó explícitamente el 2026-07-28: *"prioriza CH-17 para
desbloquear el presupuesto"*.

Este change hace que el techo de líneas **deje de ser un límite editorial puesto a
mano y pase a ser un bound de transporte derivado** del techo de tokens, la única
dimensión que declara coste.

## Investigation

### El `core` es el único outlier de densidad, y por eso su techo a mano lo estrangula

Medido con el tokenizador pinneado sobre la salida real del CLI:

| pack | líneas hoy | tokens hoy | densidad | techo `lines` derivado | techo `lines` actual |
|---|---|---|---|---|---|
| `core` | 193 | 2577/4000 | **13.4** | **400** | **195** |
| `spec` | 301 | 3110/3450 | 10.3 | 345 | 310 |
| `implement` | 173 | 1776/2000 | 10.3 | 200 | 205 |
| `review` | 73 | 779/900 | 10.7 | 90 | 85 |
| `release` | 38 | 410/500 | 10.8 | 50 | 60 |
| bloque `core-commits` | 28 | 549/650 | 19.6 | 65 | 28 |

El `core` es denso porque es casi todo tablas: 13.4 tokens por línea contra el ~10.3
de los demás. El suelo de 10 que `170429` fijó para derivar es correcto para el resto
y **castiga al core al doble**, porque su techo se puso a mano en 195 en vez de
derivarlo.

Consecuencia cuantificada: a 13.4 tok/línea, los 1423 tokens libres del `core` son
**~106 líneas** de prosa normativa disponible. El margen declarado hoy es **2**.

Derivar no es un cheque en blanco: con líneas en 400 y densidad 13.4, el `core` agota
los **4000 tokens hacia las ~298 líneas**, muy por debajo de 400. Es decir, **tokens
pasa a ser el gate operativo y líneas queda como transporte holgado**, que es el
diseño que `170429` enunció y no llegó a instalar.

### Derivar aprieta dos packs, y ninguno se rompe

`implement` pasa de 205 a 200 y `release` de 60 a 50. Los dos siguen cabiendo con
holgura (173 y 38 líneas hoy). Se registra porque un techo que baja es un cambio real:
si mañana `release` llegara a 51 líneas, este change es la razón de que falle.

### El coste asimétrico está guardado a propósito

Mover el `head` del `core` es caro porque el literal `head -200` vive en el bloque
publicado (`src/contract.mjs`) y en el `AGENTS.md` de este repo, y hay **guarda de
deriva explícita**: `test/contract.test.mjs` rechaza
`text.replace('head -200', 'head -500')` con *"a changed capture bound is drift"*, más
dos aserciones que casan el literal. Actualizar esa guarda es parte del entregable, no
un daño colateral: existe para que nadie mueva el bound sin decirlo, y este change lo
mueve **diciéndolo**.

`BOOTSTRAP_VERSION` se queda en **4** (decisión de Roberto: la v4 no es pública).
Consecuencia conocida y aceptada: con la versión quieta y el contenido cambiando,
`register` calcula estado `replaced` y reescribe el `AGENTS.md` del consumidor sin
avisar — el hallazgo 26. Inocuo mientras no haya consumidor de v4.

### `base.core.lines` y el `head` no pueden divergir

`124837 CR7` afirma `contextBudgets.base.core.lines <= bootstrapHeadCut()`, con el
corte **parseado** del bloque `REFERENCE`. Hoy 195 ≤ 200. Si el techo pasa a 400, el
`head` tiene que pasar a 400 o esa aserción falla.

**Decisión que este change toma**: los dos son **el mismo número**, y la aserción se
estrecha de `<=` a **igualdad**. Razones:

- `170429` ya estableció que *"el `head` es un guard de truncamiento, no una pista de
  tamaño"*, y que la condición positiva de validez es la línea `END`. Una reserva
  implica que el `head` informa del tamaño, que es justo lo que se rechazó.
- Con igualdad no pueden derivar en **ninguna** dirección; con `<=` el `head` puede
  alejarse en silencio.
- Menos números que mantener, que fue el criterio de `170429` al elegir tres.

Descartada la alternativa de dejar el `head` en 450 para conservar 50 líneas de
reserva: un `head` de más no cuesta nada, pero un número que no se deriva de nada es
precisión falsa, y la reserva no protege de nada que el `END` no detecte ya.

### El acoplamiento con el pin de `20260728-195445`

Mover cualquier techo obliga ahora a actualizar `PINNED_CEILINGS` en
`test/context.test.mjs`. Es el mecanismo funcionando como se diseñó —un techo no se
mueve en silencio— y este change es el primero que lo paga, a propósito.

### Los overlays sí caben, medidos con un repo de fixture

Medido el 2026-07-28 con un change por status, comparando contra el **uso real** y no
contra el techo actual —que fue el error de una versión previa de este documento—:

| overlay | líneas hoy | tokens hoy | `lines` derivado | ¿cabe? |
|---|---|---|---|---|
| `blocked` | 45 | 439/500 | 50 | sí |
| `in-validation` | 37 | 392/450 | 45 | sí |
| `done` | 76 | **900/1000** | 100 | sí |
| `discarded` | 15 | 131/200 | 20 | sí |

Los cuatro entran, así que se derivan aquí. Se anota que **`done` está a 900 de 1000
tokens**: cabe, pero es el margen más estrecho del fichero y el primero que va a
morder. No se toca su techo de tokens en este change porque los techos de tokens son
decisiones de coste del humano, no derivaciones.

### La entrada `agent` estaba en 350 contra una decisión de 1000, y no cubría los prompts

Dos defectos, uno dentro del otro.

**El valor está mal.** La decisión registrada es **1000 tokens** para las cápsulas
—`agent-prompt` y `agent-context` juntas—. `20260728-170429` shipeó `agent: 350`, que
nadie decidió. Reafirmado por Roberto el 2026-07-28: *"que agent-prompt y agent-context
tengan 1000 tokens de limite, no lo dejemos justos sino siempre estaremos en esto una y
otra vez"*.

**Y no se aplica donde hace falta.** La entrada la aplica `144327 CR8` en
`test/agent-context.test.mjs` sobre `buildAgentContext`, es decir **sólo** sobre las
cápsulas de contexto. Las cuatro cápsulas de prompt miden **433, 478, 398 y 414
tokens** y `pnpm verify` pasa en verde, porque **ningún test las mide contra un techo**.
Un techo que no puede fallar para la mitad de lo que declara cubrir.

Los dos se arreglan aquí porque son la misma entrada del mismo fichero y el segundo
sin el primero rompería el árbol: aplicar 350 sobre los prompts los reprobaría a los
cuatro. Con 1000 el más grande (478) queda al 48% y ninguna prosa se retira para caber,
que es la condición que `AGENTS.md` exige.

Consecuencia sobre el derivado: `agent` pasa de 35 líneas a **100**, muy por encima de
las 46 de la cápsula más larga. Afloja en las dos dimensiones.

### Relaciones

- `related_to: 20260728-170429`: decidió tokens como unidad y dejó el techo de líneas
  a mano. Archivado, no impone orden.
- `related_to: 20260728-195445`: su pin de valores obliga a declarar cada techo que se
  mueva. Aceptado, graduado a `contract-discovery` y archivado el 2026-07-28.
- `related_to: 20260728-164620`: beneficiario directo — su bloque candidato está a
  28/28 líneas. No es prerequisito en ninguna dirección.

## Proposal

Un principio: **el techo de `lines` es `tokens ÷ 10`, y el `head` del `core` es ese
mismo número.** Ninguno se teclea a mano.

Alcance: **las once entradas**, todas medidas, más el literal del `head`, su guarda de
deriva y el pin de valores. Y una corrección de valor: `agent` sube a los **1000
tokens** que estaban decididos, y su techo pasa a aplicarse también sobre
`agent-prompt`.

| entrada | tokens | `lines` hoy | `lines` derivado |
|---|---|---|---|
| `base.core` | 4000 | 195 | **400** |
| `base.spec` | 3450 | 310 | **345** |
| `base.implement` | 2000 | 205 | **200** |
| `base.review` | 900 | 85 | **90** |
| `base.release` | 500 | 60 | **50** |
| `agent` | **350 → 1000** | 60 | **100** |
| `overlays.blocked` | 500 | 84 | **50** |
| `overlays.in-validation` | 450 | 54 | **45** |
| `overlays.done` | 1000 | 108 | **100** |
| `overlays.discarded` | 200 | 48 | **20** |
| `blocks.core-commits` | 650 | 28 | **65** |

Alternativas descartadas:

- **Subir sólo `base.core.lines` a 400 y dejar el resto a mano.** Resuelve el dolor de
  hoy y deja la clase viva: el siguiente pack estrangulado vuelve a ser una
  negociación. Es el parche que ya se hizo una vez.
- **Retirar la dimensión `lines` de `budgets.yml`.** Rompe la auto-corrección que
  `170429` diseñó: si un pack cae por debajo de 10 tok/línea, es el techo de líneas el
  que avisa de subir el `head` a propósito.
- **Calcular la derivación en tiempo de ejecución** en vez de escribir los valores.
  `budgets.yml` es una tabla ejecutable que los tests cargan directamente; calcularla
  haría que el fichero dejara de decir la verdad por sí mismo.

## Specification

### CR1 — Cada techo de líneas es su techo de tokens entre diez
- **Given** `templates/contract/budgets.yml` con sus once entradas
- **When** se lee cada entrada
- **Then** su `lines` es exactamente `Math.floor(tokens / 10)`, y `base.core.lines` vale `400`
- **And** un test recorre **las once** y falla nombrando la entrada y los dos números cuando la relación no se cumple
- **And** con `base.spec.lines` puesto a `344` en `budgets.yml` ese test falla nombrando `base.spec`

### CR2 — El `head` del bootstrap es el techo de líneas del core, por igualdad
- **Given** el bloque `REFERENCE` de `src/contract.mjs` y el `AGENTS.md` de este repo
- **When** se lee el literal del `head` en los dos sitios
- **Then** los dos dicen `head -400`
- **And** la aserción de `124837 CR7` compara `base.core.lines` con el corte parseado por **igualdad**
- **And** con `base.core.lines` en `399` esa aserción falla, y con el literal en `head -401` también

### CR3 — La guarda de deriva rechaza las dos direcciones
- **Given** la guarda de `test/contract.test.mjs` que hoy rechaza `head -200` → `head -500`
- **When** se muta el literal publicado de `head -400` a `head -500`
- **Then** falla con `a changed capture bound is drift`
- **And** mutarlo a `head -300` falla igual, así que la guarda no admite sólo la dirección que este change usó

### CR4 — El pin de valores refleja los techos nuevos
- **Given** `PINNED_CEILINGS` en `test/context.test.mjs`
- **When** se corre `node --test test/context.test.mjs`
- **Then** pasa, y la entrada de `base.core` declara `lines` igual a `400`
- **And** con `base.core.lines` a `399` en `budgets.yml` el pin falla nombrando `base.core` y `lines`

### CR5 — El gate operativo del core pasa a ser tokens
- **Given** el contexto `core` compuesto y sus dos techos
- **When** se mide su densidad observada en tokens por línea
- **Then** es mayor que `10`, así que el techo de tokens se agota antes que el de líneas
- **And** un test lo afirma comparando la densidad observada contra `10` y falla si el `core` se volviera menos denso, que es la señal de que el `head` hay que subirlo a propósito

### CR6 — La entrada `agent` vale 1000 tokens y acota las dos clases de cápsula
- **Given** `templates/contract/budgets.yml` y las cápsulas que emiten `changeledger agent-prompt <rol>` y `changeledger agent-context <rol> [id]`
- **When** se mide cada una de las cuatro cápsulas de prompt (`investigation`, `implementation`, `review`, `post-review`) contra la entrada `agent`
- **Then** `agent.tokens` vale `1000`, `agent.lines` vale `100`, y las cuatro cápsulas de prompt caben en las dos dimensiones
- **And** con `agent.tokens` bajado a `400` la cápsula `implementation` falla nombrando su rol y `tokens`, porque mide `478`
- **And** las cápsulas de `agent-context` siguen acotadas por la misma entrada, sin un segundo techo que pueda discrepar

## Plan

- [ ] Derivar los once techos de `lines` en `templates/contract/budgets.yml`, subir `agent.tokens` a `1000`, y actualizar `PINNED_CEILINGS` en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR1, CR4)
- [ ] Extender el techo de la entrada `agent` de `templates/contract/budgets.yml` a las cápsulas que emite `src/commands/agent-prompt.mjs`, hoy sin acotar por ningún test; verify: `node --test test/agent-context.test.mjs` (CR6)
- [ ] Mover el literal del `head` a `400` en `src/contract.mjs` y en `AGENTS.md`, y estrechar a igualdad la aserción de reserva de `124837 CR7`; verify: `node --test test/contract.test.mjs` (CR2)
- [ ] Fijar el literal del `head` publicado por `src/contract.mjs` contra la deriva en las dos direcciones, actualizando su guarda; verify: `node --test test/contract.test.mjs` (CR3)
- [ ] Afirmar en `test/context.test.mjs` que la densidad observada del `core` supera 10 tokens por línea, con `templates/contract/budgets.yml` como sujeto del techo; verify: `node --test test/context.test.mjs` (CR5)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-28T21:20:43Z** `[note]` Draft creado por priorización explícita de Roberto para desbloquear el presupuesto. Medido: core 193/195 líneas contra 2577/4000 tokens, así que la dimensión que bloquea es líneas con 2 de margen mientras 1423 tokens quedan inutilizables. El core es el único outlier de densidad (13.4 tok/línea contra ~10.3 del resto) porque es casi todo tablas, y su techo de líneas se fijó a mano en vez de derivarlo. Derivado da 400, que a esa densidad son ~106 líneas de prosa nueva disponibles.
- **2026-07-28T21:20:44Z** `[note]` Alcance reducido a lo medido: cinco entradas base más blocks.core-commits. Los overlays y la entrada agent quedan fuera porque sus techos derivados caen por debajo de sus techos actuales y medirlos exige montar un repo de fixture con un change por status; derivarlos sin medir sería afirmar sin verificar. Verificado además que ningún fragmento del contrato publica hoy un head, así que la mecanización via register/ensureReference también queda fuera.
- **2026-07-28T21:20:45Z** `[note]` Hallazgo nuevo encontrado midiendo, ajeno a este change: la entrada agent la aplica 144327 CR8 sobre buildAgentContext, es decir sobre las cápsulas de contexto, y las cuatro cápsulas de agent-prompt miden 433/478/398/414 tokens contra un techo de 350 sin que nada falle, porque ningún test las mide. Techo que no puede fallar para la mitad de lo que cubría en la tabla del acta. Necesita decisión, no arreglo mecánico.
- **2026-07-28T21:40:50Z** `[note]` Alcance ampliado por instruccion de Roberto (2026-07-28): entra CR6 y las once entradas. Correccion de un error mio de razonamiento: dije que derivar los overlays podia apretar porque compare el derivado contra el TECHO actual en vez de contra el USO real. Medido con repo de fixture, un change por status: blocked 45l/439t, in-validation 37l/392t, done 76l/900t, discarded 15l/131t. Los cuatro caben en su derivado, asi que entran. Se anota que done esta a 900/1000 tokens, el margen mas estrecho del fichero. Y correccion de otro error mio: reporte el techo de agent como decision pendiente cuando la decision de 1000 tokens ya estaba registrada en el acta desde CH-0; 170429 shipeo 350, que nadie decidio. Palabras de Roberto: no lo dejemos justos sino siempre estaremos en esto una y otra vez.
