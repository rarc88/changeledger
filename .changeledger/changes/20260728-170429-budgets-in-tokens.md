---
id: "20260728-170429"
title: Presupuestos de contexto en tokens
type: feature
status: done
created: 2026-07-28T17:04:29Z
depends_on: []
reviewed: true
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
- **Given** `package.json` y el párrafo de presupuestos de `AGENTS.md`, que es donde vive hoy la descripción del mecanismo
- **When** se instala el proyecto y se lee esa convención
- **Then** el tokenizador es una `devDependency` con versión exacta, sin rango `^` ni `~`
- **And** `AGENTS.md` declara que la unidad es "tokens según un tokenizador de referencia fijado", no los tokens que consume un modelo concreto
- **And** ningún fragmento de `templates/contract/` gana esa declaración, porque el techo de tokens lo aplican los tests de este repositorio y no lo hereda ningún consumidor

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

### CR6 — El párrafo de presupuestos de `AGENTS.md` describe el mecanismo vigente y declara que el margen no es permiso de gasto
- **Given** `AGENTS.md` de este repositorio
- **When** se lee el párrafo que gobierna los presupuestos
- **Then** afirma que disponer de margen no autoriza a consumirlo y que cada cosa que entra a un contexto va pensada y optimizada
- **And** conserva en el mismo párrafo la regla de que un techo nunca es objetivo y que no se retira prosa normativa para encajar
- **And** ya no afirma que cada entrada declara un techo de `bytes` ni que toda captura publica la ocupación de ambas dimensiones en la línea `BEGIN`, porque este change retira ambas cosas

### CR7 — La cobertura de las rutas de producción versionadas no puede perderse en silencio
- **Given** la configuración de este repositorio, cuyos `readiness.target_patterns` ya cubren `AGENTS.md` y `hooks/**`
- **When** una tarea con criterio nombra `hooks/pre-commit` o `AGENTS.md` junto a una verificación
- **Then** `changeledger check` no emite ningún warning de target sobre esa tarea
- **And** retirar `AGENTS.md` o `hooks/**` de `readiness.target_patterns` hace fallar el gate nombrando la ruta de producción que queda sin cubrir

## Plan

- [x] Convertir `templates/contract/budgets.yml` a `tokens`/`lines` con los techos medidos, añadir el tokenizador como `devDependency` de versión exacta en `package.json` y guardar que ningún fragmento de `templates/**` declare la unidad; verify: `node --test test/context.test.mjs test/agent-context.test.mjs` (CR1, CR2, CR4)
  - **Resolved:** `2026-07-28T18:48:46Z`
- [x] Fijar en `.changeledger/config.yml` que los `readiness.target_patterns` de este repositorio cubren toda ruta de producción versionada, con un pin que falle al retirar `AGENTS.md` o `hooks/**`; verify: `node --test test/check.test.mjs` (CR7)
  - **Resolved:** `2026-07-28T19:02:34Z`
- [x] Reescribir el párrafo de presupuestos de `AGENTS.md` para declarar la unidad del tokenizador, retirar la descripción de `bytes` y de la doble publicación, y añadir que el margen no es permiso de gasto; verify: `node --test test/contract.test.mjs` (CR2, CR6)
  - **Resolved:** `2026-07-28T19:02:35Z`
- [x] Mover a `templates/contract/budgets.yml` el techo operativo de líneas del core y el del bloque `## Commits`, retirando sus literales de `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR3)
  - **Resolved:** `2026-07-28T18:48:47Z`
- [x] Retirar el segmento de bytes de la línea BEGIN en `src/commands/context.mjs` y de sus aserciones; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR5)
  - **Resolved:** `2026-07-28T18:49:09Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-28T19:02:35Z`

## Log

- **2026-07-28T17:04:29Z** `[note]` Draft creado. Alcance ampliado por Roberto para absorber los dos techos que viven hardcodeados en test/context.test.mjs y que ninguna migración de unidad alcanzaría; el barrido confirma que la clase son sólo esos dos. Techos declarados = los que el contenido de hoy cumple, decisión de Roberto: spec está a 3118 tokens y bajarlo necesita margen de core que este change provee, así que declarar 2500 dejaría el gate rojo y convertiría el techo en objetivo. La capa de transporte (head derivado, bump de bootstrap) y la higiene del mecanismo (pins, emittedLines, convergencia) salen a changes propios por techo de complejidad.
- **2026-07-28T17:07:08Z** `[note]` Enmendado antes de aprobar por dos warnings de readiness. CR3 llevaba budgets.yml sin ruta y target_patterns exige templates/**; corregido a templates/contract/budgets.yml. CR6 retirado: AGENTS.md no esta en readiness.target_patterns, asi que ninguna tarea con criterio puede targetearlo y el criterio pasaria de warning en draft a error en approved. Es el hallazgo 13 en vivo, el mismo caso que hooks/**, sobre un fichero de produccion versionado. La regla que Roberto pidio para AGENTS.md sale a un change quick, que activa solo Request y Log y por tanto no pasa por readiness.
- **2026-07-28T17:20:29Z** `[note]` Enmendado por tres decisiones de Roberto del 2026-07-28. (1) BOOTSTRAP_VERSION se queda en 4, la v4 no es publica todavia: abarata CH-17, con el aviso de que mantener la version cambiando el contenido del bloque cae en el hallazgo 26 -register calcula estado replaced y reescribe el AGENTS.md del consumidor sin avisar, porque solo avisa al subir version-; inocuo hoy porque no hay consumidor. (2) Roberto anadio AGENTS.md a readiness.target_patterns, asi que CR6 vuelve a este change; se cierra la CLASE anadiendo tambien hooks/**, porque hooks/pre-commit es produccion versionada y ninguna tarea con criterio puede tocarlo -hallazgo 13-. (3) Sobre spec: en tokens no habra fallo, el techo declarado lo cumplen los 3118 de hoy. En lineas mide 301 contra un head de modos de 250, asi que ese head nace en 350. Verificado que solo el head del core es caro de cambiar porque vive en el bloque bootstrap publicado en src/contract.mjs:52; los heads de modo viven en prosa del contrato y se mueven sin coste ni deriva, asi que bajarlo a 250 tras CH-0b es gratis.
- **2026-07-28T17:31:41Z** `[note]` Roberto anadio hooks/** ademas de AGENTS.md, cerrando la clase del hallazgo 13 el mismo. Eso deja CR7 con su Then ya satisfecho, asi que se reformula sobre el guard y no sobre el estado: verificado que ningun test fija los target_patterns de este repositorio -las referencias de test/check.test.mjs usan fixtures sinteticos con app/**, packages/** y custom/**-, luego hoy retirar AGENTS.md o hooks/** no rompe nada y la cobertura se perderia en silencio. El trabajo falsable de CR7 es ese pin de regresion. Corregido tambien el Proposal, que afirmaba que este change anade hooks/** cuando ya estaba anadido: prosa describiendo trabajo hecho, la misma clase del hallazgo 53.
- **2026-07-28T17:35:21Z** `[status]` draft → approved
- **2026-07-28T17:36:50Z** `[status]` approved → in-progress
- **2026-07-28T17:44:00Z** `[note]` Enmienda de CR2 y CR6 autorizada por Roberto el 2026-07-28, antes de escribir codigo. Verificado que NINGUN fragmento de templates/contract describe los presupuestos -el unico match de ceiling en core.md es Complexity ceiling, otra cosa- y que la descripcion vive en AGENTS.md:49-54. CR2 nombraba por tanto una sede inexistente y habria mandado al implementador a anadir prosa a un core con 2 lineas de margen, reventando el techo por el motivo equivocado; ahora nombra AGENTS.md y declara que ningun fragmento gana esa declaracion, porque los tokens los aplican nuestros tests con una devDependency mientras las lineas las consume el head de cualquier consumidor. CR6 estaba incompleto: ese mismo parrafo afirma que cada entrada declara bytes y que toda captura publica ambas dimensiones, y este change vuelve falsas las dos mitades, asi que se anade la clausula que obliga a retirar esa descripcion caduca -hallazgo 53, que se habria colado estando delante-. Cero criterios nuevos y cero superficie nueva: los dos ya tocaban AGENTS.md. La enmienda queda sin commitear y viaja dentro del primer commit de tarea, porque una edicion de documento no es clase de commit propia.
- **2026-07-28T18:49:52Z** `[note]` Tareas 1, 4 y 5 completadas por el grupo A: budgets.yml en tokens/lines con techos medidos, gpt-tokenizer 3.4.0 como devDependency de version exacta, los dos techos huerfanos absorbidos -core 195 lineas y el bloque core-commits 28-, y la linea BEGIN publicando solo lines. Verificado por el orquestador: 863/863 verde, las cinco capturas publican lines sin bytes ni tokens, y bajar core-commits de 28 a 27 falla nombrando la entrada. Dos aportes del delegado que no estaban pedidos: una mutacion le sobrevivio -su patron para detectar techos hardcodeados no cazaba emittedLines(core) <= 195 porque el operando izquierdo era una llamada- y la cerro anclando el patron a la medicion; y retiro el punto fijo iterado con argumento, porque existia solo por el ancho de la cifra de bytes y una cifra de lineas mas ancha no puede anadir una linea, lo que CIERRA el defecto de maxPasses=1 que estaba aparcado para el change de higiene. Correccion de mis cifras: las medi antes de retirar el segmento de bytes, asi que estaban infladas por el propio texto de la linea BEGIN, y mi implement 1701/168 era la ocupacion de este repo y no el maximo entre fixtures, que es la base correcta para fijar un techo. ERROR MIO: use git checkout sobre budgets.yml con trabajo sin commitear al restaurar una mutacion, revirtiendolo al baseline y destruyendo el fichero del delegado; restaurado verbatim y gate verde de nuevo. Es la regla de restaurar editando y nunca con git, que impongo a cada delegado y me salte. Tambien marque la tarea 3 como hecha sin estarlo y deje el texto de la tarea 1 con la sede caduca de CR2; ambos corregidos.
- **2026-07-28T19:02:35Z** `[note]` Tareas 2, 3 y 6 completadas por el grupo B. AGENTS.md declara la unidad -tokens contados por un tokenizador de referencia fijado, no por lo que consume un modelo concreto- retira la descripcion de bytes y de la doble publicacion, y anade que el margen no es permiso de gasto, conservando la regla de que un techo nunca es objetivo. El pin de CR7 lee el config REAL en tiempo de test y filtra cada patron en memoria en vez de duplicar la lista: retirar AGENTS.md o hooks/** produce el error de target sobre la tarea correspondiente. Mutaciones aisladas por obligacion, todas muertas; el delegado recorto su propio test de 7 aserciones a 3 al comprobar que cinco regex parciales eran redundantes tras la aserción exacta. Verificado por el orquestador: 865/865 verde, el parrafo de AGENTS.md es el esperado, y git diff confirma que config.yml conserva unicamente las dos lineas que anadio Roberto tras las mutaciones sobre el fichero real.
- **2026-07-28T19:03:21Z** `[status]` in-progress → in-review
- **2026-07-28T19:03:22Z** `[note]` Mandato de review: superficie que gobierna -budgets.yml, src/commands/context.mjs, test/budget-support.mjs, AGENTS.md y los pins nuevos-, no auditoria completa. Puntos de escrutinio, de las listas de decisiones no especificadas de los dos delegados: (1) los techos declarados y su formula -medido x1.10 redondeado a multiplo de 50- con la ocupacion real al lado, y que ninguna entrada declare un techo que su contenido no cumpla; (2) la retirada del punto fijo iterado, que cierra un defecto aparcado y reescribe 194233 CR6; (3) base.core.lines colapsado 200 a 195 y que nada pinnea head >= base.core.lines; (4) el grupo blocks y su techo de tokens de 650; (5) el pin de CR7 leyendo el config real en tiempo de test; (6) que test/cli-bin.test.mjs:370 sigue siendo el unico techo hardcodeado, deliberadamente fuera; (7) que las mediciones de overlays en tokens no existian antes y las tomo el delegado. AVISO AL REVISOR: el orquestador cometio tres errores en este change, todos registrados en el Log -git checkout sobre trabajo sin commitear que destruyo budgets.yml y se restauro verbatim, una tarea marcada como hecha sin estarlo, y criterios enmendados dejando el texto de una tarea caduco-; escrutar el estado final por si alguna de esas tres dejo residuo.
- **2026-07-28T19:20:53Z** `[review]` in-review → in-progress (retry): F1: el guard de CR2 escanea solo el nivel superior de templates/contract, dejando 8 fragmentos publicados -agent-contexts y agent-prompts- donde la declaracion de la unidad pasa con el gate verde. F2: el change retiro el pin por valor de contextBudgets.base.core que tenia el baseline y solo pinnea tokens, asi que base.core.lines puede subir a 250 por encima del head -200 del bootstrap con la suite verde
- **2026-07-28T19:20:53Z** `[note]` Review de contexto limpio: FAIL --retry con dos defectos, tras 19 mutaciones re-derivadas de las cuales 17 murieron. Lo verificado y solido: la retirada del punto fijo es correcta -272 framings sobre cada cruce de ancho de digito de 1 a 6 cifras, mas 8 cuerpos patologicos, cero discrepancias, y la propia spec contract-discovery ya argumentaba ese mismo razonamiento para la cifra de lineas-; la formula de techos reproduce las diez entradas no-excepcion desde las mediciones independientes del revisor; los cuatro overlays re-medidos coinciden exactos (445, 398, 906, 137); y NINGUNO de mis tres errores dejo residuo -budgets.yml consistente con la formula 10 de 10, Plan 6 de 6 con un solo Resolved por tarea y sin huerfanos, ningun texto de tarea contradiciendo su criterio-. Observaciones no bloqueantes: la formula gobierna solo la dimension tokens y no lines, que se heredaron del baseline salvo core; budgets.yml no puede llevar su propio porque porque se lee con JSON.parse aunque el repo ya depende de yaml; overlays.done lo excede contenido real -1203 tokens frente a 1000- pero era preexistente y el gate mide un fixture sintetico; y 130728 CR4 es el unico de seis criterios ajenos reescritos sin comentario que nombre este change, convencion seguida 5 de 6 y no regla escrita.
- **2026-07-28T19:28:47Z** `[status]` in-progress → in-review
- **2026-07-28T19:28:47Z** `[note]` Correccion de los dos defectos, sin commitear, para ronda de confirmacion con mandato minimo. F1: la enumeracion del guard de CR2 pasa a recursive, de 12 a 20 ficheros; reproducido el hueco antes -inyectar la declaracion en agent-prompts/review.md dejaba el test verde- y probado cerrado despues, el mutante ahora falla nombrando el fichero. F2: guard derivado nuevo dentro de 124837 CR7, bootstrapHeadCut() parsea head -(\d+) del REFERENCE de src/contract.mjs y asevera base.core.lines <= headCut; dos mutaciones lo matan, subir lines a 250 y encoger el head a 150, ambas nombrando la relacion. Verificado por el orquestador: 865/865 verde, un solo fichero tocado y una sola linea preexistente modificada, la del readdirSync. HALLAZGO DE CLASE del delegado, reportado y NO arreglado por estar fuera de su frontera: otras TRES guardas exhaustivas-negativas de las suites de captura tienen el mismo hueco no recursivo -194234 CR4, 124837 CR1 y 124837 CR8-, asi que una obligacion retirada podria reintroducirse en los 8 subfragmentos publicados sin que nada avise. Son criterios de otros changes; candidato a change propio.
- **2026-07-28T19:33:57Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T19:33:58Z** `[note]` Ronda de confirmacion con mandato minimo: PASS. Los dos fixes verificados por mutacion en copia, y F1 probado en DOS subdirectorios distintos -agent-prompts/review.md y agent-contexts/investigation.md- para confirmar que cerro la clase y no el caso del revisor. El guard derivado falla en las dos direcciones y no tropieza con LITERAL_CEILING, comprobado ejecutando la regex contra el fuente. Alcance: un solo fichero, una sola linea preexistente. HALLAZGO CONFIRMADO Y EXPLOTABLE: el revisor inyecto la frase retirada que vigila 124837 CR1 en agent-contexts/investigation.md y la suite siguio verde 79/79, asi que las tres guardas no recursivas -194234 CR4, 124837 CR1, 124837 CR8- son un hueco real, estructuralmente identico al que se acaba de cerrar. Observacion no bloqueante: bootstrapHeadCut hace REFERENCE.match(/head -(\d+)/) y destructura sin comprobar nulo, asi que si REFERENCE dejase de contener el patron lanzaria TypeError en vez de nombrar la ausencia del corte; contradice el principio de que lo indecidible aborta Y SE NOMBRA. Recomendado que viaje con el change de las tres guardas, misma familia y mismo fichero.
- **2026-07-28T19:37:07Z** `[validation]` in-validation → done (human accepted)
- **2026-07-28T19:40:36Z** `[graduation]` spec: `contract-discovery.md`
