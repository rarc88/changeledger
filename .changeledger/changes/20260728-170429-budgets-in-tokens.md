---
id: "20260728-170429"
title: Presupuestos de contexto en tokens
type: feature
status: draft
created: 2026-07-28T17:04:29Z
depends_on: []
related_to: ["20260727-194233", "20260726-130728", "20260726-124834", "20260726-124837"]
owner: raruiz-hiberuscom
---

## Request

Los presupuestos de contexto se expresan en **bytes y líneas**, y son un dolor de
cabeza cada vez que se agrega, modifica o quita algo. Roberto, el 2026-07-28:
*"algo que me tiene cansado ya es el tema de presupuestos… vamos a agregar un
tokenizador y ya no por bytes ni líneas. El core que tenga 4000 tokens como
máximo."*

Los bytes son un proxy que sobreestima el whitespace ×6,6 —medido— así que un
cambio que no añade contenido puede reventar el techo, y un techo apretado empuja a
retirar prosa normativa. Y **dos techos de tamaño viven fuera del mecanismo de
presupuestos**, así que ninguna migración de unidad los alcanza.

## Investigation

**El mecanismo de hoy.** `templates/contract/budgets.yml` declara un `lines` y un
`bytes` por entrada, sobre `base` (5 packs), `agent` y `overlays` (4). La línea
BEGIN publica `lines:<N>/<límite> — bytes:<N>/<límite>` con punto fijo iterado,
porque el propio ancho de la cifra cambia el total que reporta.

**Dos techos huérfanos, verificados.** No están en `budgets.yml` —que no los
menciona— sino hardcodeados en `test/context.test.mjs`:

```js
assert.ok(lines <= 195, `core keeps no reserve under the bootstrap cut: ${lines}/195`);
assert.ok(block.length <= 28, `the core \`## Commits\` block is ${block.length} lines, not ≤ 28`);
```

El primero es el techo **operativo** del core: 195, más apretado que los 200 de
`budgets.yml`, así que con 193 líneas hoy el margen real es de **2 líneas**, no 7.
El segundo acota el bloque `## Commits`, hoy a 28/28. Barrido de la clase completa:
sólo esos dos son techos de tamaño; `test/cli-bin.test.mjs:370` (`<= 60`) acota el
help del CLI, no una captura, y `test/context.test.mjs:2117` (`>= 10`) es un suelo
de cobertura. Si la unidad migra a tokens y estos dos se quedan en líneas
hardcodeadas, conviven dos unidades y nada las compara — la clase del hallazgo 29.

**Ocupación real, medida con `gpt-tokenizer` sobre la salida del CLI:** core 2573
tokens / 193 líneas; spec 3118 / 301; implement 1701 / 168; review 711 / 69;
release 418 / 38; los cuatro `agent-prompt` entre 398 y 478; `agent-context
investigation` 198 / 20. Los overlays no se midieron en tokens y el trabajo debe
medirlos antes de fijar su techo.

**Consecuencia que fija el diseño de los techos.** `spec` está a **3118 tokens**, por
encima de los 2500 que Roberto quiere para los modos. Bajarlo es otro change —
consolida `delegation` en el core, porque duplica doctrina que el core ya explica— y
ese trabajo necesita margen de core que este change provee. Declarar 2500 aquí
dejaría el gate rojo hasta entonces: un techo que nada cumple es precisión falsa, la
clase del hallazgo 39 que `20260727-194233` acaba de retirar. **Decisión de Roberto
del 2026-07-28: los techos que declara este change son techos que el contenido de
hoy ya cumple**, y apretarlos a 2000–2500 es un acto deliberado posterior. Su número
es el destino, no la puerta de hoy.

**El tokenizador no es el de Claude.** Claude cuenta tokens por API, que es red e
inservible en un gate determinista. Un BPE local da una cifra determinista y
gratuita, pero es una aproximación: la unidad honesta es "tokens según un
tokenizador de referencia fijado", y eso hay que **escribirlo**, o el número finge
ser lo que el modelo ve. Medido antes: `core.md` 9550 B = 2046 tokens (4,67 B/tok).

**Coste para el repo consumidor.** Si la línea BEGIN publicara `tokens:`, el
tokenizador entraría como dependencia de **runtime** en todo repo que instale
ChangeLedger. La línea BEGIN sigue publicando **líneas** —que es lo que consume el
`head` del bootstrap— y el techo de tokens se aplica en los tests, con el
tokenizador como `devDependency`. Coste cero para el consumidor.

**Fuera de alcance, con sede.** El `head` derivado y su redondeo a múltiplos de 50
son la capa de transporte, y es change propio porque `src/contract.mjs:52` lleva el
literal `head -200` **dentro del bloque bootstrap publicado** y
`test/contract.test.mjs` tiene un test de deriva explícito sobre él. Decisión de
Roberto del 2026-07-28: **`BOOTSTRAP_VERSION` se queda en 4**, porque la v4 no se ha
publicado, así que ese trabajo no arrastra migración de esquema. Con la versión
quieta y el contenido cambiando, `register` calcula estado `replaced` y reescribe el
`AGENTS.md` del consumidor **sin avisar** —hallazgo 26, que sólo avisa al subir
versión—; inocuo aquí porque no existe consumidor de la v4, y se pisa a sabiendas.

Sólo el head del core es caro de mover. Los de modo viven en prosa del contrato
—verificado: `head -` aparece únicamente en `src/contract.mjs:52` y en `AGENTS.md`—
así que cambiarlos no toca el bootstrap ni marca deriva en ningún repositorio. Por
eso el head de modo puede nacer en 350, cubriendo las 301 líneas de `spec`, y bajar
a 250 cuando ese pack se recorte.

También fuera: pinnear los diez techos por valor —hoy sólo `base.core` lo está—,
unificar los dos `emittedLines` y arreglar la aserción de convergencia que con
`maxPasses=1` lanza con cualquier entrada. Higiene del mecanismo, change propio.

## Proposal

`budgets.yml` pasa a declarar **`tokens` y `lines`** por entrada, y `bytes`
desaparece. Los dos hacen trabajos distintos y por eso no reproducen el hallazgo 39:
**tokens es el coste**, la dimensión que de verdad se paga en cada mensaje;
**líneas es el transporte**, lo que el `head` del bootstrap tiene que cubrir.

Los dos techos huérfanos entran en el mismo fichero: el techo operativo de líneas
del core y el del bloque `## Commits`. Después del cambio, **ningún techo de tamaño
vive hardcodeado en un test**.

La línea BEGIN publica sólo `lines:<N>/<límite>`. Sin segmento de bytes ni de
tokens: el consumidor necesita el conteo de líneas y no debe pagar un tokenizador.

Los techos se declaran a partir de la ocupación medida más aire declarado, con el
core en los 4000 tokens que Roberto fijó. Ninguna entrada declara un techo que su
contenido de hoy no cumpla.

`AGENTS.md` gana la cara que le falta a su regla de presupuestos: tener margen no
autoriza a consumirlo. Va en el **mismo párrafo** que la existente —*"A ceiling is
never a goal: never remove normative prose to fit one"*— porque cada una por
separado justifica el abuso contrario: una vacía normativa para encajar, la otra
rellena porque sobra.

Documentar eso topó con el **hallazgo 13**: `readiness.target_patterns` no cubría
`AGENTS.md`, así que ninguna tarea con criterio podía targetearlo —warning en
`draft`, error en `approved`— aunque sea un fichero de producción versionado.
**Roberto añadió `AGENTS.md` y después `hooks/**` directamente, el 2026-07-28**,
cerrando la clase completa en vez de sólo el caso que estorbaba: `hooks/pre-commit`
está versionado y es producción real, corre `lint-staged`, `pnpm test` y `check`.

Lo que queda por hacer aquí no es la configuración, que ya está, sino su **pin de
regresión**: verificado que **ningún test fija los `target_patterns` de este
repositorio** —las referencias en `test/check.test.mjs` usan fixtures sintéticos con
sus propios patrones (`app/**`, `packages/**`, `custom/**`)—, así que hoy retirar
`AGENTS.md` o `hooks/**` no rompe nada y la cobertura se perdería en silencio. Ese
pin es el trabajo falsable de CR7, y por eso el criterio está redactado sobre el
guard y no sobre el estado: enunciarlo como "los patrones incluyen X" describiría
algo que ya es verdad y no podría fallar.

Alternativas descartadas:

- **Publicar `tokens:` en la línea BEGIN.** Mete el tokenizador como dependencia de
  runtime en todo repo consumidor a cambio de un número que el consumidor no usa.
- **Sólo tokens, retirando el techo de líneas.** El `head` del bootstrap necesita un
  bound en líneas; sin él, un pack denso en tokens pero largo en líneas se truncaría
  en silencio.
- **Declarar 2500 para los modos ya.** Deja el gate rojo hasta que `spec` se recorte
  y convierte el techo en objetivo.
- **Contar tokens por API.** Cifra exacta para el modelo, inservible como gate: es
  red, no determinista y no gratuita.

## Specification

### CR1 — El presupuesto se expresa en tokens y líneas, nunca en bytes
- **Given** `templates/contract/budgets.yml`
- **When** se lee el fichero de presupuestos
- **Then** cada entrada declara exactamente las claves `tokens` y `lines`
- **And** ninguna entrada declara `bytes`, y ningún test compara bytes contra un techo

### CR2 — La unidad es un tokenizador de referencia fijado y declarado
- **Given** `package.json` y el fragmento del contrato que describe los presupuestos
- **When** se instala el proyecto y se lee el contrato
- **Then** el tokenizador es una `devDependency` con versión exacta, sin rango `^` ni `~`
- **And** el contrato declara que la unidad es "tokens según un tokenizador de referencia fijado", no los tokens que consume un modelo concreto

### CR3 — Ningún techo de tamaño vive fuera del fichero de presupuestos
- **Given** el árbol tras el cambio
- **When** se busca en `test/**` una comparación de un tamaño contra un número literal
- **Then** no aparece ninguna: el techo operativo de líneas del core y el del bloque `## Commits` se leen de `budgets.yml`
- **And** rebajar cualquiera de esos dos techos en `budgets.yml` hace fallar el gate con un mensaje que nombra la entrada

### CR4 — Los techos declarados los cumple el contenido de hoy
- **Given** `budgets.yml` con los techos nuevos
- **When** se ejecuta `pnpm verify` sobre el árbol sin modificar contenido
- **Then** pasa sin fallos, sin avisos de presupuesto y sin excepciones declaradas
- **And** el techo de `base.core` es exactamente `4000` tokens

### CR5 — La línea BEGIN publica líneas y nada más
- **Given** una captura de cualquier modo con entrada en `budgets.yml`
- **When** se ejecuta `changeledger context [modo]`
- **Then** la línea BEGIN termina en `lines:<N>/<límite>` y no contiene `bytes:` ni `tokens:`
- **And** una captura de change-id sigue publicando `lines:<N>` sin techo, porque incrusta un documento arbitrario

### CR6 — `AGENTS.md` declara que el margen no es permiso de gasto
- **Given** `AGENTS.md` de este repositorio
- **When** se lee el párrafo que gobierna los presupuestos
- **Then** afirma que disponer de margen no autoriza a consumirlo y que cada cosa que entra a un contexto va pensada y optimizada
- **And** conserva en el mismo párrafo la regla de que un techo nunca es objetivo y que no se retira prosa normativa para encajar

### CR7 — La cobertura de las rutas de producción versionadas no puede perderse en silencio
- **Given** la configuración de este repositorio, cuyos `readiness.target_patterns` ya cubren `AGENTS.md` y `hooks/**`
- **When** una tarea con criterio nombra `hooks/pre-commit` o `AGENTS.md` junto a una verificación
- **Then** `changeledger check` no emite ningún warning de target sobre esa tarea
- **And** retirar `AGENTS.md` o `hooks/**` de `readiness.target_patterns` hace fallar el gate nombrando la ruta de producción que queda sin cubrir

## Plan

- [ ] Convertir `templates/contract/budgets.yml` a `tokens`/`lines` con los techos medidos, añadir el tokenizador como `devDependency` de versión exacta en `package.json` y declarar la unidad en el fragmento del contrato que describe los presupuestos; verify: `node --test test/context.test.mjs test/agent-context.test.mjs` (CR1, CR2, CR4)
- [ ] Fijar en `.changeledger/config.yml` que los `readiness.target_patterns` de este repositorio cubren toda ruta de producción versionada, con un pin que falle al retirar `AGENTS.md` o `hooks/**`; verify: `node --test test/check.test.mjs` (CR7)
- [ ] Añadir a `AGENTS.md` la regla de que el margen no es permiso de gasto, en el párrafo que ya prohíbe tratar el techo como objetivo; verify: `node --test test/contract.test.mjs` (CR6)
- [ ] Mover a `templates/contract/budgets.yml` el techo operativo de líneas del core y el del bloque `## Commits`, retirando sus literales de `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR3)
- [ ] Retirar el segmento de bytes de la línea BEGIN en `src/commands/context.mjs` y de sus aserciones; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR5)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-28T17:04:29Z** `[note]` Draft creado. Alcance ampliado por Roberto para absorber los dos techos que viven hardcodeados en test/context.test.mjs y que ninguna migración de unidad alcanzaría; el barrido confirma que la clase son sólo esos dos. Techos declarados = los que el contenido de hoy cumple, decisión de Roberto: spec está a 3118 tokens y bajarlo necesita margen de core que este change provee, así que declarar 2500 dejaría el gate rojo y convertiría el techo en objetivo. La capa de transporte (head derivado, bump de bootstrap) y la higiene del mecanismo (pins, emittedLines, convergencia) salen a changes propios por techo de complejidad.
- **2026-07-28T17:07:08Z** `[note]` Enmendado antes de aprobar por dos warnings de readiness. CR3 llevaba budgets.yml sin ruta y target_patterns exige templates/**; corregido a templates/contract/budgets.yml. CR6 retirado: AGENTS.md no esta en readiness.target_patterns, asi que ninguna tarea con criterio puede targetearlo y el criterio pasaria de warning en draft a error en approved. Es el hallazgo 13 en vivo, el mismo caso que hooks/**, sobre un fichero de produccion versionado. La regla que Roberto pidio para AGENTS.md sale a un change quick, que activa solo Request y Log y por tanto no pasa por readiness.
- **2026-07-28T17:20:29Z** `[note]` Enmendado por tres decisiones de Roberto del 2026-07-28. (1) BOOTSTRAP_VERSION se queda en 4, la v4 no es publica todavia: abarata CH-17, con el aviso de que mantener la version cambiando el contenido del bloque cae en el hallazgo 26 -register calcula estado replaced y reescribe el AGENTS.md del consumidor sin avisar, porque solo avisa al subir version-; inocuo hoy porque no hay consumidor. (2) Roberto anadio AGENTS.md a readiness.target_patterns, asi que CR6 vuelve a este change; se cierra la CLASE anadiendo tambien hooks/**, porque hooks/pre-commit es produccion versionada y ninguna tarea con criterio puede tocarlo -hallazgo 13-. (3) Sobre spec: en tokens no habra fallo, el techo declarado lo cumplen los 3118 de hoy. En lineas mide 301 contra un head de modos de 250, asi que ese head nace en 350. Verificado que solo el head del core es caro de cambiar porque vive en el bloque bootstrap publicado en src/contract.mjs:52; los heads de modo viven en prosa del contrato y se mueven sin coste ni deriva, asi que bajarlo a 250 tras CH-0b es gratis.
- **2026-07-28T17:31:41Z** `[note]` Roberto anadio hooks/** ademas de AGENTS.md, cerrando la clase del hallazgo 13 el mismo. Eso deja CR7 con su Then ya satisfecho, asi que se reformula sobre el guard y no sobre el estado: verificado que ningun test fija los target_patterns de este repositorio -las referencias de test/check.test.mjs usan fixtures sinteticos con app/**, packages/** y custom/**-, luego hoy retirar AGENTS.md o hooks/** no rompe nada y la cobertura se perderia en silencio. El trabajo falsable de CR7 es ese pin de regresion. Corregido tambien el Proposal, que afirmaba que este change anade hooks/** cuando ya estaba anadido: prosa describiendo trabajo hecho, la misma clase del hallazgo 53.
