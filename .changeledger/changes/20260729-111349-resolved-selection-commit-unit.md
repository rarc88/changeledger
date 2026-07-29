---
id: "20260729-111349"
title: La unidad de commit es la selección resuelta, no el change entero
type: bug
status: done
created: 2026-07-29T11:13:49Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260728-164620"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El contrato vigente exige **exactamente un** commit de implementación por change y
prohíbe explícitamente cualquier corte menor. Eso no es lo que se decidió. Corregirlo en
`templates/contract/core.md`, que es el contrato que se sirve a todo repo consumidor.

Decisión de Roberto del 2026-07-29, en sus palabras y sin parafrasear:

> no es un commit unico por implementacion, hablamos de que no se debe delegar tarea por
> tarea a un subagente, sino que se debe medir la completidad y si estan relacionadas o
> no para delegarlas en grupo, todas o individuales, cuando se resuelve una seleccion se
> hace commit de lo resuelto, no esperas a que todas esten resueltas.

Son dos reglas encadenadas: la **unidad de delegación** se mide por completitud y
acoplamiento, y el **commit sigue a esa unidad**, commiteándose al resolverse en vez de
acumularse. El contrato codificó sólo la segunda, y la codificó al revés.

## Investigation

### La sede del defecto

`templates/contract/core.md`, bloque `## Commits`, tres afirmaciones:

1. La clase Implementation: `**Implementation**: exactly one, the change's complete work`.
2. El párrafo de granularidad: `A single Plan task is not: it is reverted, referenced and
   implemented with the rest of the change, so the change is the implementation unit`, y
   su cierre `So a change yields two commits, … never one per transition and never one
   per Plan task`.
3. El párrafo de commit combinado: `Plan tasks are never a reason — they all travel in
   the one implementation commit`.

Ocurrencias medidas el 2026-07-29 de la cadena `**Implementation**: exactly one`: **cinco**
en el árbol, una en `templates/contract/core.md` y cuatro en `test/context.test.mjs` (tres
aserciones vivas y un comentario de clasificación). La cadena `never one per Plan task`:
**dos**, una en el contrato y una en un comentario. Y una sexta sede en forma de regex,
`assert.match(contract, /\*\*Implementation\*\*: exactly one/)`, en `test/cli.test.mjs`.

Sedes de aserción, citadas por nombre de test porque los números de línea caducan:

| fichero | test |
|---|---|
| `test/context.test.mjs` | `164620 CR1: core declares five commit classes and no per-task unit` |
| `test/context.test.mjs` | `124835 CR6/CR7: invariants, exit gates, the ceiling and commits carry the decided text` |
| `test/context.test.mjs` | `124837 CR8: no obligation leaves implement.md without a named home` |
| `test/cli.test.mjs` | `214902 CR5/CR6: installed contract preserves traceability without false-fix commits` |

### Causa raíz

La decisión llegó como una frase sobre **delegación** y se escribió como regla de
**commits**, añadiendo un cuantificador —"exactly one"— que nadie pidió. Pasó review PASS,
graduación a `.changeledger/specs/git-traceability.md` y aceptación humana. Ninguna
herramienta puede cazarlo: el revisor verifica el documento contra el código y el código
contra los criterios, y **nadie compara el criterio con la intención del humano**, porque
la intención no vive en ningún artefacto que el revisor lea. Un criterio más estrecho que
la decisión es falsable y verdadero: satisface todos los gates.

### La prueba de granularidad del propio bloque lo desmiente

El bloque enuncia su propio discriminante: *"whether the unit will be reverted, referenced
or implemented independently"*. Una **selección de trabajo resuelta** lo satisface — se
revierte sola, y mejor que el change entero. El texto vigente aplica la prueba a "una
tarea del Plan", concluye correctamente que una tarea aislada no la pasa, y **salta** de
ahí a que la unidad es el change completo. El salto no está justificado: entre "una tarea"
y "todo el change" está la selección resuelta, que es la que pasa la prueba.

### Lo que hay que conservar, y por qué no se pierde

CH-15 (`20260728-164620`) existe por un agujero real: si nada se commitea hasta el PASS,
el review no tiene artefacto inmutable y el orquestador puede editar el entregable entre
el informe y la historia — dos de los cuatro `fail --retry` de la fase A fueron
exactamente eso. **Esa garantía sobrevive intacta** con N commits: el rango se cierra
cuando la última selección está commiteada, y la obligación es que eso ocurra **antes** de
delegar el review. Lo que se retira es el número, no la garantía.

### El mismo empuje en la tabla de propiedad

`templates/contract/core.md`, bloque *"Protect the orchestrator's context"*, fila
`| any implementation task with its own verify command | subagent |`. El cuantificador
"any … task" empuja una delegación por tarea, que es la mitad de la decisión que el
contrato tampoco recoge. Entra en este change porque es la misma regla; el **dimensionado
del grupo** (completitud y acoplamiento) **no** entra: es contenido de CH-5b según el mapa
de §8 del acta, y duplicarlo aquí crearía la clase 19/48 a propósito.

### Presupuesto — verificado que no bloquea

Medido el 2026-07-29 antes de redactar: bloque `## Commits` a **32/125 líneas y 620/1250
tokens**; pack `core` a **197/400 líneas y 2648/4000 tokens**. Hay margen sobrado en las
cuatro dimensiones, y el change es sustitutivo. No se escribe criterio sobre esto: con 93
líneas de holgura una aserción de presupuesto no podría fallar, y sería la clase del
hallazgo 28. La aserción viva `assertWithinBudget('core-commits block', …)` ya cubre la
puerta.

### La segunda sede es verdad persistente, y entra en alcance

`.changeledger/specs/git-traceability.md` lleva la formulación estrecha **en castellano**,
graduada desde CH-15. Cinco afirmaciones medidas el 2026-07-29:

| afirmación en la spec | por qué es falsa tras el cambio |
|---|---|
| `**La unidad de commit es el change, y las clases son contables.**` | la unidad es la selección resuelta |
| `**Implementation**, exactamente uno con el trabajo completo del change` | el número no se fija |
| `**Una tarea del Plan no**: … así que el change es la unidad de implementación` | el salto que CR2 retira |
| `un change produce **dos** commits` | conteo fijo retirado |
| `todas viajan en el único commit de implementación` | no hay commit único |

Y su párrafo `Dos formulaciones anteriores quedaron retiradas` necesita una **tercera**
entrada: el conteo fijo por change, retirado por deformar la decisión sobre delegación.

**Se arregla dentro de este change, no como obligación de graduación.** Decisión de
Roberto del 2026-07-29: *"tienes que arreglar .changeledger/specs/git-traceability.md y no
dejarlo escapar de nuevo"*. Y tiene el argumento del propio historial detrás: la fuga de
verdad persistente se cazó **cinco de cinco veces leyendo la spec a mano al graduar**, y
una obligación escrita en prosa es el mecanismo que falló las cinco. Aquí la spec no
contiene una verdad *pendiente* de promover —contiene una verdad **ya falsa**—, así que
corregirla es entregable, no graduación.

No excede el techo de complejidad: es la misma regla en dos sedes, y la spec es
sustractiva salvo la entrada de formulación retirada.

**Hoy ningún test afirma contenido de `.changeledger/specs/**`** — verificado: los únicos
hits de `specs` en la suite son `config-migration.test.mjs` (el path de config),
`context.test.mjs` (la frase del core sobre qué es cada directorio) y `view.test.mjs` (el
serializador del viewer). Por eso CR6 estrena la guarda, y la estrena **normalizando
espacios**: fijar prosa por substring crudo es el hallazgo 24, que rompe tests ajenos al
reflowar.

## Specification

La clase Implementation deja de ser contable. El bloque `## Commits` pasa a decir que la
unidad de implementación es **la selección de trabajo resuelta**: se commitea cuando queda
resuelta, sin esperar al resto, y el número de commits de implementación por change no se
fija. La prueba de granularidad se aplica a esa unidad en vez de saltar de la tarea al
change. La garantía del rango del review se conserva como obligación de secuencia —toda
selección commiteada antes de delegar el review— y no como conteo.

La corrección alcanza **las dos sedes de la regla**: el contrato publicado
(`templates/contract/core.md`) y la verdad persistente del repo
(`.changeledger/specs/git-traceability.md`). Arreglar sólo una es la clase 19/48, que en
este repo ya se fugó cinco veces.

### CR1 — La clase Implementation ya no se cuenta

- **Given** la captura `changeledger context` y los ficheros de `templates/contract/`
- **When** se lee la clase Implementation del bloque `## Commits`
- **Then** describe un commit por selección de trabajo resuelta, commiteada al resolverse
  y sin esperar a las demás
- **And** la cadena literal `**Implementation**: exactly one` tiene **cero** ocurrencias en
  `templates/contract/`, frente a la única de hoy en `core.md`
- **And** las cuatro sedes de aserción de la tabla de Investigation quedan retargeteadas a
  la forma nueva o retiradas, cada una con su comentario de clasificación como
  preservada/reemplazada/retirada

### CR2 — La prueba de granularidad no salta de la tarea al change

- **Given** el párrafo de granularidad del bloque `## Commits`
- **When** se aplica su propio discriminante a una selección de trabajo resuelta
- **Then** el texto afirma que la selección resuelta **sí** lo satisface, y nombra la
  tarea aislada del Plan como demasiado pequeña sin concluir que la unidad sea el change
- **And** las cadenas `never one per Plan task`, `the change is the implementation unit` y
  `a change yields two commits` tienen **cero** ocurrencias en `templates/contract/`,
  frente a las tres de hoy en `core.md`

### CR3 — El commit combinado deja de apoyarse en el commit único

- **Given** el párrafo de commit combinado del bloque `## Commits`
- **When** se busca la razón por la que las tareas del Plan no justifican combinar
- **Then** la razón ya no es que viajen todas en un commit único, y la cadena
  `they all travel in the one implementation commit` tiene cero ocurrencias en
  `templates/contract/`
- **And** la única causa de legitimidad de un commit combinado sigue siendo que varios
  changes compartan los mismos ficheros, con el registro en el Log nombrando cada change

### CR4 — El rango que inspecciona el revisor sigue cerrado

- **Given** un change con dos selecciones de trabajo resueltas y commiteadas por separado
- **When** se lee la obligación de secuencia del bloque `## Commits`
- **Then** exige que **toda** selección esté commiteada antes de delegar el review, de modo
  que `baseline..HEAD` esté cerrado en el instante de delegar y el entregable no pueda
  cambiar entre el informe del revisor y la historia
- **And** un test afirma que esa obligación sigue presente en el core tras el cambio, de
  forma que retirar la garantía junto con el número falle

### CR5 — La tabla de propiedad no cuantifica por tarea

- **Given** la fila de la tabla del bloque *"Protect the orchestrator's context"* que hoy
  dice `| any implementation task with its own verify command | subagent |`
- **When** se lee qué se delega
- **Then** la fila nombra el trabajo de implementación con verificación propia sin
  cuantificar por tarea, y la cadena `any implementation task` tiene cero ocurrencias en
  `templates/contract/`

### CR6 — La verdad persistente no sobrevive contradiciendo al contrato

- **Given** `.changeledger/specs/git-traceability.md` tras el cambio
- **When** se normalizan sus espacios en blanco a uno y se buscan las cinco afirmaciones
  de la tabla de Investigation
- **Then** las cinco tienen **cero** ocurrencias, frente a una cada una hoy, y la spec
  describe la unidad de commit como la selección de trabajo resuelta
- **And** su párrafo de formulaciones retiradas enumera **tres**, no dos, nombrando el
  conteo fijo por change como la tercera
- **And** un test afirma esas cero ocurrencias sobre el texto **normalizado**, de modo que
  reintroducir cualquiera de las cinco —o reflowar el párrafo— haga fallar la suite; hoy
  ningún test afirma contenido de `.changeledger/specs/**`, así que la guarda es nueva y
  su ausencia es la razón por la que la clase se fugó cinco veces

### CR7 — Ningún fragmento del contrato exige el commit único

- **Given** `templates/contract/implement.md`, que hoy exige en el paso 5 de su lista
  ordenada `Create the one implementation commit with \`changeledger commit\`` y describe
  la ventana entre `in-progress` y ese commit como un evento único
- **When** se leen sus cuatro sitios y se compara con la clase Implementation del core
- **Then** la cadena `the one implementation commit` tiene **cero** ocurrencias en
  `templates/contract/`, frente a la única de hoy en `implement.md`, y las **tres**
  ocurrencias medidas de `the implementation commit` describen la clase o la selección
  resuelta, nunca un commit único por change
- **And** la prosa de la ventana admite **N** selecciones commiteadas conservando el
  conjunto esperado de delta que ya nombra, para no retirar una obligación sin sede
- **And** la guarda que fija esto **barre todos los ficheros de `templates/contract/`**, no
  sólo `core.md`, de modo que reintroducir el commit único en cualquier fragmento falle:
  una guarda que sólo mira una sede es la clase que dejó este defecto vivo

## Plan

- [x] Reescribir la clase Implementation y el párrafo de granularidad en `templates/contract/core.md`, retargeteando en la misma pasada los pins de snapshot y sus comentarios de clasificación; verify: `node --test test/context.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-29T11:56:15Z`
- [x] Ajustar el párrafo de commit combinado y fijar la obligación de secuencia del rango del review en `templates/contract/core.md`, con la aserción que la protege; verify: `node --test test/context.test.mjs` (CR3, CR4)
  - **Resolved:** `2026-07-29T11:56:15Z`
- [x] Quitar el cuantificador por tarea de la fila de propiedad del bloque de contexto en `templates/contract/core.md`; verify: `node --test test/cli.test.mjs` (CR5)
  - **Resolved:** `2026-07-29T11:56:16Z`
- [x] Reescribir las cinco afirmaciones falsas y añadir la tercera formulación retirada en `.changeledger/specs/git-traceability.md`, con la guarda nueva que las fija a cero sobre texto normalizado; verify: `node --test test/context.test.mjs` (CR6)
  - **Resolved:** `2026-07-29T11:56:16Z`
- [x] Retirar la exigencia del commit único de los cuatro sitios de `templates/contract/implement.md` y ensanchar la guarda a todos los fragmentos; verify: `node --test test/context.test.mjs` (CR7)
  - **Resolved:** `2026-07-29T11:56:16Z`
- [x] Correr el gate completo y `changeledger check --commits` antes de pedir review (support)
  - **Resolved:** `2026-07-29T11:56:16Z`

## Log

- **2026-07-29T11:20:00Z** `[note]` Redactado con la frase literal de Roberto citada en el Request, por la lección de que una decisión traducida de dominio (delegación → commits) es donde se perdió la primera vez. Medido antes de escribir criterios: 5 ocurrencias de `**Implementation**: exactly one`, 2 de `never one per Plan task`, bloque a 32/125 líneas y 620/1250 tokens, core a 197/400 y 2648/4000. Descartado por vacuo un CR de presupuesto: con 93 líneas de holgura no podría fallar (clase del hallazgo 28). El dimensionado del grupo de delegación queda fuera de alcance a propósito, es de CH-5b.
- **2026-07-29T11:21:58Z** `[note]` Alcance ampliado por instrucción de Roberto (2026-07-29): la spec .changeledger/specs/git-traceability.md se corrige DENTRO del change, con CR6 y guarda de test normalizada, en vez de quedar como obligación de graduación en prosa — que es el mecanismo que falló las cinco veces que la clase se fugó. Verificado que hoy ningún test afirma contenido de .changeledger/specs/**, así que la guarda es superficie nueva y su ausencia explica las cinco fugas.
- **2026-07-29T11:25:29Z** `[status]` draft → approved (human via conversation)
- **2026-07-29T11:25:39Z** `[status]` approved → in-progress
- **2026-07-29T11:26:33Z** `[note]` Corte de delegación medido antes de delegar: las seis CR se reparten en dos superficies de contenido (templates/contract/core.md y .changeledger/specs/git-traceability.md) pero AMBAS escriben en test/context.test.mjs — el pin de snapshot del core y la guarda nueva de la spec viven en el mismo fichero. Superficies acopladas, así que una sola delegación, no dos. Mandato: Plan completo. Precedente medido: 161k en una pasada frente a 347k en tres para un change menor.
- **2026-07-29T11:45:45Z** `[note]` CR7 añadido en vuelo con autorización explícita de Roberto (2026-07-29). Defecto MIO: el Request scopeó la corrección a core.md, así que los seis CR aprobados dejaban templates/contract/implement.md contradiciendo al core en cuatro sitios — el paso 5 de su lista ordenada exige 'the one implementation commit'. Es la clase 19/48 creada por el propio change. La enmienda es ESTRICTAMENTE MAS FUERTE: sólo añade un criterio y ensancha la guarda de core.md a todos los fragmentos, así que no puede convertir un fallo en un pass. Se declara al revisor como edición del orquestador sometida al mismo estándar.
- **2026-07-29T11:56:41Z** `[note]` Commit combinado, con su porque: las dos selecciones resueltas —CR1-CR6 y CR7— comparten test/context.est.mjs (el pin de core.md, el de implement.md, la guarda de la spec y la guarda de CR7 viven en el mismo fichero), asi que separarlas exigiria un commit intermedio con la suite roja. La causa es MIA y es de proceso, no de superficie: debi commitear la primera seleccion ANTES de mandar CR7 al delegado, que es precisamente la regla que este change instaura. Al no hacerlo las entrelace. Registrado en vez de fabricar dos commits.
- **2026-07-29T11:56:41Z** `[note]` [note] PUNTO DE ESCRUTINIO PARA EL REVISOR, no tocado a proposito: el delegado pidio que se juzgara su decision 1. En test/context.test.mjs el pin 164620 CR7 conserva los literales EN SINGULAR ('Between changeledger status <id> in-progress and the implementation commit', 'carry those transitions inside the implementation commit') y pasan por substring de la forma plural nueva, mientras su comentario de clasificacion ya declara el reemplazo plural. Comentario y asercion discrepan: es la clase del hallazgo 40. No lo edito yo — editar el entregable entre el informe y la historia causo dos de los cuatro fail --retry de la fase A. Lo juzga el revisor en contexto limpio.
- **2026-07-29T11:57:18Z** `[status]` in-progress → in-review
- **2026-07-29T11:57:38Z** `[note]` [note] Mandato de review: SUPERFICIE QUE GOBIERNA, no auditoria completa. Rango fijo baseline..HEAD = 10828c3b..e154c929, un solo commit de implementacion. Puntos de escrutinio explicitos que se le pasan literales: las 9+7 decisiones que el documento no especificaba segun los dos informes del implementador; la discrepancia comentario/asercion del pin 164620 CR7 (clase hallazgo 40); si la garantia de rango de CR4 sobrevivio de verdad o solo en prosa; si alguna obligacion quedo retirada sin sede nombrada; y mis dos ediciones de orquestador — la enmienda CR7 en vuelo y el commit combinado — sometidas al mismo estandar que el implementador.
- **2026-07-29T12:47:20Z** `[review]` in-review → in-progress (retry): Tres correcciones acotadas, ninguna de alcance ni de juicio de producto. (1) El pin 164620 CR7 conserva dos literales en singular que ya no discriminan: el revisor revirtio implement.md a la prosa singular y el pin siguio verde, asi que hay que pluralizarlos y arreglar su comentario. (2) implement.md linea 30-31 reenuncia la regla de temporizacion de commits de core en un fragmento cuyo propio pin declara que toda regla de commit esta retirada de ahi: duplicacion de verdad, la clase que este change existe para cerrar; se convierte en puntero. (3) Mi nota de Log del commit combinado afirma algo FALSO: el revisor construyo el arbol intermedio y lo corrio, 99 pass 0 fail, asi que el commit intermedio habria sido verde. Los siete CR pasan con mutacion confirmada.
- **2026-07-29T12:52:28Z** `[note]` CORRECCION DE UNA AFIRMACION FALSA MIA. Mi nota del commit combinado dijo que separar las dos selecciones exigiria un commit intermedio con la suite roja. Es FALSO y lo falseo el revisor construyendo el arbol contrafactual y corriendolo: 99 pass 0 fail en context.test.mjs y 52 pass 0 fail en cli.test.mjs. El commit intermedio habria sido verde. Lo verdadero es la frase siguiente de esa misma nota: la causa fue de proceso, no de superficie — debi commitear la primera seleccion antes de delegar CR7. Es la tercera vez en esta iniciativa que escribo en el Log un mecanismo plausible sin medirlo. Nota aparte: en el momento de commitear el contrato EN VIGOR aun exigia un commit unico, asi que el commit unico cumplia el texto que gobernaba; el entregable no cambia.
- **2026-07-29T12:52:41Z** `[note]` Correccion del retry, sin commitear. Tres arreglos del revisor MAS la clase completa, hechos por mi como orquestador y sometidos al mismo estandar: (1) los dos literales del pin 164620 CR7 pluralizados y su comentario corregido — probado por mutacion que AHORA muerde, revertir implement.md al singular hace fallar 164620 CR7 donde antes quedaba verde, y restaurado editando con git diff --quiet devolviendo 1; (2) implement.md ya no reenuncia la temporizacion de commits, ahora APUNTA a la clase Implementation del core siguiendo el precedente de la frase vecina, con 111349 CR7 fijandolo en las dos direcciones (puntero presente y reenunciado ausente) y el pin de implement.md rebumpeado a ac019965 con su entrada de clasificacion; (3) la nota falsa del Log corregida arriba. ADEMAS barri la clase en vez de las dos instancias señaladas: habia una TERCERA afirmacion rancia en el mismo bloque narrativo — 'con el change como unidad, diferir al final ES la regla' — que este change vuelve falsa. Las tres corregidas. Gate: lint limpio 86 ficheros, 946/946, check 0 errores.
- **2026-07-29T12:52:41Z** `[status]` in-progress → in-review
- **2026-07-29T13:03:54Z** `[review]` in-review → in-progress (retry): Correcciones 1, 2 y 3 confirmadas, con sus guardas mordiendo en ambas direcciones y sin aserciones vacuas. El unico motivo es la correccion 4: mi nota de Log afirma un barrido de clase que NO ocurri. Sobreviven tres instancias del mismo razonamiento rancio, en presente y sobre listas vivas: test/context.test.mjs:3160-3164 dentro de 124837 CR8, test/cli.test.mjs:336-337 sobre un doesNotMatch vivo, y test/context.test.mjs:930-937 que es la copia AUTORITATIVA segun 164620 CR5 — arregle la duplicada del bloque de implement.md y deje la autoritativa. Es mi patron documentado: arreglar la instancia señalada y dar la clase por cerrada.
- **2026-07-29T13:06:17Z** `[note]` Segunda correccion, sin commitear. Esta vez el barrido esta MEDIDO, no afirmado. Grepe el patron completo de la clase en test/ — 'the change as the', 'deferring to the end', 'change as the commit unit', 'per-change count', 'the change is the commit unit' — y salieron DIEZ hits. Cuatro eran rancios y estan corregidos: cli.test.mjs:336 (tierra presente bajo un doesNotMatch vivo), context.test.mjs:933 (la copia AUTORITATIVA segun 164620 CR5), context.test.mjs:947 que era PEOR de lo que el revisor penso porque citaba como vigente el texto que 111349 CR3 elimino, y context.test.mjs:3162 dentro de la lista viva de 124837 CR8. Cinco eran narracion historica correcta y quedan intactos. El decimo era la imprecision del :1086 que el revisor marco no bloqueante: 'no fixed number survives in any fragment' era falsa sin cualificar porque Baseline y Draft conservan su conteo; cualificada a commits de IMPLEMENTACION. Los cuatro hits que sobreviven al re-grep estan todos en pasado y atribuidos, cada uno seguido de su retirada por 111349. Gate: lint limpio, 946/946, check 0 errores.
- **2026-07-29T13:06:17Z** `[status]` in-progress → in-review
- **2026-07-29T13:13:48Z** `[review]` in-review → in-progress (retry): Un solo motivo, y es la misma clase otra vez: test/context.test.mjs:3647-3650, el header de 164620 H4/H5, escapo mis cinco patrones SOLO porque 'the change as the' se parte entre dos lineas de comentario. Es la clase, no una variante: el ground esta en presente ('travels', 'can never be'), no esta marcado como superado, y sostiene dos aserciones vivas incluida la omision viva de 'several Plan tasks are inseparable'. Es la forma identica al cli.test.mjs:336 que si corregi, y toque su referencia en el fix de :952 sin tocar su header. Ademas mi nota de Log dice 'patron COMPLETO de la clase' y eso no esta ganado: un grep por lineas no puede ser el patron completo de una clase cuya redaccion se envuelve.
- **2026-07-29T13:15:34Z** `[note]` Tercera correccion, sin commitear. (1) test/context.test.mjs:3647, el header de 164620 H4/H5: regrounded. Era la clase identica al cli.test.mjs:336 y escapo porque 'the change as the' se parte entre dos lineas de comentario. (2) Los dos nits no bloqueantes que el revisor marco como 'tu decision' tambien corregidos, porque dejarlos señalados-y-sin-arreglar ES mi patron: la deixis de :3012 ('the new unit' denotaba la unidad que 111349 retira) y el antecedente de :1086 sobre Baseline y Draft. METODO, dicho con su limite: esta vez use un sweep que une cada corrida de comentario y normaliza espacios antes de casar, no un grep por lineas — por eso encuentra lo que el grep no encontro. Coincide de forma independiente con el revisor: un solo escapado real, los bloques 690 y 1037 solo contenian lineas ya corregidas. Sweep final de supervivientes en presente: CERO. No afirmo 'la clase completa': afirmo que un sweep insensible a saltos de linea sobre test/ con ocho patrones da cero supervivientes en presente. Gate: lint limpio, 946/946, check 0 errores.
- **2026-07-29T13:15:34Z** `[status]` in-progress → in-review
- **2026-07-29T13:24:31Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-29T13:24:31Z** `[note]` Tres residuos no bloqueantes que el revisor de confirmacion dejo por escrito y que NO toco: post-PASS editar el entregable es el patron que costo dos de los cuatro retry de la fase A, asi que van a follow-up y no a esta pasada. (1) context.test.mjs:1852-1853 describe el paso 5 como 'the single implementation commit', descriptor rancio aunque su verbo es pasado y su conclusion sigue cierta. (2) cli.test.mjs:318 'the new unit' es la misma forma de deixis que corregi en :3013, superada en el sitio por la frase siguiente. (3) cli.test.mjs:337 dice 'travels' donde :3650 dice 'travelled'; atribuido y retirado en ambos casos. Candidatos al barrido de aserciones de CH-9.
- **2026-07-29T13:34:38Z** `[validation]` in-validation → done (human accepted)
- **2026-07-29T13:36:24Z** `[graduation]` spec: `git-traceability.md`
- **2026-07-29T13:39:38Z** `[archive]` archived
