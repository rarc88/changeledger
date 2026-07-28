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
- `hooks/**` no está en `readiness.target_patterns`, y `hooks/pre-commit` es
  producción real.
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
- **Hueco que CH-0 dejó abierto**: `base.core.lines` colapsó a 195, así que el
  `head -200` del bootstrap queda *por encima* del techo declarado como reserva —
  y **nada pinnea que `head ≥ base.core.lines`**. No es regresión (nunca se
  comparaban), y su sede natural es este change.
- `agent-context` no publica segmento de tamaño (B8).

### CH-18 — Higiene del mecanismo de presupuestos

Alcance **reducido** por lo que CH-0 cerró de paso:

- **B5, vivo**: pinnear cada techo por valor. Antes sólo `base.core` lo estaba.
- **B7, vivo**: unificar los dos `emittedLines` (`src/commands/context.mjs` y
  `test/budget-support.mjs`), que discrepan en texto sin salto final.
- **B6, CERRADO por CH-0**: la aserción de convergencia con `maxPasses=1` desapareció
  con el punto fijo iterado. El delegado lo retiró con argumento —existía sólo porque
  el ancho de la cifra de *bytes* cambiaba el total, y una cifra de líneas más ancha
  no puede añadir una línea— y lo reportó en vez de decidirlo en silencio.
- **B4, CERRADO por CH-0**: el techo del bloque `## Commits` vive ahora en
  `budgets.yml` como `blocks.core-commits`.

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

Hechos y archivados: **CH-4**, **CH-14**, **CH-0**. Orden restante:

```
CH-18 → CH-17 → CH-0b → CH-1 → CH-19 → CH-15 → CH-5a → CH-5b → CH-11 → CH-12
     → CH-1 → CH-9 → CH-10 → CH-2 → CH-3 → CH-13 → CH-16 → CH-8 → CH-6 → CH-7
```

CH-18 y CH-17 van pegados a CH-0 porque comparten su superficie y su contexto
está fresco. **CH-15 espera a CH-0b**: su bloque candidato mide 28 líneas exactas
contra un techo de 28, y CH-0b libera margen de core al consolidar `delegation`.

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
graduated initiative`, con los 18 marcadores en el body). `--pending archive`
vacío. `changeledger check`: `✓ 2 change(s) valid — 221 not validated`. Rama única
`change/workflow-core-drafts`.

| change | id | estado | nota |
|---|---|---|---|
| CH-4 | `20260722-124656` | **done, graduado a `lifecycle`** (2026-07-28) | aceptado por Roberto; pendiente de archivar a propósito, para dejarlo reabrible hasta que CH-15 aterrice |
| CH-14 | `20260728-151336` | **done, graduado a `git-traceability`** (2026-07-28) | 5 CR, 3 tareas, **un commit por tarea**; review PASS con ~50 intentos de escape; `\S` fijado con ronda de confirmación. Pendiente de archivar |
| CH-15 | `20260728-164620` | **`draft`, sin aprobar** | unidad de commit = change; bloque candidato medido en 28/28, espera el margen que CH-0b libera |
| CH-0 | `20260728-170429` | **archivado** (2026-07-28) | 7 CR; review `fail --retry` con 2 defectos, corregidos y confirmados; graduado a `contract-discovery` |
| CH-19 | `20260728-194157` | **`draft`, bloqueado** | guardas recursivas; **no aprobable** hasta CH-1, ver arriba |
| CH-17 | — | sin documentar | `head` derivado; contexto fresco tras CH-0 |
| CH-18 | — | sin documentar | higiene; alcance reducido, B4 y B6 ya cerrados |
| CH-16 | — | pendiente de autorizar | dos huecos que CH-14 dejó fuera de alcance, ver arriba |

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

### Hallazgos nuevos del 2026-07-28 (tarde), sin change asignado

1. **`.changeledger/specs/contract-discovery.md` documenta los bytes y el formato
   `lines/bytes` de la línea BEGIN como verdad vigente.** Cuarta aparición hoy de la
   clase 19/48, y actualización obligatoria al graduar CH-0. Las tres anteriores:
   `lifecycle.md` con el orden viejo del gate (CH-4), `git-traceability.md` con las
   dos exenciones viejas (CH-14), y esta.
2. **`test/cli-bin.test.mjs:370` (`lines.length <= 60`) es el único techo de tamaño
   hardcodeado que queda** en el repo. Fuera de la clase a propósito: acota el help
   del CLI, no una captura de contexto.
3. **Nada pinnea `head ≥ base.core.lines`.** → CH-17.

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
| CH-3 | `20260722-124655` | `draft` | **no aprobar**: su contador contradice la clasificación por clase de defecto, y excede el techo de complejidad. Reescribir y partir |
| resto | — | sin documentar | siguen el orden de §7 |

Este documento se actualiza en cada paso: cuando un change cambia de estado,
cuando una verificación falsifica un supuesto, y cuando aparece un hallazgo
nuevo. Si el documento y el ledger discrepan, el ledger manda y el documento se
corrige.

## 10. Decisiones cerradas de Roberto (2026-07-28)

- Tokenizador aceptado: `head` en **líneas**, techo en **tokens**, `devDependency`.
- `core` 4000 tokens; el resto de contextos 2000–2500.
- `changeledger context <id>` **sin `head`**: tamaño variable.
- Redondeo del `head` a **múltiplos de 50** (corrige el 35 inicial).
- Regla nueva en `AGENTS.md`: presupuesto de sobra **no** autoriza a consumirlo.
- Prettier se implementa, y **el parser debe comprobar correctamente aunque
  Prettier colapse** — resuelto en CH-1, no en CH-10.
- H12 → regla global: solo se valida lo abierto.
- H47 → sube de deuda a change (CH-11).
- H7 descartado. H36 lo gestiona el humano. H23 se quita el bloque comentado.

Nada pendiente de decisión. Siguiente paso: documentar **CH-4**.
