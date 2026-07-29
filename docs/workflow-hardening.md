# Endurecimiento del flujo — análisis y decisiones

Acta de análisis y decisiones de la iniciativa arrancada el 2026-07-26 y cribada
el 2026-07-28. No es verdad persistente (`.changeledger/specs/`) ni trabajo
autorizado (`.changeledger/changes/`): es de donde salen los changes. Documento
operativo y reversible.

Fuentes de la criba: los 57 hallazgos acumulados en sesión, cuatro barridos de
verificación independientes contra el árbol, un barrido de las `## Log` de los 18
changes cerrados, y las notas de método de las sesiones anteriores. Todo veredicto
tiene comando y salida detrás.

## 1. Origen

Observación de Roberto: **se estaba usando el reviewer como cazabugs del
implementador**. El reviewer es la última línea de defensa, no el revisor
personal del implementador. Coste medido: `141124` ~1,23M tokens y cuatro
reviews; `124835` ~926k en seis corridas; `124836` **6 rondas** frente a **2** de
`194234`, hecho justo después y no más fácil.

El problema no vive en el review. Está repartido por todo el ciclo, desde la
creación del draft hasta la cadencia de corrección del orquestador.

## 2. Diagnóstico — cinco eslabones

1. **La etapa de draft no tiene gate de salida.** El core proclama que cada etapa
   verifica su propia salida y que ninguna depende de la siguiente para saber si
   su trabajo es correcto. Para el draft es falso: `approve()` solo llama
   `assertTransition`, la cobertura de criterios es `warn()` en cualquier status,
   y `readiness` avisa en `draft` y solo falla en `approved`, cuando ya es tarde.
   Si nadie falsea el documento antes de implementar, **el primero que prueba el
   change de verdad es el revisor**.
   La Investigation de `124834` ya lo dice: el gate de autoverificación por etapa
   **no existe** y está scoped a `20260722-124655`/`124656`, ambos todavía en
   `draft`. Los changes de §4 son la implementación de una promesa que el core ya
   hace.
2. **Los criterios no son falsables.** Ocho de los doce CR de `124835` no tenían
   sitio de aserción. Y un criterio puede pasar individualmente con el Request
   incumplido: nadie verifica que el conjunto **cubra** el Request.
3. **No hay diagnóstico post-fallo, solo `retry`.** `core.md:91` promete que "the
   blocked and review contexts own that classification"; `blocked.md` son 13
   líneas sin taxonomía e `implement.md` solo dice *"iterate on that same diff"*.
   Aplica igual al rechazo del **humano** en `in-validation`: mismo tratamiento de
   parche local, ninguna de las cinco salidas disponible.
4. **El mandato del review no se declara ni se registra.** `agent-prompt review`
   no tiene campo de alcance; sus cuatro placeholders no acotan **qué** se revisa.
   Por construcción del prompt, todo review es auditoría completa. Medido: una
   ronda con mandato mínimo costó ~62k frente a ~106k de la completa, y encontró
   lo que tenía que encontrar.
5. **El revisor también produce falsos positivos, y eso quema el mismo
   presupuesto.** Caso registrado: un revisor reportó un "major" —validación
   ausente— que vivía en el callee (`deriveCandidateSnapshot`), con test de
   regresión exacto. Causa: alcance particionado por ficheros, sin seguir el
   helper cross-module. Una ronda completa gastada en nada.

Factor que **no es del producto**: la cadencia de corrección del orquestador
(arreglar la instancia señalada y no la clase; afirmar en el Log sin verificar).
Se ataca por prompt, no por contrato.

## 3. Criba — lo que sale de la lista

### 3.1 Resueltos o caducados por los propios 18 changes (9)

| # | qué | veredicto |
|---|---|---|
| 29 | dos convenciones de conteo de líneas | RESUELTO por `194233` |
| 32 | spec documentaba el flag `--have` | RESUELTO por `110603` |
| 33 | mensaje `hard.lines` por substring, orden no fijado | STALE — un techo por dimensión, orden fijo, un mensaje por dimensión |
| 34 | `assertWithinBudget` duplicado sin `strict_target` | RESUELTO — la bandera ya no existe |
| 39 | dos límites donde ambos fallan | STALE por `194233` |
| 43 | aserción vacua `core exceeds target` | RESUELTO — cero hits repo-wide |
| 47 | suite no hermética por `gh` | **REABIERTO** por decisión de Roberto → CH-11 |
| 48 | dos sedes del owner | RESUELTO por `8520901c` |
| 27 | pack `spec` a 178 bytes | CADUCADO — ver §6 |

### 3.2 Confirmaciones, no defectos (5)

- **44** el guard de commit de `141124` saltó con un error real en producción.
- **49** el techo del pack `spec` detuvo trabajo real sin retirar normativa.
- **50** el delegado paró y reportó en vez de tocar ficheros ajenos.
- **51** caso legítimo de `(support)`; criterio para distinguirlo del 41.
- **42** el contrato es salida de máquina — reencuadrado, ver CH-10.

### 3.3 Decisiones de Roberto del 2026-07-28

- **7** umbral de drafts estancados → **descartado**, trivial; la cura ya existe (`discard`).
- **36** aprobar en oleadas pequeñas → **lo gestiona el humano**, no entra al contrato. (**16** se queda: derivar conjuntos desde la config es regla de redacción, va a CH-2.)
- **12** → resuelto como **regla global**: solo se valida lo abierto. CH-12.
- **47** → **sube de deuda a change**: ninguna llamada de red, hermético por construcción. CH-11.
- **Tokenizador**: aceptado. `head` en **líneas**, techo en **tokens**, `devDependency`.
- **Prettier**: se implementa ahora que bytes deja de ser la unidad. CH-10.

### 3.4 Mío, no del producto — va a los prompts, no al contrato

**56** y **57**, más las nueve cláusulas de §CH-5b.

## 4. Los changes

16 changes. Ninguno documentado todavía.

### CH-0 — Presupuestos en tokens

Decisión de Roberto: el mecanismo actual es un dolor de cabeza cada vez que se
agrega, modifica o quita algo.

- Techo del `core`: **4000 tokens**. Resto de contextos: **2000–2500 tokens**.
- **Tokens = coste, líneas = transporte del `head`.** Dos límites que hacen cosas
  distintas, así que no reproducen la clase del hallazgo 39.
- **Toda referencia a cargar un contexto especifica su `head`**, y el `head` se
  deriva **del techo de tokens, no del conteo de hoy**: un `head` sacado del
  contenido actual se rompe en cuanto ese contenido use el presupuesto que le
  acabamos de dar (core a 4000 tokens son ~300 líneas a la densidad observada, así
  que un `head -200` derivado de las 193 de hoy truncaría una captura legítima).
  Lo escribe `register`/`ensureReference`; nunca se teclea a mano.
- **El `head` es un guard de truncamiento, no una pista de tamaño.** La pista la
  da la línea BEGIN con su `lines:N` real. Un `head` de más no cuesta nada
  (`head -400` sobre 193 líneas imprime 193); uno de menos rompe la carga.
- Densidad medida (tokens/línea): core 13,3 — spec 10,4 — implement 10,1 —
  review 10,3 — release 11,0 — `agent-prompt` 10,4 — `agent-context` 9,9. **Suelo
  real ~10.** De ahí `head` = techo de tokens ÷ 10, **redondeado a múltiplo de 50**:

  | pack | techo tokens | `head` |
  |---|---|---|
  | `core` | 4000 | **400** |
  | modos (`spec`, `implement`, `review`, `release`) | 2500 | **250** |
  | cápsulas `agent-prompt` / `agent-context` | 1000 | **100** |
  | `context <id>` | — | **ninguno** |

  Solo tres números en total, en vez de uno por pack. **50 gana sobre 25**: con 25
  los valores caen en 175/225/325 con márgenes de 4–7 líneas —el rebote de
  frontera del que queremos salir— y el número se movería el doble de veces, y cada
  movimiento reescribe el bootstrap en todo repo consumidor.
- **Auto-corrección**: si algún pack llegara a ser menos denso de 10 tok/línea, el
  techo de **líneas** de `budgets.yml` falla antes que el de tokens y avisa de
  subir el `head` a propósito.
- **Excepción decidida** (Roberto, 2026-07-28): `changeledger context <id>`
  incrusta un documento de change **arbitrario**, así que su tamaño es variable y
  **no lleva `head`**. La condición positiva de validez ya es la línea `END`, que
  detecta el truncamiento; un número inventado ahí sería precisión falsa.
- **Regla nueva en `AGENTS.md`**: tener presupuesto de sobra no autoriza a
  consumirlo; cada cosa que entra a un contexto va pensada y optimizada. Va en el
  **mismo párrafo** que la regla ya existente ("A ceiling is never a goal: never
  remove normative prose to fit one"), porque cada una por separado justifica el
  abuso contrario — una vacía normativa para encajar, la otra rellena porque sobra.

Tres condiciones para no fabricar precisión falsa:

1. `gpt-tokenizer` **no es el tokenizador de Claude** (Claude cuenta por API, que
   es red e inservible en un gate determinista). La unidad honesta es "tokens
   según un tokenizador de referencia fijado", y **se escribe en el contrato**.
2. Versión **pinneada exacta**, no `^`: una actualización de BPE movería los diez
   presupuestos en silencio.
3. **`devDependency`.** La línea BEGIN publica **líneas**; el techo de tokens se
   aplica en los tests. Publicar `tokens:N` metería el tokenizador como
   dependencia de runtime en todo repo consumidor.

Absorbe: **21, 46, B5, B6, B7, B8** y las cuatro observaciones del CR1 de `194233`.

### CH-0b — El pack `spec` cabe en su techo

3118 tokens contra 2500, y 301 líneas contra un `head` de 250: excede en las dos
dimensiones. Prerequisito de CH-1, CH-2 y CH-3.

**La causa no es prosa verbosa, es estructural.** Desglose medido:

| fragmento | tokens | líneas |
|---|---|---|
| `spec` — *Authoring a Change* | 1986 | 187 |
| `readiness` — *Definition of Ready* | 551 | 48 |
| `delegation` — *Economical Delegation* | 503 | 59 |

| sección de `spec` | tokens | líneas |
|---|---|---|
| Stages | 513 | 45 |
| Log grammar + IDs + authoring helpers | 443 | 35 |
| Plan task grammar | 343 | 24 |
| Change document | 320 | 32 |
| Repository layout and creation | 250 | 32 |
| Acceptance criteria + ejemplo CR1 | 111 | 17 |

**`delegation` duplica doctrina del core**, y es la clase 19/48 viva en el
contrato publicado. `MODE_CONTEXT` lo mete en **dos packs** (`spec` e
`implement`), y el core ya tiene *"Protect the orchestrator's context"*:

- core: *"Size the delegate to the work… cheapest tier and low effort for
  mechanical lookups…; mid tier for bounded reasoning over a single surface; top
  tier and high effort for deep analysis…"*
- `delegation.md:37-43`, sección propia *"Size the model to the work"*: *"Use the
  strongest available models for ambiguous scope, architecture… Use sufficient
  cheaper models for inventories, localized exploration…"*

La misma regla, dos sedes, palabras distintas. Igual la decisión de **cuándo**
delegar (tabla de propietarios en core frente a `delegation.md:3-7`) y
*"one owner per write surface"* (core frente a `delegation.md:31-32` y `:56-58`).
Y de los cinco bullets de *"Delegate a real boundary"*, **solo dos son de
redacción**; los otros tres se sirven a un agente que está escribiendo un
documento.

**El arreglo es el mismo movimiento que Roberto ya decidió para los commits** —
*"es común a toda fase; el core es quien explica el flujo"*: la doctrina
transversal de delegación consolida en el **core** y cada overlay se queda solo
con su línea de etapa. Descuenta ~503 tokens de `spec` **y de `implement`**, y
suma al core bastante menos porque la mayor parte ya está ahí.

Estimación a verificar durante el change, no dato: core ~2770/4000, `spec` ~2690
— todavía ~190 sobre 2500. Objetivos siguientes: `Stages` (513) y `Plan task
grammar` (343, que CH-1 reescribe de todas formas).

Nota del barrido: `124835` **canceló** el movimiento de dos frases (rol
`post-review`, línea del viewer) porque no había bytes; con tokens vuelve a ser
posible.

### CH-1 — Gramática del Plan por tags

`**Target:**` / `**Verify:**` / `**Criteria:**` en vez de parseo posicional.
Migración determinista con `fix`. Roberto ya lo dio por el candidato más rentable.

- `src/task.mjs:11` usa `/\(([^)]*\bCR\d+[^)]*)\)\s*$/`, que casa **solo el último
  grupo entre paréntesis**: `- [ ] Do things (CR1) (support)` → `criteria: []`,
  **CR1 perdido en silencio**.
- Tarea envuelta a segunda línea física acabando en `(CRn)`: marcador perdido y
  línea descartada **sin error** (`src/task.mjs:50-51`).
- `src/check.mjs:566-573` llama `warn(...)` **incondicionalmente**: la misma tarea
  con cuatro criterios da `4 error(s), 0 warning(s)` y, retagueada `(support)`,
  `0 error(s), 4 warning(s)` — **el change pasa**.
- `namesTargetAndVerification` (`src/check.mjs:584-590`) busca **ambas listas de
  patrones sobre el mismo texto**, así que `test/**` no puede entrar en
  `target_patterns` sin volver vacío el requisito para todo el repo.
- ~~`hooks/**` no está en `readiness.target_patterns`.~~ **CERRADO por CH-0**
  (`4693166e`), verificado el 2026-07-28: el patrón está en `.changeledger/config.yml`.
- **Reproducido en vivo el 2026-07-28** redactando CH-18, que es la mejor evidencia
  que ha dado esta clase: dos tareas envueltas a segunda línea física acabando en
  `(CR3, CR4)` y `(CR1, CR2)` dieron **6 warnings** —cuatro CR "not covered by any
  Plan task" más dos tareas que "references no criterion"— y **cero errores**. El
  documento parecía mal redactado cuando estaba bien redactado; el defecto era el
  ancla `$` a la línea física. Se arregló poniendo cada tarea en una sola línea, que
  es precisamente el apaño que CH-1 elimina. Coste: una ronda de `check`.
- Corolario de redacción: una tarea CR-bearing que solo añade guardas nombra como
  target **el módulo cuyo comportamiento fija**, nunca el fichero de test.

**El parser queda inmune al reflow** (decisión de Roberto, 2026-07-28): la
gramática por tags no ancla nada a la línea física, y además

- las líneas de continuación se **unen**, no se descartan — hoy
  `src/task.mjs:50-51` salta en silencio toda línea que no case `TASK_LINE` ni
  `METADATA_LINE`;
- una línea de Plan que no se puede parsear es **error nombrado, no silencio**,
  por el principio de "lo que no se puede decidir aborta y se nombra".

Esto **invierte la dependencia con CH-10**: no es que `.changeledger/**` espere a
CH-1, es que CH-1 vuelve el parser tolerante al reflow y **eso** es lo que
desbloquea Prettier.

Absorbe: **5, 41, 13, 4, 30** (parcial), **51** (criterio).

### CH-2 — Gate de salida del draft

- `approve()` (`src/commands/agent.mjs:92-94`) llama `status(id,'approved')`, que
  solo hace `assertTransition`. `assertChangeTextValid` está importado en el mismo
  fichero y solo lo invoca `validation('pass')` (`:200`).
- Cada CR nombra su **sitio de aserción**; `check` verifica que exista y mencione
  el CR.
- El conjunto de criterios debe **cubrir el Request**.
- Obligaciones de redacción: declarar para cada interfaz externa si su salida es
  estable para consumo automático (2); derivar conjuntos desde la config en vez de
  enumerar tipos (16); citar símbolos y nombres de test, nunca números de línea
  (30, 35); un criterio que cuantifica universalmente o cubre todo el dominio o se
  estrecha (55).
- Versión mecánica del 40: el test **grepea la obligación** en el fragmento que la
  entrada declara dueño. Hoy `test/context.test.mjs:1060-1069` solo compara un
  `sha256` y **confía en el comentario de clasificación**. Y ese comentario es
  **falso hoy en cuatro entradas**, admitidas y sin corregir por `124835`: dos
  literales mal atribuidos a `delegation.md`, una regla marcada MOVED que sigue
  viva reformulada en core, y `discovery-not-compliance` marcada RETIRED cuando
  corresponde REPLACED. **Esas cuatro se corrigen aquí.**

Absorbe: **1, 37, 28, 2, 55, 40, 16, 35, 3**.

**Relación con CH-0b** (pregunta de Roberto, 2026-07-28): no son el mismo change,
pero comparten superficie. CH-0b es sustractivo y neutral en comportamiento; CH-2
lleva **código** en `check`/`approve` además de prosa, y **gasta el espacio que
CH-0b libera** en `templates/contract/spec.md`. Por eso CH-0b va antes, y por eso
los criterios de CH-2 **no pueden citar la prosa ni las posiciones actuales** de
ese fichero: sería el hallazgo 16 otra vez — un criterio aprobado que pide lo
contrario de lo correcto porque otro change de la tanda movió su superficie.

### CH-3 — Diagnóstico post-fallo con cinco salidas

Reescritura de fondo del draft `20260722-124655`, que **no se aprueba tal como
está**: su diseño es un contador que bloquea al segundo rechazo. Con ese contador,
`194234` —dos rondas legítimas— habría bloqueado.

- El cortacircuito **no cuenta rechazos**: distingue **clase nueva de defecto**
  (→ rediseño) de **enumeración incompleta dentro de una estrategia ya verificada**
  (→ corrección normal, aunque sea la cuarta ronda).
- Cinco salidas: retry local, rediseño mismo alcance, extensión con re-aprobación,
  partición, descarte. Precedente vivido: `194220` usó la extensión.
- **Aplica también al rechazo del humano** en `in-validation`, no solo al del
  revisor. Hoy los dos reciben el mismo parche local.
- `blocked.md` pasa a **poseer** la taxonomía que `core.md:91` ya le atribuye.
- Antes de añadir un criterio a un change en curso, preguntar si no es un change
  propio: CR7 se añadió a `124836` ya empezado y **costó 4 de sus 6 rondas** (52).
  Cuando una corrección cambia el mecanismo, el criterio se reescribe en la misma
  pasada (53).
- **Excede el techo de complejidad** como está redactado (5 tareas tocando
  lifecycle, parser, viewer, contrato, check y metrics): hay que partirlo antes de
  aprobar.

Absorbe: **8, 9, 52, 53** y el draft `124655`.

### CH-4 — El gate local ocurre antes de `in-review`

`20260722-124656` — **enmendado y aprobado el 2026-07-28.** No entró "casi tal
cual": la verificación de sus supuestos falsificó dos y cambió su alcance.

Contradicción confirmada en la fuente de los fragmentos, citada por sección:

- `implement.md`, lista ordenada bajo *"When implementation and every task are
  complete"*: paso **2** = `changeledger status <id> in-review`, paso **3** =
  *"Apply the local formatter and full gates, including `changeledger check`"*.
- `review.md`, sección *"Independent Review"*: *"The candidate reaches review only
  after host formatter and full gates."*

**Lo que la verificación cambió:**

| supuesto del draft | veredicto | consecuencia |
|---|---|---|
| no existe transición de agente `in-review → in-progress` por fallo local | **falso** | `status <id> in-progress` existe y es legal (`lifecycle.mjs` declara `'in-review': ['in-validation','in-progress','blocked']`, `status()` sin guard, escribe `type:'status'`). El defecto es que **ningún fragmento la nombra**, y el contrato enruta a `review fail --retry`, que fabrica un veredicto |
| hay que blindar la escritura atómica | **ya cierto** | `src/atomic-write.mjs` usa temp + `fsyncSync` + `renameSync` bajo `withFileLock` y el mutador lanza antes de escribir. Criterio **retirado**: no podía fallar (hallazgo 28 dentro del propio draft) |
| hay que verificar que las métricas cuenten solo veredictos reales | **ya cierto** | `reviewRetryCount` en `src/metrics.mjs` filtra `type === 'review'`. Tarea **retirada**; el criterio se reescribió para afirmar la **ausencia del evento**, que sí es observable |
| ninguna validación corre al entrar en `in-review` | **cierto** | **CR3 nuevo y falsable**: la transición rechaza un candidato inválido |

Punteros de línea sustituidos por secciones y símbolos: el draft citaba
`implement.md` líneas 73–82, ya caducadas (hallazgo 35).

Quedó en **5 CR y 3 tareas**, de 5 CR y 4 tareas.

**Decisión de alcance (Roberto, 2026-07-28)**: CR3 mete código en un change que
iba a ser solo prosa, y se queda. Sin él los cinco criterios son prosa que nadie
comprueba, contra el criterio de la criba. No solapa con CH-2 porque son etapas
distintas: CH-2 es el gate de salida del **draft** (`approve`), CR3 el de la
**implementación** (`in-review`). Misma doctrina, dos puertas, dos changes.

Consecuencia de diseño: **arreglar el orden hace innecesario el veredicto
fabricado.** Si los gates corren antes de la transición, nunca hace falta volver
de `in-review` por un fallo local.

**Graduación (2026-07-28) — y la fuga que cazó.** Al graduar a
`.changeledger/specs/lifecycle.md` se encontró que la spec afirmaba el **orden
viejo**: *"tras mover a `in-review`, el agente anfitrión aplica el formatter local
y ejecuta los gates completos antes de delegar"*. Graduar sin tocarlo habría dejado
la verdad persistente contradiciendo el contrato y el código — los hallazgos 19 y
48 exactamente. Reescrito: el gate local decide si existe candidato revisable y
corre **antes** de la transición; la transición rechaza readiness inválida
validando el texto previo al cambio de status; y el retorno sin veredicto es
`status <id> in-progress`, nunca `review fail --retry`. El diagrama de estados
ganó esa arista.

**Confirma que el mecanismo de CH-8 hace falta**: la fuga la cazó una persona
leyendo la spec al graduar, no una herramienta. Es la tercera ocurrencia de la
clase en esta iniciativa.

### CH-5a — Mandato de review declarado y registrado

`agent-prompt review` gana campo de **alcance** —*spot check del diff* /
*superficie que gobierna* / *auditoría completa*— y se registra en el Log antes de
delegar. Hoy los cuatro placeholders (`reason`, `expected_output`,
`difficulty_or_risk`, `integration`) no acotan **qué** se revisa. Absorbe **6**.

### CH-5b — Contrato de evidencia de la delegación

Nueve cláusulas ya validadas en producción, hoy disciplina mía y no mecanismo:

- **disciplina de alcance como pass/fail** — tocar algo fuera de lo autorizado,
  incluido "arreglar en silencio" un residual conocido, es FAIL aunque el fix sea
  correcto;
- **nombrar los residuos que NO se tocan**, también pass/fail;
- al revisor: marcar cada afirmación como **"confirmado ejecutándolo"** o
  **"razonado desde el código"**;
- al revisor: **trazar todo helper llamado** antes de reportar una validación
  ausente (mata el eslabón 5 del diagnóstico);
- al revisor: recibir la lista literal de **"decisiones que el documento no
  especificaba"** del implementador como puntos de escrutinio;
- al corrector: **reproducir el defecto original** con su salida literal antes de
  arreglarlo;
- al corrector: el test nuevo debe **fallar antes del fix**, con el mensaje
  literal;
- **un mutante a la vez, nunca agrupado**, y que falle por la razón correcta;
  restaurar editando, nunca con git, y probarlo con `git diff --stat` vacío;
- cifras y punteros se pasan como **dato a verificar, no como hecho**.

Más: el delegado debe **señalar una instrucción del orquestador que contradiga el
contrato** en vez de obedecer en silencio, y **un cambio de tipo o de alcance se
reporta y se detiene, nunca se decide** (un subagente retipó un change de
`refactor` a `feature` por su cuenta). Y el **orquestador editando el entregable se
somete al mismo estándar que el implementador**, declarado en el prompt del
revisor para que lo escrute (20; funcionó dos veces).

**Regla de agrupación de delegaciones** (pregunta de Roberto, 2026-07-28, con
coste medido en la sesión):

| delegación | tokens de subagente | tool calls |
|---|---|---|
| CH-4, Plan entero en una pasada (3 tareas) | 160.667 | 121 |
| CH-14 tarea 1 | 108.481 | 50 |
| CH-14 tarea 2 | 148.770 | 110 |
| CH-14 tarea 3 | 90.139 | 51 |

CH-14 costó **347k en tres delegaciones** frente a 161k de CH-4 en una, siendo un
change más pequeño. **El coste es fijo por delegación, no proporcional a la
tarea**: cada delegado carga `agent-context`, lee el documento completo, re-verifica
los hechos que se le pasan, re-deriva el código de alrededor y vuelve a correr el
gate entero. Con N delegaciones el gate corre 2N veces en vez de 2.

Por tanto: **la unidad de delegación es la superficie de escritura, no la tarea del
Plan.** Sólo obligan a separar tres cosas — superficies que colisionarían entre
delegados concurrentes; acoplamiento que exige juicio del orquestador en medio; o
un grupo que excede lo que un delegado puede verificar en una pasada, el mismo
techo de complejidad que se exige al change. Fuera de esos casos, agrupar. El
contrato ya apunta en esa dirección: *"A good delegation unit is a question,
module, package, test area, migration slice"* — habla de superficies, no de tareas.

Aplicado a CH-14: las tareas 1 y 2 estaban **causalmente acopladas** (el CLI compone
lo que el lint acepta, tests adyacentes) y debían ir juntas; la 3 sí merecía ir sola
por superficie y riesgo distintos. El corte correcto era **2 delegaciones, no 3**.
Se partió en tres por la regla del commit por tarea, no por razón técnica — y
**CH-15 borra esa presión entera**, devolviendo la agrupación a una decisión pura de
coste y calidad.

Absorbe: **20, 45, 54, 56, 57**.

### CH-6 — Lo que no se puede decidir aborta y se nombra

- `context` con `type: bogus` → `Active stages(bogus)=`, **exit 0**, sin fragmento
  `readiness`. Sin `type` → literal `Active stages(undefined)=`. Con `stages` como
  string, `check` dice `stages must be a list` y `context` sale **0**. Dos sedes:
  `changePolicyBlock` (`src/commands/context.mjs:116-125`) y `fragmentsForType`
  (`:133-137`), ambas por `Array.isArray` sin rama de error (17).
- `review()` (`src/commands/agent.mjs:101-153`) es **el único** comando de
  lifecycle del fichero sin `assertTransition`; `status()`, `validation()`,
  `discard()` y `reopen()` sí lo llaman (14).
- `type: ""` produce `Error:  changes must be reviewed before validation` con
  doble espacio (`src/lifecycle.mjs:59`) (15).
- Un `chore` con `(CR99)` sale `✓ change ... valid`, cero diagnósticos:
  `checkCoverage` (`src/check.mjs:527-529`) retorna en cuanto `specification` no
  está activa (10).
- `Effective policy: … tdd=on` se imprime para `audit`/`chore`/`quick` sin ningún
  fragmento que defina `tdd` (18).

Absorbe: **17, 15, 10, 18, 14**.

### CH-7 — Robustez de cara al repo consumidor

- `config migrate` con `git.integration_branch` vacío **re-indenta un comentario
  ajeno**: `# Valid lifecycle statuses (order = progress)` gana 4 espacios. Causa:
  re-stringify completo en `src/config-migration.mjs:86` (22).
- `register` calcula el estado `replaced` (`src/contract.mjs:172-180`) pero
  `src/commands/register.mjs:37-42` **solo avisa en `updated`**, mientras
  `ensureReference` reescribe el fichero para todo estado que no sea
  `unchanged`/`equivalent` (26).
- Tras migrar 3→4 conviven el bloque `readiness` vivo y el `# readiness:`
  comentado de la plantilla vieja, con `verification_patterns` distintos.
  **Decisión de Roberto: se quita** — es residuo de plantilla, no autoría del
  usuario. La migración lo borra cuando coincide literal con el texto que la
  plantilla envió, y lo deja intacto si el usuario lo tocó (23).
- `loadRepo` con un directorio con nombre de documento da `EISDIR: illegal
  operation on a directory, read`; con un symlink a fichero sin frontmatter da
  `Change is missing its frontmatter block` (11).
- `changeledger log <id> "[note] …"` escribe `` `[note]` [note] … ``. Trivial: no
  prefijar al llamar (31).

Absorbe: **22, 26, 23, 11, 31**.

### CH-8 — La verdad persistente no cita superficie retirada

Clase que ya se fugó dos veces. Arreglo mecánico: extraer toda invocación
`changeledger …` de `.changeledger/specs/**` y `templates/contract/**` y validarla
contra el CLI. Tres invocaciones rotas **hoy**, de ~70 comprobadas:

| sede | invocación | problema |
|---|---|---|
| `.changeledger/specs/architecture.md:85` | `changeledger graduate --pending` | flag inexistente; la forma correcta es `list --pending graduation` |
| `.changeledger/specs/viewer.md:184-186` | `changeledger remove` | **no es comando**; solo export interno en `src/registry.mjs:60` |
| `.changeledger/specs/lifecycle.md:152` | `changeledger status done` | malformado: `status` exige `<id> <status>` |

Además, una **regla huérfana viva**: `124835` retiró del contrato "work performed
without the CLI may diverge" y la dejó sobreviviendo **solo en `README.md` como
narrativa de producto**, sin dueño en ningún fragmento. Es el hallazgo 38
repitiéndose; se le nombra sede o se retira formalmente.

Absorbe: **19, 32, 48** (la clase) y la regla huérfana.

### CH-9 — Aserciones que no pueden fallar

- ~20 sitios en `test/cli.test.mjs` casan prosa del contrato **sin normalizar
  espacios** (`contractText()`, `:38-45`), así que reflowar un fragmento rompe un
  test sin relación. `test/context.test.mjs:2154-2156` sí normaliza (24).
  **Prerequisito de CH-10**: sin esto, Prettier rompe tests ajenos.
- `assert.doesNotThrow(() => approve(id, root))` (`test/cli.test.mjs:157`) es
  **vacuo**: `approve` nunca valida contenido (25).
- Corrección de un dato que teníamos mal: el gate de `assertChangeTextValid` lo
  llama **`validation('pass')`** (`src/commands/agent.mjs:200`), no
  `review('pass')`.

Absorbe: **24, 25**.

### CH-10 — Prettier

Viable ahora que bytes deja de ser la unidad: el padding de tablas cuesta **+66
tokens (+3,2%)** en vez de +2044 bytes en `core.md`. Biome **no formatea
markdown** (issue 3718), así que Prettier entra como `devDependency` adicional.

Dos colapsos distintos, y **solo uno es nuestro**:

1. **El reflow de las tareas del Plan sí es nuestro parser, y CH-1 lo resuelve.**
   605 de 781 tareas con `(CRn)` pasan de 100 chars (máx 644) y el marcador está
   anclado con `$` a la línea física → hoy el reflow **borraría criterios en
   silencio** y `check` seguiría diciendo `valid`. Con la gramática por tags, las
   líneas de continuación unidas y el error nombrado, el parser deja de depender
   del ancho de línea. `.changeledger/**` entra a Prettier **porque** CH-1 hizo eso.
2. **`> [!IMPORTANT]` colapsado no lo arregla ningún parser nuestro.** El que se
   rompe es el **renderizador de GitHub**, que exige el marcador en línea propia.
   Nuestro `check` ya tolera un formateador real —verificado: pasa exit 0 con un
   `AGENTS.md` reflowado por Prettier, gracias a la proyección de equivalencia de
   `src/contract.mjs`—. Dos salidas honestas: rango ignorado de Prettier alrededor
   del alert, o aceptar el render degradado. No hay una tercera.

Fricción a resolver en el mismo pase: `pnpm verify` corre Biome **sin escribir**
mientras `lint-staged` **auto-formatea**, así que una línea larga falla `pnpm
lint` aunque el hook la iba a arreglar. Con Prettier añadido eso se duplica.

**Colisión de punto único descubierta por CH-14, verificada.** La frase de
exenciones de `core.md` mide ahora **135 code points**, la línea más larga del
bloque `## Commits` por 27 sobre la siguiente. El bloque está a **28/28 líneas
físicas**, así que un reflow de Prettier la partiría en dos y el guard dispararía.
Y lo agudo: **el pin de snapshot no puede cazar un reflow** — normaliza `\s+` a un
espacio, así que el hash sale idéntico tras reflowar. El techo de 28 líneas físicas
es por tanto el **único** guard que detendría el reflow. Decidir en CH-0 si ese
techo pasa a tokens o desaparece en favor del techo del core; el bloque es rehén
del ancho de línea, la dimensión que CH-0 retira como unidad.

`depends_on`: **CH-0**, **CH-9**, y **CH-1** para `.changeledger/**`.
Absorbe: **42**.

### CH-11 — Ninguna llamada de red

Decisión de Roberto: nada debería necesitar llamadas externas, y la suite tiene
que ser hermética **por construcción**, no por disciplina.

- **Defecto en producción, no solo en tests**: `src/commands/agent.mjs` llama
  `ownerHandle()` **eagerly en cada transición a `in-progress`**, antes de
  comprobar el guard `!fm.owner`. Registrado por `124836` como "HALLAZGO RESIDUAL
  NO TOCADO, preexistente y fuera de alcance … Candidato a change propio". La
  cadena es `ownerHandle` → `githubLogin` → `execFileSync('gh', ['api','user',…])`.
- **Hermeticidad de la suite**: 36 sitios de `newChange(` en tests, **cero
  desprotegidos hoy**, pero solo por inyección manual. Un test escrito mañana
  lanza red a api.github.com, y **ninguna aserción falla** — la suite se cuelga
  detrás de un portal cautivo. Medido antes: 35 → 107 invocaciones, 18,7s → 24,4s.
- El diseño de resolución (`gh`, y si no `git`) es correcto y **no se toca**.

Absorbe: **47**.

### CH-12 — Solo se valida lo abierto

Regla global decidida por Roberto: **lo cerrado no emite warnings ni errores.**
Sustituye los cuatro parches por un principio, y generaliza la exención por
documento que introdujo `194220`.

- Cuatro invariantes iteran `changes` sin filtrar en vez de `targets`, el conjunto
  filtrado que construye `src/check.mjs:57`: `depends_on references missing
  change`, `related_to references missing change`, `related_to cannot reference
  its own change`, `graduated to a missing spec`. Cero ocurrencias hoy (`✓ 20
  change(s) valid — 203 not validated`): bomba armada, sin detonar.
- **Hay dos predicados de congelado convivientes**, y hay que unificarlos:
  `src/check.mjs:187` tiene su propio predicado más amplio (`CLOSED_STATUSES` ∪
  archivado) que `194220` **no unificó** con el nuevo, y lo dejó registrado.
- `duplicate id` se resuelve sin excepción: el sujeto validado es siempre un
  change abierto, así que un id abierto que choque con uno cerrado sigue siendo
  error **del abierto**.

Absorbe: **12**.

### CH-13 — Los dos bypasses del guard de commit

El guard de `141124` funciona en producción (44), y tiene dos agujeros que su
propia Investigation registró como "residuo conocido y no cerrado":

- **Filesystem case-insensitive**: un path staged a mano con casing distinto
  (`.Changeledger/…`) evade el whitelist de path exacto.
- **`changes_dir: .`** colapsa el prefijo del guard a `/`, así que un documento
  suelto en la raíz del repo no se juzga; solo lo caza después `loadRepo`/`check`.

### CH-14 — El commit operativo tiene forma legal

Descubierto el 2026-07-28 al intentar commitear este documento. El core **permite**
la edición operativa —*"ask the human whether a purely operational, reversible edit
with no persistent truth or observable behavior change should be done directly"*—
pero sus reglas de commit **no dejan forma legal de commitearla**: los únicos
exentos del marcador `[#id]` son los merge commits y `chore(release)`. El contrato
autoriza el edit y prohíbe su commit.

Reproducido:

```
error  (commits): 59d8578 missing [#id] marker: "docs(workflow): record the findings sieve and decisions"
1 error(s) — commits dev..HEAD
```

Precedentes que se colaron en `dev` antes de que la regla se aplicara:
`chore(changeledger): archive pending changes`, `chore(changes): close accepted
work`.

**Decisión de Roberto (2026-07-28)**: añadir la clase de commit operativo a los
exentos del core, junto a merge y `chore(release)`. Cerrar la contradicción de
raíz, no rodearla con un `quick` circular. Y **change propio, no plegado dentro de
CH-0**, con su razón en sus palabras:

> no podemos dejar esa deuda técnica, no puede ser que permitamos cambios
> operativos sin change y no tengamos como commitearlos

Hasta que entre, el acta **vive sin trackear en el árbol**: no se fuerza un commit
ilegal ni se rodea la regla.

**Presupuesto — verificado que no bloquea.** El bloque `## Commits` está a **28/28
líneas, cero margen**, y el core a 193/200, así que añadir una línea falla. Pero la
frase de exención (`core.md:112`, *"only merge commits and `chore(release)` prep
are exempt"*) mide **95 chars** en un bloque cuyas líneas llegan a ~108, y la línea
siguiente es un wrap ragged corto. Extender la frase en el sitio cabe **sin añadir
línea**, así que CH-14 **no depende de CH-0**. Es una posibilidad medida, no un
hecho: lo verifica el change, y si el contenido correcto no cabe, **para y
pregunta**.

### CH-15 — La unidad de commit es el change, no la tarea del Plan

Propuesto por Roberto el 2026-07-28 tras el defecto estructural que salió
implementando CH-4: **delegar el Plan completo en una pasada hace imposible el
commit por tarea**. El delegado no toca git, así que al recibir el informe las
casillas y las notas de Log ya están escritas; separar la unidad que el contrato
exige —código, test, casilla y Log— exigiría reescribir el documento dos veces,
que es la reconstrucción que el propio contrato prohíbe. Se resolvió en CH-4 con
la salida legal (commit combinado con el porqué en el Log), y el revisor lo
confirmó como atribuible al flujo de orquestación, no al implementador.

**El argumento más fuerte es interno.** `core.md` enuncia el test de granularidad
—*"whether the unit will be reverted, referenced or implemented independently"*— y
justifica el commit del documento porque *"a later implementation branch builds on
it, `check --commits` references it by id, and it can be discarded alone"*. Una
tarea del Plan no se revierte sola, no se referencia por id y casi nunca se
implementa aparte. **El change sí.** La regla por tarea contradice el test que su
propio bloque enuncia.

El techo de complejidad es lo que lo hace seguro: si un change es implementable y
verificable en una pasada acotada, el diff está acotado por construcción y el
argumento clásico contra el commit grande —bisectabilidad— pierde casi toda su
fuerza.

**Objeción a la formulación original ("commitear todo solo después del PASS"):**
si nada se commitea hasta el PASS, **el review no tiene artefacto inmutable**. El
revisor inspecciona el working tree y entre su informe y el commit el orquestador
puede editar el entregable sin rastro. No es hipotético: de los cuatro
`fail --retry` de la fase A, **dos eran defectos que introdujo el orquestador
editando el entregable**. Segundo agujero: un `fail --block` dejaría días de
trabajo sin commitear.

**Forma propuesta** — el commit de implementación va **antes** del review:

| clase | cuándo | cuántos |
|---|---|---|
| baseline | el documento aprobado, antes de código | exactamente 1 |
| implementación | el trabajo completo del change, tras el gate local, antes de delegar el review | exactamente 1 |
| corrección | tras `fail --retry`, **sin commitear** hasta que un revisor fresco la confirme | 0..n, se fusiona al confirmar |
| handoff | **obligatorio** si el trabajo se detiene en `blocked` o fin de sesión | 0..1 |

De `n+1` commits a **2, tres con handoff**, y el revisor recibe exactamente
`baseline..HEAD`. La historia por tarea no se pierde: casillas, `Resolved` con
timestamp y notas de Log ya la registran **dentro del documento**, que es su sede
correcta.

Dos consecuencias: el guard de `141124` sube de crítico —un `git add` grande
arrastra intrusos más fácilmente que seis pequeños, y ya cazó uno real—; y
probablemente **libera presupuesto del core**, porque sustituir la regla por tarea
por la regla por change sale neto negativo en líneas y el bloque `## Commits` está
a 28/28.

Toca el mismo bloque que CH-14. No se funden —exención frente a granularidad— y se
secuencian: CH-14 primero. Y si el revisor pasa a recibir `baseline..HEAD` en vez
del working tree, **cambia el prompt del revisor** y se solapa con CH-5a/CH-5b: se
mide entonces, no se supone.

### CH-16 — Cerrar los dos huecos de la declaración operativa

Los dos residuos que CH-14 dejó fuera de su alcance autorizado. **Pendiente de que
Roberto lo autorice**, porque el primero exige una decisión de especificación.

1. **Un id citado dentro de la razón evade la no coexistencia**, con consecuencia
   real y verificada: `ChangeLedger: none — supersedes [#20260711-000001], …` pasa
   el lint **y** `gitRefs()` atribuye ese commit al change, porque grepea `[#id]`
   sobre el mensaje completo. Un commit que declara que ningún change lo cubre
   aparece en las refs de un change: exactamente la ambigüedad que la regla de
   coexistencia existe para evitar. Alcanzable en uso normal — una razón que cite
   un change relacionado es natural. CR3 de CH-14 es explícitamente subject-scoped,
   así que se cumple literalmente. **La decisión que hace falta: ¿pueden las
   razones citar ids en absoluto?** Ya está declarado como residual en
   `.changeledger/specs/git-traceability.md`.
2. **Espacio de ancho cero como razón.** `ChangeLedger: none — <U+200B>` linta
   limpio: U+200B no es whitespace ni para `\S` ni para `String.prototype.trim`.
   Confirmado dos veces, por el review completo y por la ronda de confirmación.
   Adversarial-only: una razón visualmente vacía no surge por accidente.

### CH-17 — El `head` se deriva del techo

Capa de transporte, separada de CH-0 por techo de complejidad. Alcance:

- `head` derivado del **techo de tokens ÷ 10**, redondeado a **múltiplos de 50**, y
  escrito por `register`/`ensureReference`; nunca a mano.
- Tres números: **core 400**, **modos 350** (no 250: `spec` mide 301 líneas y bajará
  a 250 tras CH-0b), **cápsulas 100**. `context <id>` sin `head`.
- **`BOOTSTRAP_VERSION` se queda en 4** (decisión de Roberto, 2026-07-28: la v4 no es
  pública). Consecuencia conocida y aceptada: con la versión quieta y el contenido
  cambiando, `register` calcula estado `replaced` y **reescribe el `AGENTS.md` del
  consumidor sin avisar** — hallazgo 26. Inocuo hoy porque no hay consumidor de v4.
- **Coste asimétrico verificado**: sólo el head del core es caro de mover, porque el
  literal `head -200` vive en el bloque bootstrap publicado (`src/contract.mjs:52`) y
  `test/contract.test.mjs` tiene un test de deriva sobre él. Los heads de modo viven
  en prosa del contrato y se mueven sin coste ni deriva.
- ~~**Hueco que CH-0 dejó abierto**: nada pinnea que `head ≥ base.core.lines`.~~
  **CERRADO por CH-0**, verificado el 2026-07-28: `befd4508` añadió a `124837 CR7`
  la aserción `base.core.lines <= bootstrapHeadCut()`, y el corte se **parsea** del
  bloque `REFERENCE` publicado en vez de copiarse como segundo literal, así que los
  dos no pueden derivar. Queda dentro del alcance de CH-17 el residuo de
  `bootstrapHeadCut()` — destructura `REFERENCE.match(...)` sin comprobar nulo —,
  que CH-19 también reclama: **una sola sede, decidir cuál**.
- `agent-context` no publica segmento de tamaño (B8).

### CH-18 — Higiene del mecanismo de presupuestos

Alcance **reducido** por lo que CH-0 cerró de paso:

- **B5, vivo**: pinnear cada techo por valor. Verificado el 2026-07-28: el **único**
  número pinneado es `base.core.tokens` (`test/context.test.mjs`, `170429 CR4`,
  *"Roberto's number, pinned by value"*). `budgets.yml` declara **11 entradas** —
  `base` ×5, `agent`, `overlays` ×4, `blocks.core-commits` (la que añadió CH-0)— por
  dos dimensiones cada una: **22 números, 21 sin pin**. `170429 CR4` sólo comprueba
  que el contenido de hoy **cabe**, así que subir cualquier techo pasa el gate entero
  en silencio. Deriva: los comentarios de `test/budget-support.mjs` y de `170429 CR2`
  siguen diciendo **"ten ceilings"**. **No es una decisión pendiente** —así lo escribí
  primero y era falso; lo corrigió el revisor de CH-18 y lo verifiqué—: en
  `aa5b8e1f~1` `budgets.yml` tenía exactamente **10** entradas (`base` ×5, `agent`,
  `overlays` ×4) y el propio `aa5b8e1f` añadió `blocks.core-commits` dejándolas en 11.
  El comentario contaba **entradas** y **nació rancio en su mismo commit**. Es falso
  bajo cualquier lectura, y es follow-up de una línea, no decisión humana.
- **B7, vivo**: unificar los dos `emittedLines` (`src/commands/context.mjs` y
  `test/budget-support.mjs`), que discrepan en texto sin salto final.
- **B6, CERRADO por CH-0**: la aserción de convergencia con `maxPasses=1` desapareció
  con el punto fijo iterado. El delegado lo retiró con argumento —existía sólo porque
  el ancho de la cifra de *bytes* cambiaba el total, y una cifra de líneas más ancha
  no puede añadir una línea— y lo reportó en vez de decidirlo en silencio.
- **B4, CERRADO por CH-0**: el techo del bloque `## Commits` vive ahora en
  `budgets.yml` como `blocks.core-commits`.

**Documentado el 2026-07-28 como `20260728-195445`**, tipo `bug` (hay causa raíz y no
hay alternativas de diseño que pesar), `release_impact: none`. Cuatro CR: los techos
pinneados por valor en las dos direcciones (CR1), una entrada nueva que el pin no
cubre falla (CR2), sede única del contador por **identidad de función** y no por
igualdad de resultado (CR3), y la semántica canónica fijada sobre la entrada **sin**
salto final, la única que separa las dos implementaciones (CR4).

Decisión que el documento cierra para que no se re-decida al implementar: la sede
canónica es `src/commands/context.mjs` —que ya exporta helpers a los tests y es el
único sitio de `src/` que mide el tamaño de una captura— y `test/budget-support.mjs`
lo re-exporta, así que **ningún import de test cambia**. Un módulo propio para una
función de tres líneas se descartó como sobre-ingeniería.

Descartado por vacuo (hallazgo 28): un CR que afirmara que la cifra publicada en la
línea `BEGIN` no se mueve. Ya lo cubre la aserción viva que compara
`publishedOccupancy(cli).lines` con `emittedLines(cli)`, así que no podría fallar.

## 5. Excluido a propósito — no re-litigar

Registro de decisiones ya tomadas, del barrido de las 18 Logs:

| change | qué se excluyó |
|---|---|
| `124836` | campo `author` separado ("queda posible más adelante sin romper nada") |
| `124836` | quitar el guard `!fm.owner`; se acepta que el owner quede en el redactor salvo reasignación manual |
| `124836` | migración/fallback para changes preexistentes sin owner |
| `124833` | mantener `--have` como no-op deprecado (regla de no-residuo) |
| `124834` | registrar el hash v3 en `LEGACY_CONTRACT_HASHES` (verificado muerto) |
| `124835` | reordenar los bloques 10/11 del core |
| `141124` | guard que bloquea delete manual o `git mv` de un doc staged, sin escape hatch — "comportamiento aceptado, no un defecto" |
| `194220` | extender el resumen `--json` con el conteo "not validated" |
| `194233` | un único límite global en vez de por dimensión |
| `194234` | menciones de commit incidentales en `release.md`/`handoff.md`/`delegation.md` |
| `141122` | `target_patterns` con backtick desnudo por defecto (falsificaría el gate) |
| — | worktrees de agente, descartados por sus propios problemas conocidos |
| — | seguimiento del **coste por change**: Roberto ya lo tiene pensado, no volver a proponerlo. `reviewRetryCount` en `src/metrics.mjs` es el punto de partida |
| — | el defecto de `migrateToV2` (`types.quick` con `[request, log]` hardcodeado): "todos están en la V3", no crear change salvo que reaparezca |

**Candidato registrado, sin change**: un lint que cuente commits contra tareas del
Plan completadas — `124837` lo dejó como "merece medirse más adelante, pero es
superficie nueva".

## 6. Medidas actuales (2026-07-28)

Medido con `gpt-tokenizer` sobre la salida real del CLI.

| pack | tokens | bytes | líneas emitidas |
|---|---|---|---|
| `base.core` | **2573** | 11728 | 193 |
| `base.spec` | **3118** | 13664 | 301 |
| `base.implement` | **1701** | 8205 | 168 |
| `base.review` | **711** | 3344 | 69 |
| `base.release` | **418** | 2018 | 38 |
| `agent-prompt investigation` | 433 | 1914 | 45 |
| `agent-prompt implementation` | 478 | 2211 | 46 |
| `agent-prompt review` | 398 | 1794 | 40 |
| `agent-prompt post-review` | 414 | 1820 | 41 |
| `agent-context investigation` | 198 | 920 | 20 |

Contra los techos decididos: `core` a 4000 tiene **1427 tokens de margen (+55%)**;
`spec` a 2500 **excede en 618** (recorte del 20%); el resto entra con holgura.

Referencia del mecanismo viejo durante la migración: `base.spec` 301/310 líneas y
13664/13700 bytes (**63 bytes**); `overlays.in-validation` 1953/2040 bytes (**87
bytes**); bloque `## Commits` de `core.md` **28/28 líneas, cero margen**.

## 7. Orden propuesto

Hechos y archivados: **CH-4**, **CH-14**, **CH-0**, **CH-18**, **CH-17**, **CH-15**.
Descartado: **CH-20**. Orden restante:

```
CH-2 → CH-0b → CH-1 → CH-19 → CH-5a → CH-5b → CH-11 → CH-12
    → CH-9 → CH-10 → CH-3 → CH-13 → CH-16 → CH-8 → CH-6 → CH-7
```

**CH-2 sube al frente el 2026-07-29, pendiente de que Roberto lo confirme**, con la
medición del coste del flujo detrás: el retry de CH-15 costó 316k y su causa fue un
criterio aprobado que afirmaba algo falso. Quedan 15 changes de prosa normativa; cada
criterio no falsable que se apruebe paga ese precio más tarde.

**CH-20 descartado**, así que no hay vía paralela en el contrato: el paralelismo, cuando
se quiera, son **varios worktrees con un change cada uno** — modelo que la regla actual
ya permite y que no necesita cambio alguno. Coste por worktree: `pnpm install`.

**Reordenado el 2026-07-28 por decisión de Roberto**, con el dato que lo motiva:
`core` está a **193/195 líneas** contra **2577/4000 tokens**. La dimensión que
bloquea es líneas, con 2 de margen, mientras 1423 tokens quedan inutilizables. CH-0
movió la unidad a tokens y el alivio nunca llegó porque el techo de líneas siguió a
mano. **CH-17 es el cuello de botella de todo lo demás**: casi todos los changes que
quedan son prosa normativa, y hoy cada uno negocia contra 2 líneas. Derivado, el core
pasa a ~106 líneas de margen real.

**CH-15 sube al segundo puesto** y su bloqueo por CH-0b queda retirado: su
`depends_on` está vacío en el ledger, el bloque `## Commits` tiene 101 tokens de
margen, y el change es sustitutivo, así que debería salir neto negativo en líneas. Se
mide al implementarlo, no se supone.

Decisiones de Roberto del 2026-07-28 sobre el propio flujo:

- **Más tipos de change**: se estudia después, no ahora.
- ~~Relajar "one change at a time"~~ → **CERRADO sin cambio de contrato** el 2026-07-29:
  CH-20 (`20260729-001217`) se redactó y se **descartó** el mismo día. El paralelismo es
  por worktree, un change en cada uno, que la regla actual ya permite. Ver CH-20 abajo.

Razón: CH-4, CH-5a y CH-5b son baratos y atacan el coste directamente — CH-4 deja
de fabricar veredictos falsos, CH-5a deja de mandar auditorías completas por
defecto, CH-5b mata los falsos positivos y las rondas por corrección floja.
**CH-14 va segundo** porque es diminuto, independiente, no depende de CH-0 y
desbloquea el commit de esta acta. CH-11 y CH-12 son defectos limpios e
independientes. CH-0/CH-0b desbloquean el techo que hoy frena cualquier prosa
normativa nueva. CH-1 habilita CH-10, y CH-9 es prerequisito de CH-10 porque sin
normalizar espacios Prettier rompe tests ajenos. Después la cadena causal: gate
del draft → post-fallo.

## 8. Trazabilidad — mapa hallazgo → change

Existe para que ningún hallazgo se quede huérfano otra vez: el 31 se perdió en la
primera pasada de esta criba y solo apareció al revisar el mapa.

| hallazgo | destino |
|---|---|
| 1, 2, 3, 16, 28, 35, 37, 40, 55 | CH-2 |
| 4, 5, 13, 30, 41, 51 | CH-1 |
| 6 | CH-5a |
| 7 | descartado |
| 8, 9, 52, 53 | CH-3 |
| 10, 14, 15, 17, 18 | CH-6 |
| 11, 22, 23, 26, 31 | CH-7 |
| 12 | CH-12 |
| 19, 32, 48 | CH-8 (clase) |
| 20, 45, 54, 56, 57 | CH-5b |
| 21, 46, B5–B8 | CH-0 |
| 24, 25 | CH-9 |
| 27, 29, 33, 34, 39, 43 | resueltos o caducados |
| 36 | humano |
| 38 | escrito en `AGENTS.md`; cara opuesta en CH-0; regla huérfana en CH-8 |
| 42 | CH-10 |
| 44, 49, 50 | confirmaciones |
| 47 | CH-11 |
| bypasses del guard de commit | CH-13 |
| 4 clasificaciones falsas de `124835` | CH-2 |
| `ownerHandle` eager en `in-progress` | CH-11 |
| dos predicados de congelado | CH-12 |
| regla huérfana "work performed without the CLI" | CH-8 |
| `delegation` duplica doctrina del core, y se paga en dos packs | CH-0b |
| el commit operativo no tiene forma legal | CH-14 |

## 9. Estado del ledger y registro de ejecución

Los 18 de la fase A **archivados** el 2026-07-28 (`chore(ledger): archive the
graduated initiative`, con los 18 marcadores en el body). Luego el trío cerrado
—CH-4, CH-14, CH-0— también archivado (`98db5f79 chore(ledger): archive the closed
trio`). Estado leído por CLI el **2026-07-29**: `list` da **dos** changes abiertos,
los drafts CH-3 (`20260722-124655`) y CH-19 (`20260728-194157`); `check` da
`0 error(s), 4 warning(s) — 2 change(s), 230 not validated`, y los 4 warnings son
todos de CH-19 (el hallazgo 41). Rama única `change/workflow-core-drafts`.

| change | id | estado | nota |
|---|---|---|---|
| CH-4 | `20260722-124656` | **archivado** (2026-07-28) | graduado a `lifecycle`, aceptado por Roberto. Ya no es reabrible: trabajo posterior necesita change nuevo |
| CH-14 | `20260728-151336` | **archivado** (2026-07-28) | graduado a `git-traceability`. 5 CR, 3 tareas, **un commit por tarea**; review PASS con ~50 intentos de escape; `\S` fijado con ronda de confirmación |
| CH-15 | `20260728-164620` | **archivado** (2026-07-29) | unidad de commit = change; graduado a `git-traceability`. 7 CR, review PASS tras **1 ronda de `fail --retry`** por cinco defectos de prosa, tres de ellos causados por mi redacción de CR7. **CR7 enmendado** en la corrección. El ciclo costó **~614k**, el 51% en el retry — ver la medición del coste del flujo abajo |
| CH-0 | `20260728-170429` | **archivado** (2026-07-28) | 7 CR; review `fail --retry` con 2 defectos, corregidos y confirmados; graduado a `contract-discovery` |
| CH-19 | `20260728-194157` | **`draft`, bloqueado** | guardas recursivas; **no aprobable** hasta CH-1, ver arriba |
| CH-17 | `20260728-212043` | **archivado** (2026-07-29) | **priorizado por Roberto** para desbloquear el presupuesto; graduado a `contract-discovery`. Las 11 entradas derivadas, `base.core` 195 → **400**, `head` a 400 por igualdad, `agent` 350 → **1250** aplicado también a `agent-prompt`, `base.spec` marcado andamio. 7 CR, review PASS sin retry. **Resultado: margen real de prosa del core de 2 líneas a ~106** |
| CH-20 | `20260729-001217` | **`discarded`** (2026-07-29) | relajar un change a la vez; descartado el mismo día por decisión de Roberto en favor de un change por worktree, que la regla actual ya permite sin tocar contrato |
| CH-18 | `20260728-195445` | **archivado** (2026-07-28) | tipo `bug`; 4 CR, 3 tareas, review **PASS** con mandato acotado, **cero rondas de retry**. 6 commits: baseline, 2 de tarea, handoff, veredicto, cierre. Graduado a `contract-discovery`. `pnpm verify` EXIT=0, 923/923 |
| CH-21 | `20260729-111349` | **`done`, graduado** (2026-07-29) | la unidad de commit es la **selección resuelta**; corrige lo que CH-15 shipeó deformado. Tipo `bug`, 7 CR (CR7 añadido en vuelo con autorización), 6 tareas. Graduado a `git-traceability`. **Los 7 CR pasaron en la primera review; 3 rondas de `fail --retry`, las tres por mi prosa y mi Log, ninguna por el entregable.** Coste **~794k**, el mayor de la iniciativa — ver §12 |
| CH-16 | — | pendiente de autorizar | dos huecos que CH-14 dejó fuera de alcance, ver arriba |
| CH-3 | `20260722-124655` | `draft` | **no aprobar**: su contador contradice la clasificación por clase de defecto, y excede el techo de complejidad. Reescribir y partir |
| resto | — | sin documentar | siguen el orden de §7 |

### CH-19 — Las guardas del contrato barren todo subfragmento

`20260728-194157` — **`draft`, BLOQUEADO por el hallazgo 41**.

Tres guardas exhaustivas-negativas de `test/context.test.mjs` —`194234 CR4`,
`124837 CR1`, `124837 CR8`— enumeran sólo el nivel superior de
`templates/contract/`, así que son ciegas a **8 de 20** fragmentos, los de
`agent-contexts/` y `agent-prompts/`, versionados y publicados. Esas guardas **son**
el mecanismo del hallazgo 38: garantizan que retirar prosa normativa no pierde nada.
Con un 40% de los ficheros fuera de su barrido, dan una garantía que no tienen.

**Explotable, probado**: un revisor inyectó en
`templates/contract/agent-contexts/investigation.md` la frase retirada que
`124837 CR1` vigila y la suite siguió en **79/79 verde**.

El arreglo no es añadir el flag en tres sitios: es **una sola sede** para la
enumeración, porque cuatro copias de la misma son lo que dejó tres atrás cuando la
cuarta se corrigió en CH-0. Lleva dentro el residuo de `bootstrapHeadCut()`, que
destructura `REFERENCE.match(...)` sin comprobar nulo y lanzaría `TypeError` en vez
de nombrar la ausencia del corte.

**Por qué está bloqueado, y es el mejor argumento para CH-1 que ha aparecido.** Todo
su entregable vive en `test/context.test.mjs`, y `test/**` es patrón de
**verificación**, no de **target**. Así que **ninguna** de sus tareas pasa readiness:
4 warnings en `draft` que serían **errores en `approved`**. No hay tarea de `src/` ni
`templates/` con la que fusionarlas —el apaño que usaron `194233` y `124837`— porque
el change es puramente endurecimiento de guardas. Las tres salidas conocidas son
todas malas: `test/**` en `target_patterns` vuelve vacío el requisito para todo el
repo; `(support)` en todo es el bypass que desactiva la trazabilidad; y bajar el tipo
a `chore` deja cero diagnósticos.

**Un change cuyo entregable es enteramente una guarda de test no tiene hoy forma
legal de documentarse con criterios.** Eso es el hallazgo 41 en su forma más pura, y
CH-19 espera a **CH-1** (gramática del Plan por tags), que separa el campo de target
del de verificación y mata la clase.

### CH-20 — DESCARTADO: el paralelismo es por worktree, no por relajar la regla

`20260729-001217` — **`discarded`** el 2026-07-29, el mismo día que se redactó.

**Decisión de Roberto**: *"es mas limpio un change a la vez por worktree, si se quieren
solucionar varias a la vez serian varios worktrees"*. Y es la salida más limpia por una
razón fuerte: **ese modelo cumple literalmente la regla que ya existe** —*"One change at
a time, on a non-main branch"*—, así que el paralelismo se consigue **sin tocar el
contrato**. CH-20 queda innecesario, no equivocado.

Corrección a lo que este acta decía: la exclusión de §5 era de worktrees **de agente**
(el `isolation: worktree` del orquestador), no de worktrees creados a mano. No había
decisión previa que contradijera a Roberto.

**Coste real del modelo, verificado el 2026-07-29 y no heredado de notas:** un worktree
nuevo **no tiene `node_modules`**, así que el CLI ni arranca —
`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander' imported from
<worktree>/bin/changeledger.mjs`. Requiere `pnpm install` por worktree antes de poder
usar `changeledger` o el gate. Eso explica el viejo reporte de *"`changeledger commit`
sale con exit 1 sin diagnóstico dentro de worktrees"*, que estaba anotado sin
diagnosticar. Dos cuidados más, conocidos: los worktrees van **fuera** del repo, o su
`biome.json` anidado rompe el lint global con *"nested root configuration"*; y la
higiene de `GIT_DIR`/`GIT_WORK_TREE` en hooks anidados, saneada en `src/git.mjs`.

Los hallazgos verificados que CH-20 contenía **sobreviven aquí** porque siguen siendo
verdad sobre el contrato, aunque no se actúe sobre ellos:

- `core.md` gobierna la concurrencia **dos veces con dos unidades**, a 18 líneas: la 38
  por superficie de escritura, la 56 por conteo de changes.
- La regla de conteo **no la impone nada**: ni `src/lifecycle.mjs` ni `src/check.mjs`
  cuentan changes en curso.
- `src/commands/commit.mjs` ya trata varios en curso como estado legítimo a desambiguar:
  `Ambiguous: N changes are in-progress (…); pass --id explicitly`.
- La regla vive en **dos sedes**, `core.md:56` e `implement.md:24`, y la segunda ya
  contiene una relajación parcial para `in-validation`. Sigue siendo clase 19/48.

Consecuencia de orden: **la vía paralela se cierra**. CH-6, CH-7, CH-11, CH-12 y CH-13
vuelven a la secuencia, y quien quiera solaparlos abre worktrees.

**El argumento decisivo es interno al fragmento, y es la misma forma que usó CH-15.**
`core.md` gobierna la concurrencia **dos veces con dos unidades distintas**, a 18 líneas
de distancia: la línea 38 por superficie —*"One owner per write surface; concurrent
subagents must not share files"*— y la línea 56 por conteo —*"One change at a time"*—.
La regla de superficie es la correcta y ya está escrita; la de conteo es una
aproximación conservadora que nunca se revisó.

Verificado antes de redactar:

- **Nada la impone.** Ni `src/lifecycle.mjs` ni `src/check.mjs` cuentan changes en
  curso; `assertTransition` valida la arista, no la multiplicidad. Prosa sin
  verificador, así que relajarla no pierde garantía mecánica.
- **El CLI ya está construido para varios en curso.** `src/commands/commit.mjs` falla
  con `Ambiguous: N changes are in-progress (…); pass --id explicitly` — no dice "esto
  es inválido", dice "desambigua". El código anticipó el estado que la prosa prohíbe.
- **Dos sedes**, `core.md:56` e `implement.md:24`, y la segunda ya contenía una
  relajación parcial para `in-validation`. Sede elegida: el core.

**Sin mecanismo de solapamiento a propósito.** Un verificador que cruzara targets se
apoyaría hoy en el parser posicional de `src/task.mjs`, que pierde targets en silencio;
un falso negativo aquí son dos escritores sobre el mismo fichero. La disjunción la
declara el orquestador y queda registrada; el verificador es follow-up tras CH-1.

**`depends_on: 20260728-212043`** — dependencia real, no preferencia de orden: añade
prosa a un core que está a 193/195 líneas.

**Interacción a resolver antes de aprobar CH-20 y CH-15 juntos**: con changes
concurrentes en la misma rama sus commits se interleavan, así que el `baseline..HEAD`
que CH-15 quiere dar al revisor deja de contener sólo el change revisado. La salida ya
está construida —`gitRefs()` atribuye commits por marcador `[#id]`— y definirla es de
CH-15, no de CH-20.

### El coste del flujo, medido — y la conclusión que cambia el orden

Observación de Roberto el 2026-07-29, sobre CH-15: *"1 hora tomo modificar prosas en 2
.md esto claramente revela que el proceso esta funcionando mal"*. Es correcta. Medido
sobre las tres implementaciones del 2026-07-28/29:

| change | entregable | tokens de delegado | rondas de retry |
|---|---|---|---|
| CH-18 | ~74 líneas de test + 8 de `src` | ~243k | **0** |
| CH-17 | 11 techos, 2 literales publicados, 6 ficheros | ~307k | **0** |
| CH-15 | prosa en 2 `.md` + 2 suites | **~614k** | **1** |

Desglose de CH-15: implementación 170k, review 128k, **corrección 208k, confirmación
108k**. El ciclo de retry son **316k, el 51% del total**, y ~20 de los ~52 minutos de
reloj de delegado.

**La causa del retry no fue el implementador: fueron mis criterios.** Tres de los cinco
defectos nacen de la redacción de CR7, que afirmaba que el documento del change *"es el
único delta esperado"* — falso, porque durante la ventana el árbol lleva también el
código y los tests. El revisor fue **el primero en falsear ese criterio**.

Eso es **literalmente el eslabón 1 del diagnóstico de §2**: *"Si nadie falsea el
documento antes de implementar, el primero que prueba el change de verdad es el
revisor."* CH-15 es la instancia más cara registrada de esa clase, y **CH-2 es el change
que la cierra** — hoy en el puesto 11 del orden.

Contraste que lo confirma: CH-18 y CH-17 salieron con **cero retries**, y en los dos los
criterios se escribieron sobre cifras **medidas antes de aprobar** (densidades, techos,
conteos de fixture). CH-15 fue el único cuyo criterio afirmaba un hecho sobre el estado
del árbol que nadie había comprobado.

**Multiplicador que hay que entender para priorizar bien:** un retry cuesta **dos**
cargas obligatorias de delegado —la corrección y una confirmación con revisor fresco—,
no una. Así que prevenir un retry vale el doble que abaratar cualquier ronda suelta.
Optimizar el mandato del review (CH-5a) reduce una ronda; el gate de salida del draft
(CH-2) elimina el par.

**Recomendación de orden, para decisión de Roberto: CH-2 al frente.** El resto de la
iniciativa son 15 changes de prosa normativa, y cada criterio no falsable que se apruebe
paga 316k más tarde.

### Hallazgos nuevos del 2026-07-29, del ciclo de CH-15

1. **Tras `review fail --retry` el revisor de confirmación no puede cargar su cápsula.**
   El change vuelve a `in-progress`, y `changeledger agent-context review <id>` falla con
   `Error: role review requires change status in-review; got in-progress`. Reproducido.
   El contrato **manda** que un revisor fresco confirme la corrección, pero **ningún
   fragmento nombra el paso de volver a `in-review` antes de delegarla**, y
   `changeledger review <id> pass` también lo exige. El revisor de esta ronda lo reportó
   y cayó al bootstrap general. Error de proceso del orquestador habilitado por un paso
   que el contrato no nombra. **Candidato a change propio.**
2. **El contrato no tiene regla que gobierne enmendar un criterio aprobado.** Hoy se
   apoya en una regla registrada en este acta, no en `templates/contract/`. El criterio
   que el revisor propuso, y que adopto, es mejor que el que yo invoqué: una enmienda
   post-aprobación es segura cuando es **estrictamente más fuerte** —ensancha el
   conjunto exigido o añade cláusulas—, porque así no puede convertir un fallo en un
   pass. Ése es el test que separa corregir de blanquear. Hueco de exigibilidad.
3. **Una guarda contra comentarios falsos puede ser ella misma vacua, y lo fue.** El
   implementador escribió una aserción que comparaba por substring sobre todo un bloque
   de comentario, de modo que **la propia frase que explicaba la omisión satisfacía la
   aserción**. Lo descubrió corriendo el mutante, no razonando, y la reforzó delimitando
   la lista con marcadores. Es la clase del hallazgo 43 dentro del mecanismo que vigila
   la clase del hallazgo 38.
4. **Sexta instancia del mismo error de prosa, una capa más abajo.** El comentario del
   pin que documentaba la corrección de H1 decía *"the change document **alone** stays
   modified"* — el mismo enunciado falso que estaba arreglando.

### CH-15 shipeó más estrecho que la decisión — corrección de Roberto (2026-07-29)

El core vigente dice *"**Implementation**: exactly one, the change's complete work"* y
*"never one per transition and **never one per Plan task**"*. Roberto corrigió el
2026-07-29 que **eso no era la decisión**:

> no es un commit unico por implementacion, hablamos de que no se debe delegar tarea por
> tarea a un subagente, sino que se debe medir la completidad y si estan relacionadas o
> no para delegarlas en grupo, todas o individuales, cuando se resuelve una seleccion se
> hace commit de lo resuelto, no esperas a que todas esten resueltas.

Los dos modelos difieren en el número de commits de implementación: el shipeado exige
**uno**, la decisión da **uno por grupo de delegación resuelto**. Lo que se decidía era
la **unidad de delegación** —medida por completitud y acoplamiento, que es exactamente
lo que §CH-5b ya había concluido— y el commit **sigue** a esa unidad, no la sustituye.

**No rompe lo que CH-15 protegía.** El revisor sigue recibiendo un `baseline..HEAD` fijo:
el rango se cierra al commitear el último grupo, antes de delegar el review. El
"exactly one" fue un apriete de redacción mío, no una consecuencia del argumento — el
test de granularidad del propio core (*"whether the unit will be reverted, referenced or
implemented independently"*) lo satisface un grupo de delegación resuelto igual que un
change entero, y mejor: un grupo se revierte solo.

Consecuencias:

- **CH-15 está archivado**, así que esto es un **change nuevo**, no una reapertura.
- Afecta `templates/contract/core.md` (bloque `## Commits`) y la spec
  `.changeledger/specs/git-traceability.md`, donde la regla se graduó. Es la clase 19/48
  otra vez: la misma verdad en dos sedes, las dos con el enunciado estrecho.
- La prosa correcta no dice un número: dice que la unidad de commit **es la selección de
  trabajo resuelta**, que se commitea al resolverse y no se acumula, y que el rango del
  review se cierra antes de delegarlo.
- Es el primer caso de la iniciativa en que **una decisión humana llegó al contrato
  deformada por mi redacción y pasó review, graduación y aceptación** sin que nadie lo
  cazara. Ninguna herramienta puede: el revisor verifica el documento contra el código,
  no contra la intención.

### Hallazgos recuperados de memoria (2026-07-29)

Cinco cosas verdaderas que vivían sólo en mis notas de sesión y no en este acta.
Recuperadas al barrer las 27 memorias contra el acta a pedido de Roberto.

1. **Un commit multi-id u operativo no admite ninguna otra línea de body.**
   `MULTI_BODY_RE` y `NONE_REASON_RE` (`src/git.mjs`) anclan `^…$` sobre el **body
   entero trimeado**, así que cualquier línea extra cae en `malformed ChangeLedger body`.
   Consecuencia: un commit que declara dos changes, o un commit operativo, **no puede
   llevar párrafo de "por qué" ni trailer** (`Co-Authored-By`, `Signed-off-by`). Un
   commit de un solo id sí, porque la rama del marcador en subject sale antes. Choca con
   la convención de commits que pide body cuando el porqué no es obvio. Sede natural:
   **CH-16**, que ya posee esa gramática.
2. **`check --commits` valida la forma del marcador, no su correspondencia con el
   contenido.** Caso registrado el 2026-07-26: un commit con marcador `[#131603]` acabó
   conteniendo los documentos de **seis** changes y el lint lo dio por válido. El guard
   de `141124` shipeó después y debería cazarlo. **No verificado.** Es una comprobación
   de una tarde, no un change, y su resultado decide si CH-13 lo absorbe.
3. **Trampas de worktree que este acta no recogía.** La sección de CH-20 registra tres
   costes (`pnpm install`, `biome.json` anidado, `GIT_DIR` saneado en `src/git.mjs`).
   Quedan fuera, todas observadas: los worktrees de agente nacen de `main`, no de la rama
   del orquestador; un delegado puede correr git en el checkout principal; los helpers
   `git()` de las suites heredan `GIT_INDEX_FILE`/`GIT_DIR` bajo el pre-commit, así que
   una suite nueva **falla sólo bajo el hook** y sale verde en `pnpm verify` (patrón
   canónico en `test/commit.test.mjs`); y un revisor de contexto limpio exige el change
   en `in-review` **en el árbol que él ve**. Dejan de ser anécdota ahora que el
   paralelismo *es* por worktree.
4. **Cumplimiento del marcador en los repos consumidores.** Medido el 2026-07-11 sobre
   tres repos: **80%** spec-ledger (169 changes), **~53%** backend-laravel (97), **~20%**
   ionic-app (59), con tres convenciones compitiendo; y 59 retries de review sobre 32
   changes en spec-ledger. Este acta mide sólo este repo. Es la evidencia externa más
   fuerte que existe para las reglas de commit y para el coste del ciclo.
5. **Un documento de change commiteado sólo en su rama rompe `check` en las hermanas.**
   `check` valida que todo id referenciado exista en el working tree, así que un draft
   untracked que lo cite en `depends_on` falla el pre-commit en otra rama. CH-12 arregla
   el lado del change **cerrado**, no éste. Relevante justo ahora: varios worktrees son
   varias ramas.

### Hallazgos nuevos del 2026-07-28 (noche), midiendo para CH-17

1. **`agent-prompt` no está acotado por nada.** La entrada `agent` de `budgets.yml`
   (350 tokens / 60 líneas) la aplica `144327 CR8` en `test/agent-context.test.mjs`
   sobre `buildAgentContext`, es decir sobre las cápsulas de **contexto**. Las cuatro
   cápsulas de **prompt** miden **433, 478, 398 y 414 tokens** —las cuatro por encima
   de 350— y `pnpm verify` pasa en verde, porque **ningún test las mide contra un
   techo**. La tabla de §6 de este acta las listaba juntas como si compartieran techo.
   Es un techo que no puede fallar para la mitad de lo que se creía que cubría.
   **Decisión pendiente de Roberto**: ¿comparten techo con `agent-context` o tienen el
   suyo? No es arreglo mecánico. Fuera del alcance de CH-17 a propósito.
2. **Los techos derivados de los overlays y de `agent` caen por debajo de los
   actuales**: `blocked` 50 vs 84, `in-validation` 45 vs 54, `done` 100 vs 108,
   `discarded` 20 vs 48, `agent` 35 vs 60. Derivarlos puede apretar de verdad, y
   medirlos exige montar un repo de fixture con un change por status. CH-17 los deja
   fuera **por no medidos**; derivar sin medir sería afirmar sin verificar. Follow-up
   con su propia medición.
3. **El hallazgo 41 golpeó tres veces en una sola sesión**: al redactar el Plan de
   CH-18 (tareas envueltas), al redactar el de CH-17 (tarea de CR3 cuyo entregable es
   sólo una guarda), y sigue bloqueando CH-19. Es el argumento acumulado más fuerte
   para CH-1.

### Hallazgos del 2026-07-28 (tarde), sin change asignado

1. **`.changeledger/specs/contract-discovery.md` documenta los bytes y el formato
   `lines/bytes` de la línea BEGIN como verdad vigente.** Cuarta aparición hoy de la
   clase 19/48, y actualización obligatoria al graduar CH-0. Las tres anteriores:
   `lifecycle.md` con el orden viejo del gate (CH-4), `git-traceability.md` con las
   dos exenciones viejas (CH-14), y esta.
2. **`test/cli-bin.test.mjs:370` (`lines.length <= 60`) es el único techo de tamaño
   hardcodeado que queda** en el repo. Fuera de la clase a propósito: acota el help
   del CLI, no una captura de contexto.
3. ~~**Nada pinnea `head ≥ base.core.lines`.** → CH-17.~~ **CERRADO por CH-0**
   (`befd4508`, `124837 CR7`). Ver CH-17.
4. ~~La aritmética del resumen de `check` no cuadra.~~ **NO ES DEFECTO — explicado.**
   `check` dijo `3 change(s), 224 not validated` (suma **227**) al arrancar y
   `4 change(s), 226 not validated` (suma **230**) después, con un solo documento
   creado por mí. La causa no está en el CLI —`checkRepo` hace
   `notValidated = scoped.length - targets.length`, así que la suma es idénticamente
   `changes.length`—: **entró un merge externo en la rama durante la sesión**,
   `c1565036 Merge branch 'change/viewer-ledger-improvements'`, que trajo dos
   documentos de change (`20260728-141643-viewer-board-ux`,
   `20260728-141859-ledger-document-browser`) además de trabajo de viewer. 227 + 2 + 1
   = 230. Mi baseline era el `git log` del arranque, ya caducado. **No hay change que
   crear**; la lección es de método y va abajo.

### Tres errores del orquestador en CH-0, todos de la misma familia

Roberto los señaló y atribuyó a la longitud de la sesión (~600k). La forma les da
la razón: ninguno es de razonamiento, los tres son **actuar sobre el modelo mental
en vez de sobre el estado real**.

1. **`git checkout --` sobre un fichero con trabajo sin commitear.** Restauraba un
   mutante y en realidad revirtió `budgets.yml` al baseline, **destruyendo el trabajo
   del delegado** (23 tests rojos). Restaurado verbatim. Es la regla *restaurar
   editando, nunca con git* que se exige en cada prompt de delegación.
2. **Marcar como hecha una tarea que no lo estaba.** El orden del Plan cambió al
   insertar tareas y se marcó por el orden mental. Cazado sólo porque se imprimió el
   Plan después; sin eso el ledger habría afirmado trabajo inexistente.
3. **Enmendar criterios y olvidar las tareas.** CR2 pasó a apuntar a `AGENTS.md` y la
   tarea 1 siguió diciendo "el fragmento del contrato". El delegado siguió el
   criterio; si hubiera seguido la tarea, habría añadido prosa a un core con 2 líneas
   de margen.

**Contramedida**: releer el estado por CLI o por fichero **inmediatamente antes** de
cada mutación —no confiar en lo leído hace veinte turnos— y no usar `git checkout`
en un árbol con trabajo vivo.

### Dos errores más del orquestador, 2026-07-28 (CH-18), misma familia

1. **La rama tiene un escritor externo, y mi baseline era el `git log` del arranque.**
   Durante la sesión entró `c1565036 Merge branch 'change/viewer-ledger-improvements'`
   desde otra identidad (los push a `origin` los hace `rarc88`; esta sesión es
   `raruiz-hiberuscom` y **no tiene permiso de escritura**: `403`). Al reescribir un
   commit hice `git reset --hard` contra el que **creía** que era el padre —el último
   commit del arranque— y **descarté el merge**: 24 ficheros, 3673 líneas de trabajo
   ajeno fuera del árbol. Recuperado íntegro porque había creado
   `backup/pre-amend-9c80b0e` **antes** de tocar la historia. La contramedida de
   arriba, aplicada a git: el padre se **lee** (`git rev-parse <commit>^`), no se
   deduce del log de hace veinte turnos.
2. **Escribí una verificación que no podía fallar, y me la creí.**
   `git diff --stat A B && echo "IDENTICAL"` imprime `IDENTICAL` **siempre**, porque
   `git diff` sin `--exit-code` sale 0 aunque haya diferencias. Afirmé "trees
   identical" con 3673 líneas de diferencia delante. Es el hallazgo 43 —aserción
   vacua— cometido por mí, en la comprobación que existía justo para impedir la
   pérdida. La forma correcta es `git diff --quiet A B` y ramificar sobre su código de
   salida.

Y una fricción de herramienta, no un error de estado: **escribí a mano el body del
commit operativo** en vez de usar `changeledger commit --no-change`, y la razón se
envolvió a dos líneas físicas. El guard de CH-14 lo rechazó —
`malformed ChangeLedger body`— y tenía razón: multipárrafo fue una de las ~50 rutas de
escape que su revisor probó. Nota de diseño que esto expone: la única forma legal es
una **sola línea**, así que una razón de más de ~72 caracteres no se puede envolver al
estilo git convencional. El flag lo compone bien; a mano es una trampa.

**Cómo quedó la exención (CH-14).** Un commit queda exento del marcador cuando su
body es exactamente `ChangeLedger: none — <razón>` con razón no vacía. La frase de
`core.md` pasó de 95 a 135 code points **sin añadir línea**: bloque `## Commits`
sigue en 28/28, core `193/200` líneas y `11770/12000` bytes.

**La propiedad de diseño aguantó una batería real.** El revisor intentó ~50 rutas
de escape —espacios, mayúsculas, substring, multipárrafo, CRLF, homoglifos U+2013
U+2212 U+2015, cinco modos de cleanup de git, diez variantes de argv— y **ninguna
alcanzó la exención sin la declaración literal**. Ningún modo de cleanup fabricó la
exención a partir de texto que no la contuviera ya.

**Dos residuos, fuera del alcance autorizado → CH-16:**

1. **Marcadores dentro de la razón evaden la coexistencia**, con consecuencia real:
   `ChangeLedger: none — supersedes [#20260711-000001], …` pasa el lint **y**
   `gitRefs` atribuye ese commit al change, porque grepea `[#id]` sobre todo el
   mensaje. Un commit que declara que ningún change lo cubre aparece en las refs de
   un change: exactamente la ambigüedad que la regla de coexistencia evita. CR3 tal
   como se aprobó es subject-scoped, así que se cumple literalmente. Cerrarlo exige
   decidir **si las razones pueden citar ids en absoluto**.
2. **Espacio de ancho cero como razón.** `ChangeLedger: none — <U+200B>` linta
   limpio: U+200B no es whitespace ni para `\S` ni para `String.trim()`.
   Adversarial-only, confirmado dos veces.

**Dos lecciones de método, ambas mías:**

- **Escribí en el Log un mecanismo falso** —que el `\S` de `NONE_REASON_RE`
  rechazaba la razón solo-espacios— corrigiendo al delegado con una corrección
  igual de errónea. Lo hace `body.trim()` en `src/git.mjs:212`. Mi propio test
  llevaba el `.trim()` dentro y atribuí el resultado al mecanismo equivocado. La
  conclusión era correcta; el mecanismo, no. Corregido en el Log, que es
  append-only.
- **El `\S` era un mutante superviviente** y lo dejé pasar. Fijado con un test y
  ronda de confirmación por decisión de Roberto. El criterio que aplicó: dejar un
  superviviente sería aplicarnos un estándar más flojo del que se exige a cada
  delegado en cada prompt.

**Residuos de CH-4 — RESUELTOS** el 2026-07-28 por decisión de Roberto, con ronda
de confirmación (`validation fail --human` → corrección sin commitear → mandato
mínimo → PASS sin defectos → commit). Se conservan aquí porque la clase sigue
viva y porque documentan cómo se cerró:

1. La justificación del pin añadido a `test/lifecycle.test.mjs` **es falsa**:
   `test/cli.test.mjs` sola mata F1, así que el pin no era necesario para que el
   `verify` declarado de la tarea 2 fuese veraz. De sus tres aserciones, **una**
   duplica exactamente la línea 130 del pin preexistente `171002 CR1/CR3` — el
   revisor dijo "fully redundant" y eso era una sobreafirmación suya.
2. El comentario de clasificación del pin de `implement.md` no nombra
   `review.md:40` como sede superviviente de la afirmación del camino de estado
   *"move directly"*. La obligación existe allí; el comentario está incompleto.
3. El mutante F2 del implementador murió por el invariante de replay del Log, no
   por readiness, así que **no probaba** la afirmación pre-flip. El revisor
   construyó F2b, el post-flip real, y esa sí la prueba: sin ella la transición
   acepta un candidato no listo.

Cómo se cerraron: el residuo 3 no era código —la evidencia ya estaba corregida en
el Log—. Los otros dos se arreglaron con dos ediciones mínimas: el comentario de
clasificación ahora nombra `review.md` como sede superviviente, y se retiró **solo**
la aserción duplicada, conservando el `canTransition` que no se afirma en ningún
otro sitio. Verificado antes de borrar que el happy path del pin preexistente no
incluye `in-review`, y por mutación que el pin recortado **sigue muriendo**.

**Precedente que vale para el resto de la iniciativa**: eran ediciones del
entregable *después* de un PASS, que es el patrón que costó dos de los cuatro
`fail --retry` de la fase A. La forma correcta —y la que se usó— es devolver el
change con `validation fail --human`, corregir **sin commitear**, y pasar una ronda
de confirmación con **mandato mínimo**. Coste medido en la fase A: ~62k frente a
~106k de una auditoría completa, encontrando lo que tenía que encontrar.
Este documento se actualiza en cada paso: cuando un change cambia de estado,
cuando una verificación falsifica un supuesto, y cuando aparece un hallazgo
nuevo. Si el documento y el ledger discrepan, el ledger manda y el documento se
corrige.

## 10. Decisiones cerradas de Roberto (2026-07-28)

> **Esta sección es autoridad, no historial.** Antes de presentar algo como decisión
> abierta o de proponer un número, se lee aquí primero. Las tres veces que se ignoró el
> 2026-07-28 —`"ten ceilings"`, el techo de `agent`, y proponer 4500 para `spec`— la
> decisión ya estaba escrita más arriba en este mismo documento.

- Tokenizador aceptado: `head` en **líneas**, techo en **tokens**, `devDependency`.
- **Techos de tokens, tres números** (2026-07-28, cierra el rango anterior de
  2000–2500): `core` **4000**; **todos los demás contextos 2500**; **el resto de cosas
  —cápsulas `agent`, overlays, bloques— 1250**. Criterio explícito de Roberto: *"no lo
  dejemos justos sino siempre estaremos en esto una y otra vez"*.
- **`base.spec` en 3450 es ANDAMIO, no decisión.** Se subió temporalmente sólo para que
  el gate no fallara. Mide 3110 tokens, así que no cabe en 2500 hoy. **Su condición de
  salida es la refactorización del pack de autoría** (CH-0b, más el diseñador del draft
  de CH-2); baja a 2500 en ese change, no antes. Este hecho **no estaba documentado**
  hasta el 2026-07-28, y esa omisión es la causa directa de que se propusiera subirlo a
  4500 contradiciendo la decisión de arriba. CH-17 escribe la marca junto al valor.
- `changeledger context <id>` **sin `head`**: tamaño variable.
- Redondeo del `head` a **múltiplos de 50** (corrige el 35 inicial).
- Regla nueva en `AGENTS.md`: presupuesto de sobra **no** autoriza a consumirlo.
- Prettier se implementa, y **el parser debe comprobar correctamente aunque
  Prettier colapse** — resuelto en CH-1, no en CH-10.
- H12 → regla global: solo se valida lo abierto.
- H47 → sube de deuda a change (CH-11).
- H7 descartado. H36 lo gestiona el humano. H23 se quita el bloque comentado.

Nada pendiente de decisión de las de aquí. CH-18, CH-17 y CH-15 quedaron
documentados, aceptados, graduados y archivados; el siguiente paso es el orden de §7.

- ~~**La unidad de commit de la implementación**: el contrato vigente contradice la
  decisión de Roberto.~~ **CERRADO** el 2026-07-29 por **CH-21** (`20260729-111349`),
  aceptado y graduado a `git-traceability`. El core dice ahora *"**Implementation**: one
  per resolved selection of work … so the number of implementation commits per change is
  not fixed"*, y la garantía del rango del review sobrevive como obligación de secuencia:
  *"Every selection is committed before the review is delegated"*. Ver §12 para su coste.

Decisiones abiertas, ninguna bloqueante para documentar:

- **El recorte de la lista**: 16 changes pendientes y la lista no ha bajado mientras se
  cerraban seis, porque cada pasada sobre el contrato genera hallazgos sobre el
  contrato. Preocupación explícita de Roberto el 2026-07-29: *"tenemos un monton de
  cambios y contando, sin arreglar nada"*. Ver §11.
- **CH-16** sigue pendiente de autorizar, y su hueco 1 exige decidir si las razones
  `ChangeLedger: none — …` pueden citar ids en absoluto.
- El residuo de `bootstrapHeadCut()` lo reclaman CH-17 y CH-19: **una sola sede**.
- `"ten ceilings"`: **ya no es decisión**, es comentario falso desde su propio commit.
  Follow-up de una línea, y su sede natural es CH-19, que comparte ese fichero.
- El descuadre del resumen de `check` (hallazgo nuevo 4): **resuelto, no era defecto**;
  lo causó el merge externo. Nada que decidir.
- **Redundancia que introdujo mi redacción de CH-18** (O1 del review): la última
  cláusula de CR4 duplica lo que `194233 CR5` ya afirma. No se arregla en CH-18 —está
  aprobada y verificada— pero es candidata al barrido de aserciones de CH-9, y la
  lección es de redacción: antes de escribir una cláusula de criterio, comprobar si
  otro test del árbol ya la afirma.

## 11. La lista no baja — diagnóstico y propuesta de recorte

Preocupación de Roberto el 2026-07-29: *"tenemos un monton de cambios y contando, sin
arreglar nada"*. El conteo le da la razón.

La criba del 2026-07-28 declaró **16 changes** (CH-0…CH-13). Desde entonces se
resolvieron **ocho** (CH-4, CH-14, CH-0, CH-18, CH-17, CH-15 cerrados; CH-20 descartado;
más CH-4 de la tanda anterior) y hay **16 pendientes**. La lista no ha bajado.

**La causa es estructural y no es la velocidad: la iniciativa se alimenta a sí misma.**
Los siete changes que nacieron después de la criba nacieron **todos** de otro change de
la propia iniciativa, ninguno del producto:

| nació | de |
|---|---|
| CH-14 | intentar commitear este acta |
| CH-15 | un defecto encontrado implementando CH-4 |
| CH-16 | residuos que CH-14 dejó fuera de alcance |
| CH-17 | partir CH-0 por techo de complejidad |
| CH-18 | residuos de CH-0 (B5, B7) |
| CH-19 | medir para CH-17 |
| CH-20 | una pregunta de orden (descartado el mismo día) |
| CH-21 | CH-15 shipeando más estrecho que la decisión |

La superficie de trabajo **es el contrato**, así que cada pasada sobre el contrato produce
hallazgos sobre el contrato. Es un bucle divergente, no trabajo convergente. Seguir
cribando hallazgos no lo cierra: lo alimenta.

### Propuesta de recorte — pendiente de decisión de Roberto

Criterio propuesto: **entra sólo lo que tiene coste medido detrás o corrige una
contradicción con una decisión humana.** Todo lo demás colapsa o se descarta.

**Se quedan (5 + 1):**

| change | evidencia medida |
|---|---|
| CH-2 | el par de retry cuesta 316k; su causa fue un criterio aprobado sin verificar |
| CH-1 | el hallazgo 41 golpeó **tres veces en una sesión**; bloquea CH-19 y CH-10 |
| CH-5a | mandato acotado 62k frente a 106k, encontrando lo mismo |
| CH-5b | la regla de agrupación es el mayor palanca medida: 347k en tres delegaciones frente a 161k en una; y mata la clase de falso positivo que gastó una ronda entera |
| CH-11 | defecto en producción: subproceso `gh` en cada transición a `in-progress` |
| **nuevo** | unidad de commit: el contrato contradice la decisión de Roberto |

**Colapsan en un solo change de barrido cada uno (2):**

- **Barrido de fallos silenciosos**: CH-6 (cinco sitios que degradan en silencio) + CH-12
  (cuatro invariantes sin filtrar y dos predicados de congelado) + CH-13 (los dos bypasses
  del guard). Todos son "cero ocurrencias hoy, bomba armada", misma clase de arreglo.
- **Barrido de verdad persistente y aserciones**: las tres invocaciones rotas de CH-8 +
  la regla huérfana + la aserción vacua de CH-9 + la redundancia de CR4 de CH-18. Sin el
  mecanismo de extracción de CH-8, que es superficie nueva.

**Al final de la fila (2)** — decisión de Roberto del 2026-07-29: *"Yo no descartaria aun,
solo lo enviaria al final de la fila"*. No se descartan; pierden prioridad y se
reconsideran cuando lo de arriba esté cerrado:

- **CH-10 (Prettier)**: el hallazgo 42 de este mismo acta concluye que *"el contrato es
  salida de máquina y no se formatea para la vista humana"*. Formatear salida de máquina
  para la vista no tiene coste medido detrás, y arrastra CH-9 y CH-1 como prerequisitos.
- **CH-3 (cinco salidas post-fallo)**: su propio precedente lo desmiente — `194220` usó
  la salida "extensión con re-aprobación" **sin que el contrato la nombrara**. Es el
  change más caro de diseñar de la lista y el único cuya necesidad no está medida. Su
  draft `20260722-124655` sigue en `draft` y sin aprobar mientras espera.

**Se aplaza sin fecha (1):**

- **CH-7**: robustez de cara al repo consumidor, y **no hay consumidor de v4**.

**CH-0b deja de ser aplazable**: es prerequisito de CH-2, no habilitador opcional. `spec`
vive de andamio con **44 líneas y ~340 tokens** de margen (medido el 2026-07-29) y CH-2 es
la mayor adición de prosa a ese fichero. §10 nombra a los dos como la condición conjunta
de salida del andamio.

**Quedan reducidos (2):**

- **CH-16** a su hueco 1 (¿pueden las razones citar ids?) más el hallazgo 1 de los
  recuperados de memoria, que comparte fichero. Fuera el U+200B: adversarial-only.
- **CH-19** a la sede única de la enumeración. Es explotable y probado, así que entra;
  pero su entregable es una guarda sobre el contrato, no producto.

De 16 pendientes a **7 activos** (los 6 medidos más CH-0b como prerequisito) **+ 2
barridos + 2 reducidos**, con 2 al final de la fila y 1 aplazado. Nada se descarta. Y el
criterio de admisión deja de aceptar hallazgos nuevos que no traigan coste medido, que es
lo que cierra el bucle.

**Uno de los seis ya está cerrado**: CH-21, la unidad de commit, `20260729-111349`, hecho
y graduado el 2026-07-29. Quedan cinco activos más CH-0b.

## 12. El coste de CH-21, y el hallazgo que no cierra ningún gate del contrato

| | |
|---|---|
| tokens de delegado | **~794k** — el mayor de la iniciativa, por encima de los 614k de CH-15 |
| rondas | 1 review + **3 `fail --retry`** |
| criterios que fallaron | **cero**: los siete pasaron en la primera review, con mutación confirmada |
| entregable tocado por los retries | **ninguno** |

Los tres retries fueron de la misma clase, y los tres son del orquestador:

1. **Una nota de Log que afirmaba un mecanismo falso.** Dije que separar las dos
   selecciones resueltas habría exigido un commit intermedio con la suite roja. El
   revisor construyó el árbol contrafactual y lo corrió: **99 pass, 0 fail**. Era falso.
2. **Afirmé haber barrido la clase habiendo barrido las instancias señaladas.** Sobrevivían
   tres, una de ellas la copia **autoritativa** según `164620 CR5`, y otra citaba como
   vigente un texto que el propio change había eliminado.
3. **Volví a afirmar "el patrón completo de la clase"** apoyado en un `grep` por líneas.
   Un instance escapó porque la frase se partía entre dos líneas de comentario. Un grep
   por líneas no puede ser el patrón completo de una clase cuya redacción se envuelve.

**El hallazgo, y es nuevo: ningún gate del contrato mira lo que el orquestador escribe en
el Log después de trabajar.** CH-2 —el gate de salida del draft— no habría evitado ninguno
de los tres: los criterios estaban bien redactados y bien medidos. Lo que falló fue la
afirmación posterior, que sólo la caza un revisor fresco leyendo el Log contra el árbol, y
cada vez que la cazó costó un par de rondas.

Consecuencias para el orden y para el método:

- **No cambia la prioridad de CH-2**, que sigue atacando la clase medida de 316k. Pero
  deja de ser el techo del ahorro: la mitad del coste de CH-21 vive en una clase que
  ningún change de la lista cubre.
- El único mecanismo que funcionó fue **pedirle al revisor de confirmación que juzgue las
  ediciones del orquestador con el mismo estándar que las del implementador**, y pasarle
  los puntos de escrutinio literales. Los tres retries salieron de ahí. Es disciplina de
  prompt (§CH-5b), no de contrato, y confirma esa decisión.
- Regla operativa que sale de esto, para cualquier sesión: **una nota de Log que afirma un
  mecanismo, un conteo o un barrido se mide antes de escribirla, y se escribe con su
  método y su límite**, no con su conclusión. "Barrí la clase" no es afirmable; "un sweep
  insensible a saltos de línea sobre `test/` con ocho patrones da cero supervivientes en
  presente" sí.

**Residuos de CH-21, registrados en su Log y no tocados** porque editar el entregable tras
un PASS es el patrón que costó dos de los cuatro retry de la fase A: un descriptor rancio
del paso 5 en `test/context.test.mjs`, y dos formas de deixis (`the new unit`) en
`test/cli.test.mjs`. Candidatos al barrido de aserciones.

**Decisión abierta que dejó CH-21, y es de producto:** `resolved selection of work` se usa
**11 veces** en el contrato publicado y **no está definido en ninguna parte**;
`delegation.md` usa vocabulario distinto (`delegation unit`, `boundary`). Nada impide
llamar "una selección" al change entero y volver a `exactly one`, salvo el discriminante de
`core.md`. El dimensionado por completitud y acoplamiento es contenido de **CH-5b** según
§8, así que la definición llega con él. Roberto aceptó el change con este hueco conocido.

### Orden tras el recorte (2026-07-29, mañana) — SUPERSEDIDO por §13

**Decisión de Roberto: nada se descarta.** Lo que iba a descartarse va al final de la fila
y se reconsidera cuando lo de arriba esté cerrado. CH-21 (la unidad de commit) ya está
cerrado y graduado, así que la cabeza de la fila es CH-0b.

```
CH-0b → CH-2 → CH-1 → CH-19 → CH-5a → CH-5b → CH-11
    → barrido de fallos silenciosos (CH-6+CH-12+CH-13)
    → barrido de verdad persistente y aserciones (CH-8+CH-9)
    → CH-16 reducido → CH-7 → CH-3 → CH-10
```

**La unidad de commit va primera y no por tamaño**: la regla gobierna **cómo se commitea
todo lo que venga detrás**. Si CH-2 se implementa antes, su propio trabajo queda forzado a
un solo commit de implementación por el texto que hay que corregir. Además es el único
pendiente que corrige algo ya shipeado mal.

**Por qué no se funde con CH-2**, aunque Roberto lo planteó (2026-07-29): sus superficies
son ajenas salvo una. La unidad de commit toca el bloque `## Commits` de `core.md` y
`.changeledger/specs/git-traceability.md`; CH-2 toca `templates/contract/spec.md`,
`src/commands/agent.mjs` (`approve`) y `src/check.mjs`. **No compite por el presupuesto de
`spec`**, que es el cuello de botella de CH-2. El solape real y único es
`test/context.test.mjs`: los dos tocan el mapa de pins de snapshot —la unidad de commit
porque edita `core.md`, CH-2 porque corrige las cuatro clasificaciones falsas—, y eso lo
resuelve la secuencia, no la fusión. Fundirlos rompería el techo de complejidad (prosa en
dos fragmentos, una spec, código en `check` y `approve`, más las cuatro correcciones de
pin en una sola pasada) y ninguno se podría revertir por separado, que es el test de
granularidad del propio core.

## 13. Decisiones del 2026-07-29 (tarde) — reorganización, retiro de pins y regla del core

Sesión posterior al §12. Tres decisiones de Roberto, todas cerradas; esta sección
supersede el orden del §12.

### 13.1 Retiro de los pins de hash — CH-22, documentado

Pregunta de Roberto: *"¿Está bien que estemos generando tests de los .md? veo que
eso hace que cambiar 1 línea nos cueste 1 hora y 1M de tokens, es demasiado
ceremonioso"* y *"seguramente no se están retirando los tests que ya no son
necesarios porque algunos archivos tienen ya más de 3000 líneas y aparte son
excesivos en comentarios"*.

Medido antes de responder, no asumido:

- `test/context.test.mjs`: 3883 líneas, **29% comentarios** (1140 líneas). Las
  demás suites grandes están al 1–6% (`check.test.mjs` 2623 líneas, 1%): el
  bloat de comentarios está **localizado en la maquinaria de pins**, no
  repartido.
- El mapa de `234939 CR10/CR11` pinnea 12 fragmentos y cada entrada arrastra el
  historial completo de clasificaciones de los changes archivados — historia que
  el ledger ya registra, duplicada en un test (clase 19/48 dentro del propio
  mecanismo de guardas).
- Hay meta-tests que leen el código fuente de la propia suite para asertar sobre
  sus comentarios (`194234 CR5`, `164620 CR5`, `164620 H3`).
- El coste de 1M de tokens NO lo causaron los tests de `.md` (fue el par de retry
  por afirmaciones sin verificar, §12), pero la ceremonia por edición de línea sí
  es real: repinnear + clasificar + escrutinio del comentario en review.

**Veredicto por mecanismo** (decisión de Roberto: "Sí, está bien"):

| mecanismo | veredicto |
|---|---|
| presupuestos (`budgets.yml`) | se quedan — baratos, detuvieron trabajo real |
| matriz semántica de outputs propietarios | se queda |
| guards de obligación por grep | se quedan y absorben lo que los pins protegían de verdad |
| pins SHA-256 + clasificación manual | **se retiran** — clasificación inverificable (4 falsas), hash que no dice qué se perdió, redundante con el review del change |

Documentado como **`20260729-143656`** (CH-22, tipo `refactor`), primero de la
tanda. Consecuencias: la tarea de CH-2 sobre las cuatro clasificaciones falsas
queda sin objeto; CH-19 se encoge; la sección de snapshots de
`.changeledger/specs/contract-discovery.md` se reescribe dentro del change.

### 13.2 Regla del core como sede única — va al change de doctrina

Decisión de Roberto, en sus palabras: *"El core tiene todo el flujo general
descrito, además es quien tiene las políticas de commit y delegación, se debe
evitar repetir esto en otros lados, solo se puede ampliar y especificar algo
puntual siempre y cuando no le contradigan."*

El core ya dice la mitad (*"core never duplicates it"* — el core no duplica al
overlay); **la dirección inversa no está escrita** y la clase 19/48 apareció 6+
veces por eso. La frase entra en el change de doctrina, y el resto de ese change
es aplicarla.

### 13.3 Fusión por superficie — autorizada

- **Change de doctrina = CH-0b + CH-5b + CH-5a.** Los tres reescriben la misma
  prosa de delegación/review; separados era editar los mismos fragmentos tres
  veces con tres reviews. Fallback si al documentarlo excede el techo de
  complejidad: 0b+5b juntos, 5a aparte. CH-5b define además `resolved selection
  of work`, el hueco que dejó CH-21.
- Los dos barridos de §11 se mantienen tal cual.
- Riesgo de CH-2 detectado y aceptado como restricción de redacción: exigir
  "sitio de aserción" por criterio NO puede traducirse, para prosa, en un test
  artesanal por criterio — sería multiplicar los tests de `.md` que 13.1 retira.
  Para prosa, el sitio de aserción es el guard de obligación.

### 13.4 Paralelismo — dos worktrees, no más

Dos ficheros cuello de botella comparten casi todos los changes:
`test/context.test.mjs` y `src/check.mjs`. Carriles con superficies disjuntas:

- **WT-A (contrato)**: CH-22 → doctrina (0b+5b+5a) → CH-2 → CH-1 → CH-19.
- **WT-B (código CLI)**: CH-11 → barrido de fallos silenciosos.
- Al final, en solitario: barrido de verdad persistente y aserciones.

Reglas verificadas: worktree fuera del repo, `pnpm install` en cada uno, los
changes de carriles distintos no se referencian por `depends_on` (un documento
que vive solo en otra rama rompe `check` en las hermanas), integración apilando
una rama sobre la otra.

### Orden vigente (2026-07-29, tarde)

```
WT-A: CH-22 (pins) → doctrina (CH-0b+CH-5b+CH-5a) → CH-2 → CH-1 → CH-19
WT-B: CH-11 → barrido de fallos silenciosos (CH-6+CH-12+CH-13)
después, solo: barrido de verdad persistente (CH-8+CH-9)
cola final sin cambios: CH-16 reducido → CH-7 → CH-3 → CH-10
```

CH-22 va primero porque abarata todos los que vienen detrás: cada change de
prosa deja de pagar el repinneo y la clasificación en cada edición de fragmento.

### Registro de ejecución del 2026-07-29 (tarde) — los dos primeros del orden nuevo, cerrados

| change | id | resultado |
|---|---|---|
| CH-22 (pins) | `20260729-143656` | **archivado**, graduado a `contract-discovery`. 1 ronda de `fail --retry` con 4 hallazgos reales del revisor top-tier; 2 eran redacción del orquestador (CR3, CR4). Neto: −795 líneas de maquinaria, +61 de guards que muerden más fuerte que antes (inventario de los 3 directorios + barrido recursivo insensible al reflow). Editar prosa del contrato ya no exige repinnear ni clasificar |
| CH-11 (owner hermético) | `20260729-144812` | **archivado**, graduado a `lifecycle`. 0 retries. Resolución perezosa + kill-switch `CHANGELEDGER_NO_GH` en el runner por defecto, fijado por `test`/`verify`: hermeticidad por construcción. Implementado en worktree WT-B y fusionado (`f44c1bb4`) |

Validación del modelo de dos carriles: los dos ciclos corrieron en paralelo sin
interferencia, con la fusión al final. Hallazgos operativos: (1) la aprobación
humana en el viewer queda sin commitear en el checkout donde se hizo — el baseline
debe commitearse antes de abrir el worktree, o la rama nace viendo `draft`; (2) el
paso `in-progress → in-review` antes de delegar la confirmación de una corrección
funcionó como salida al hallazgo H1 del ciclo de CH-15.

Evidencia nueva para CH-19, de los mutantes de CH-22: el hueco no recursivo de
`124837 CR1` reproducido en vivo dos veces; el barrido restaurado por CH-22 cubre
recursivamente su propia frase, pero las demás siguen con guard top-level. CH-19
queda reducido a consolidar la enumeración y decidir si los barridos restantes se
vuelven recursivos.

Reincidencia del orquestador, forma nueva registrada en memoria: descartar hits de
grep como "ajenos" sin trazar cada símbolo hasta su consumidor (CR3; costó la mitad
de los hallazgos del retry de CH-22).

### Drafts de la segunda tanda (2026-07-29, tarde) — documentados sobre investigación fresca

Método aplicado, y es contramedida directa de la reincidencia: **ningún hecho del
acta entró a un draft sin re-verificarse contra HEAD** por investigación delegada
con salida literal. Las investigaciones falsificaron o matizaron cuatro hechos de
este acta, corregidos aquí:

1. `resolved selection of work` aparece **5 veces** en el contrato (4 en `core.md`,
   1 en `implement.md`), no 11 como decía §12. Cero en `delegation.md`.
2. Existe un **guard anti-duplicación** (`234939 CR1-CR10`) que hoy asserta el
   reparto vigente (doctrina de dimensionado EN `delegation.md` y NO en core con
   ciertas frases). Es bloqueador duro del change de doctrina y su draft lo nombra:
   se reescribe en la misma pasada.
3. La iteración sin filtrar de los cuatro invariantes (CH-12) es **diseño
   documentado** para conservar lo congelado como *dato* repo-wide; el defecto real
   es el congelado como *sujeto emisor* de errores inarreglables. El CR se redactó
   sobre esa distinción.
4. El bypass de casing del guard de commit (CH-13) **no es alcanzable por `git add`
   normal en APFS** — git pliega el casing; el vector real es un índice inyectado
   (`update-index --cacheinfo`) o un rebase/cherry-pick que arrastre un tree entry
   mal-caseado. Reproducido por esa vía. Y el bypass de `changes_dir: "."` es **más
   grave** de lo que decía CH-13: desactiva el guard para *todo* fichero staged, no
   solo documentos de raíz. Reproducido.

Hallazgo lateral nuevo, sede CH-7: con `changes_dir: "."`, `loadRepoWithConfig`
parsea todo `*.md` de raíz sin try/catch y revienta con `Change is missing its
frontmatter block` ante cualquier markdown normal (`AGENTS.md` incluido). Ruidoso,
no silencioso; clase de CH-7 (hallazgo 11).

| draft | id | contenido |
|---|---|---|
| Doctrina (CH-0b+CH-5b) | `20260729-162015` | desduplicar `delegation.md`, regla de sede única en sus dos direcciones, definición única de `resolved selection` en core, contrato de evidencia por rol (implementador en `delegation.md`, revisor en `review.md`). CH-5a queda como change propio por el fallback autorizado (superficie disjunta: cápsula de prompt). El techo andamio de `base.spec` no baja aquí — condición conjunta con CH-2 (§10) |
| Barrido de fallos silenciosos (CH-6+CH-12+CH-13) | `20260729-162616` | tipo `bug`, 9 CR: tipo indecidible aborta, `review()` con `assertTransition`, plantilla de tipo vacío, criterio desconocido diagnosticado en todo tipo, `tdd=` no se publica sin su fragmento, congelado nunca sujeto emisor, predicado único de congelado, whitelist sin casing, prefijo colapsado aborta |

Ambos en `draft`, pendientes de aprobación. Destinos: doctrina en el checkout
principal (WT-A); barrido en worktree WT-B con rama nueva desde el tip **después**
de commitear su baseline (lección del ciclo anterior escrita arriba).

### Ciclo de la segunda tanda — estado al 2026-07-29 (noche)

| change | estado | nota |
|---|---|---|
| Doctrina `20260729-162015` | **corrección en curso** tras `validation fail --human` | review top-tier PASS con deformación auditada (cero cuantificadores añadidos, guards re-pinneados 430→440 aserciones) y 4 hallazgos LOW; decisión de Roberto: *"arreglemos todo de una vez"* — F1 (mitad negativa del cuándo-delegar sin sede), F2 (tres sub-obligaciones comprimidas en la Proposal, la sustantiva: el mutante falla por la razón correcta), F3 (la lista de decisiones no especificadas tenía consumidor sin productor), F4 (comentario rancio 3110) se corrigen ahora, no en CH-5a. Restricción: CR6 obliga a seguir bajo 301/191 líneas, así que la corrección comprime prosa sin perder obligación o para y pregunta |
| Barrido `20260729-162616` | **in-review** (commit `1a639c77`) | 9 CR implementados con rojo-verde literal; 970/970. **CR2 enmendado con autorización humana**: su cláusula original era inconstructible (hallazgo 28 del orquestador al redactar — `TRANSITIONS` es constante y `in-review` refleja las tres salidas de `review()` por construcción); sustituida por paridad estructural verificable. CR7 destapó un **segundo narrowing** no nombrado: `archived: true` bajo status abierto también deja de estar exento del check de menciones — consistente con el doc comment de `frozenReason`, punto de escrutinio del review |

Hechos nuevos para el registro: el contrato de evidencia (ya shipeado en la
doctrina) funcionó en su primer uso real — el implementador del barrido **reportó
la cláusula inconstructible de CR2 en vez de fingir el rojo-verde**, que es
exactamente la conducta que la cláusula "señalar instrucciones que contradigan"
compra. Dos criterios no falsables del orquestador en un día (CR3 de CH-22, CR2
del barrido): la clase que CH-2 cierra en el draft sigue viva en mi redacción y
es el argumento acumulado para mantener CH-2 el siguiente de la fila tras esta
tanda.

### Cierre de la segunda tanda — 2026-07-29 (noche): los dos en `in-validation`

| change | ciclo completo |
|---|---|
| Doctrina `20260729-162015` | review top-tier PASS → `validation fail --human` de Roberto (arreglar F1-F4 ahora) → corrección delegada dentro de CR6 (spec 300/345, implement 190/250, neto +1 línea pagado por la fusión de residuos) → confirmación fresca PASS sin defectos → commiteada (`18f50643`). En `in-validation` |
| Barrido `20260729-162616` | review top-tier FAIL-RETRY con **un hallazgo medium-high real**: el lowercase del whitelist de CR8 cambiaba un bypass por otro (el gemelo mal-caseado de un doc declarado se commiteaba en case-sensitive; ejecutado por el revisor) → fix mínimo del orquestador con TDD (rojo capturado, whitelist exacto, prefijo case-folded fail-closed) → confirmación fresca PASS con mutación re-derivada → commiteada (`6cf1263b`). En `in-validation`. Findings 2-4 informativos como follow-ups en su Log: `tdd=` en cápsulas agent-context sin definición servida (clase de CR5, superficie nueva), narrowing (b) de CR7 consumer-visible sin población que lo ejercite en este repo, CR4 anulado bajo `tdd: false` |

Del método, para el registro: el hallazgo de CR8 es exactamente lo que compra el
review adversarial — un criterio mío pedía "normaliza de forma segura" sin fijar la
asimetría, el implementador eligió la simetría plausible, y solo la re-derivación
con el vector real lo cazó. Ningún gate local podía: la suite estaba verde en las
dos versiones porque el test shipeado solo cubría la dirección undeclared.

### Segunda tanda cerrada — 2026-07-29 (noche)

| change | cierre |
|---|---|
| Doctrina `20260729-162015` | done, graduado a `contract-discovery` (párrafo nuevo: sede única bidireccional, reparto de delegation.md/review.md), archivado |
| Barrido `20260729-162616` | done, graduado a `git-traceability` (casing asimétrico del guard, abort del changes_dir colapsado — el residual de mayúsculas queda CERRADO) y a `validation` (el límite de los cuatro invariantes queda CERRADO: congelado nunca sujeto, siempre dato, predicado único), archivado. Rama fusionada (`change/silent-failure-sweep`), gate 973/973 |

Con esto quedan cerrados de la lista original: CH-0b, CH-5b (fusionados en la
doctrina), CH-6, CH-12, CH-13 (fusionados en el barrido), CH-11 y CH-22. La fila
restante: **CH-2 (arrancando ahora por decisión de Roberto) → CH-1 → CH-19 →
CH-5a (reducido: F1-F4 de la doctrina ya cerrados en su corrección; queda el campo
de alcance del mandato en la cápsula) → barrido de verdad persistente (CH-8+CH-9)
→ cola final**. Follow-ups nuevos registrados en el Log del barrido: tdd= en
cápsulas agent-context, narrowing (b) de CH-7 consumer-visible, CR4 bajo tdd:false.

### CH-2 documentado — `20260729-185200` (2026-07-29, noche)

Draft commiteado sobre investigación fresca contra el HEAD fusionado. Dos
decisiones de diseño que se apartan de la letra de §4 y quedan a confirmación de
Roberto al aprobar:

1. **Sin gramática nueva**: "cada CR nombra su sitio de aserción" se implementa
   como la cadena existente criterio→tarea→verificación vuelta **obligatoria**
   (cobertura escala a error desde `approved` y `approve` valida pre-flip con
   severidad destino). Una declaración por CR sería segunda sede; verificar
   existencia en disco rompería el diseño sin-IO de `check` y el orden TDD.
2. **La cobertura del Request queda como obligación de redacción** con
   escrutinio en review, no mecánica: no hay verificador honesto de cobertura
   semántica y fingirlo sería un guard vacuo (hallazgo 43).

Corrección de registro: la decisión "strictness en `check <id>` y `approve`, NO
repo-wide" citada por las notas de la fase A **no estaba en este acta** — queda
aquí; la arquitectura de `assertChangeTextValid` ya la cumple por construcción.

### CH-2 cerrado el ciclo — `20260729-185200` en `in-validation` (2026-07-29, noche)

El change fundacional de la iniciativa, completo: gate de approve en la sede única
`status()` con proyección de severidad `asStatus` (solo cobertura, fail-fast sin
sujeto), cobertura escalada a error desde `approved`, seis obligaciones de
redacción en el contrato con guard por obligación. Ciclo: review top-tier PASS
técnico con re-derivación completa (deformación de las seis obligaciones: fiel;
seam trazada; seis adaptaciones de fixture verificadas contra sus versiones
viejas, una byte-idéntica) → `fail --retry` por lote de 5 hallazgos de texto
(el mejor: la prosa nueva de readiness violaba la obligación (b) del propio
change) → corrección del orquestador con el guard de (b) fallándole su propio
edit hasta actualizar el regex → confirmación fresca PASS → commiteado
(`95227892` + `64aa2e3f`). Gate 984/984.

Datos que el ciclo dejó: el fixture de CR1 produce 4 diagnósticos (no 5, cifra
del orquestador corregida por el delegado sin rellenar); la nota de andamio venía
rancia desde antes del change (3190 reales vs 3140 anotados) y la dimensión justa
del pack spec son tokens, no líneas (3416/3450 tras el cierre, 34 de margen — la
salida del andamio sigue esperando a CH-1). El gate ya protege este repo: CH-19
(`194157`) es hoy inaprobable por accidente con sus 4 defectos, que es su estado
correcto hasta CH-1.
