---
id: "20260726-124837"
title: Sede única del comportamiento de commits en el core
type: refactor
status: in-validation
created: 2026-07-26T12:48:37Z
depends_on: ["20260726-124835", "20260727-194233"]
related_to: ["20260722-124656", "20260727-194234", "20260726-141119", "20260726-141124"]
owner: raruiz-hiberuscom
---

## Request

Agentes que implementan un change producen commits de más: entre otros, uno
para `draft → approved` y otro para `approved → in-progress`. Ninguna de esas
dos transiciones lleva código, y su trazabilidad ya vive en el Log del change
(`changeledger status` escribe el evento `[status]` correspondiente), así que
esos commits añaden ruido sin añadir información nueva al historial.

`templates/contract/implement.md` ya contiene una regla al respecto, pero está
redactada de un modo que se autoviola:

- La línea 28 convierte la regla positiva en un juicio: "Commit completed units
  with their tasks and Log **when later work could obscure attribution**". El
  agente se pregunta si trabajo posterior podría oscurecer la atribución, y la
  respuesta segura es siempre que sí — la instrucción invita al exceso que
  pretende evitar.
- La línea 29 es una prohibición sin unidad de referencia: "Do not create a
  dedicated commit for a lifecycle-only transition" dice qué no hacer sin decir
  con qué medir cuándo sí commitear.
- La línea 24 contradice a las dos anteriores en la práctica: "After
  `approved → in-progress`, create a baseline commit" se lee como licencia para
  commitear en una transición.

Se necesita sustituir el juicio por una unidad contable, de modo que la regla
no dependa de que el agente estime "podría importar más adelante".

Y hay un segundo problema, del que el primero es un síntoma: **el
comportamiento de commits está repartido por ocho fragmentos**. Recuento por
grep sobre `templates/contract/`: 21 menciones en `implement.md`, 6 en
`review.md`, 5 en `core.md`, 2 en `validation.md`, 2 en `close.md`, 2 en
`release.md`, 1 en `handoff.md` y 1 en `delegation.md`. Commitear ocurre en
todas las fases —autoría, implementación, corrección y cierre—, así que su
comportamiento es común a cualquiera de ellas y el core es quien lo explica.
Repartirlo entre overlays es lo que permitió que la misma regla exista en cuatro
versiones potencialmente divergentes sin que nada las compare.

## Proposal

**Unidad de commit decidida: la tarea del Plan**, y **sede única: `core.md`**.
`templates/contract/readiness.md` ya exige dimensionar cada tarea del Plan a un
ciclo rojo-verde; esa tarea, que ya es la unidad atómica del Plan, pasa a ser
también la unidad atómica de commit.

La **unidad de commit y la mecánica del mensaje** se consolidan en el bloque
`## Commits` de `core.md`, e `implement.md` queda sin ninguna de las dos. No se
reescribe el párrafo del juicio en su sitio: se retira de allí y su contenido,
ya sin el juicio, vive en el core.

Lo que **no** es unidad ni mecánica se queda donde está: la sección
`## Correction isolation` de `implement.md` gobierna cuándo una corrección se
mantiene sin commitear frente a review y validación humana, que es
comportamiento de esa fase, y la lista de comandos de mutación conserva
`changeledger commit` como ayuda de descubrimiento. Los rangos que se retiran
son exactamente los que enumera el Plan.

### Qué contiene el bloque consolidado

- **Las cuatro clases de commit**, y solo cuatro, en una rama de change:
  - **Draft**: uno por cada documento de change que se redacta, commiteado en
    solitario — nunca varios borradores en un mismo commit.
  - **Baseline**: exactamente uno, con el documento del change, antes de
    cualquier código.
  - **Task**: uno por cada tarea del Plan completada, con el código de esa
    tarea, su test, su casilla marcada y sus entradas de Log.
  - **Handoff**: cero o uno, solo cuando el trabajo se detiene (pasa a review,
    queda bloqueado, termina la sesión) y de otro modo quedaría sin commitear
    estado que es solo documento.
- **El discriminante** que decide la granularidad: si la unidad se revertirá,
  referenciará o implementará de forma independiente. Una transición de
  lifecycle no lo es —su información ya vive en el Log, así que el commit la
  duplicaría—, pero un documento de change sí: es el baseline sobre el que una
  futura rama de implementación construye, `changeledger check --commits` lo
  referencia por id, y puede descartarse en solitario.
- **Una transición de lifecycle nunca es un commit propio**: viaja dentro de la
  siguiente clase real que ocurra. En la rama de implementación de un change
  aprobado, `n` tareas completadas producen `n + 1` commits (baseline más
  tareas) o `n + 2` con handoff, nunca uno por transición.
- **La mecánica del mensaje**: la forma canónica del subject
  `type(scope): description [#<id>]`, la regla de body multi-change
  `ChangeLedger: [#A] [#B]` sin lista por comas dentro de un mismo corchete, las
  excepciones de merge y `chore(release)`,
  `changeledger commit -m "..." [--id <id>]` como compositor y
  `changeledger check --commits [<base>]` como linter previo a la review.
- **La mezcla inevitable**, en sus dos formas: cuando varios changes comparten
  ficheros, y cuando varias tareas del Plan son inseparables. En ambos casos el
  commit combinado es legítimo y la obligación es registrar en el Log qué se
  combinó y por qué. Decisión humana del 2026-07-26 sobre el segundo caso, con
  precedente vivido: las tareas 1, 3 y 4 de `20260726-141119` eran inseparables
  porque `test/check.test.mjs` llevaba los guardas de las tres y el salto de
  `SUPPORTED_SCHEMA_VERSION` las unía.
- **La inspección del índice tras un hook fallido.** Observado de verdad en este
  repo: cuando el hook `pre-commit` falla, git deja el índice staged intacto, así
  que un `git add` más commit posteriores absorben en silencio los ficheros del
  intento anterior. El contrato obliga a inspeccionar el conjunto staged (por
  ejemplo `git diff --cached --name-only`) antes de reintentar un commit tras
  cualquier fallo: corregir el motivo del fallo no basta si el índice quedó
  contaminado. `20260726-141124` añadió la guarda equivalente del lado del CLI;
  esta prosa es la obligación del agente y no duplica aquel alcance.

### El límite de tamaño del core es un techo, no un objetivo

El core no puede pasar de **200 líneas emitidas** porque el bootstrap publicado
en cada repo consumidor es `changeledger context 2>&1 | head -200`: por encima
de ese corte, toda captura queda truncada e inválida. Medido al empezar: el pack
core está en 172 líneas emitidas y **9834** bytes —no 9809, cifra anterior a que
`20260727-194233` alargara la línea BEGIN con la ocupación—, y el bloque
`## Commits` actual ocupa 7 líneas y 388 bytes de `core.md`.

Por eso el tamaño entra como criterio con una salida explícita: si el bloque
consolidado no cabe en el presupuesto declarado, **el implementador para y
pregunta**. No retira normativa para caber. Precedente que obliga a escribirlo:
en `20260726-124835` un target estricto empujó a retirar tres reglas
normativas, una de ellas huérfana.

### Qué NO se toca

- `review.md`, `validation.md` y `close.md` conservan sus tres copias hasta que
  `20260727-194234` las retire con core ya siendo la sede. Estrechar, parchear o
  rodear esas copias en este change es salirse de alcance.
- `templates/contract/budgets.yml`: lo posee `20260727-194233`, del que este
  change depende para tener un umbral único ya vigente.
- Las reglas de rama y worktree de `implement.md` (nunca `main`/`master`/`dev`,
  ramas desde `git.integration_branch`, inspeccionar el worktree antes de
  tocarlo), que no son comportamiento de commits y se quedan donde están.

### Fuera de alcance

- Añadir un lint que cuente commits contra tareas del Plan completadas: merece
  medirse más adelante, pero es superficie nueva.
- La guarda del lado del CLI sobre el índice staged: la posee
  `20260726-141124`.

## Specification

Los criterios se comprueban sobre la salida compuesta de
`changeledger context` y `changeledger context implement` (vía
`test/context.test.mjs`), que es donde el agente lee realmente los fragmentos.

### CR1 — la frase de juicio de atribución desaparece del contrato
- **Given** los fragmentos del contrato tras el cambio
- **When** se compone el contexto core y el contexto `implement`
- **Then** ninguna de las dos salidas contiene la cadena `later work could
  obscure attribution`
- **And** un grep de esa cadena en `templates/contract/` no la encuentra en
  ningún fragmento

### CR2 — el core define las cuatro clases y la fórmula de conteo
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se compone el contexto con `changeledger context`
- **Then** la salida define el commit Draft en términos equivalentes a
  `one per drafted change document` y `committed on its own`, prohibiendo
  agrupar varios borradores en un mismo commit
- **And** define el commit Baseline como `exactly one`, con el documento del
  change, `before any code`
- **And** define el commit Task como `one per completed Plan task` y el commit
  Handoff como `zero or one`
- **And** declara que una transición de lifecycle nunca es un commit propio y
  viaja en la siguiente clase real que ocurra

### CR3 — `implement` queda sin ninguna definición de unidad de commit
- **Given** el fragmento `templates/contract/implement.md` tras el cambio
- **When** se compone el contexto con `changeledger context implement`
- **Then** la salida no contiene ninguna de las cadenas `baseline commit`,
  `one per completed Plan task` ni `lifecycle-only transition`
- **And** no contiene la forma canónica del subject `type(scope): description
  [#<id>]` ni `ChangeLedger: [#A] [#B]` ni `check --commits`
- **And** sigue conteniendo sin alterar las reglas de rama y worktree: nunca
  `main`/`master`/`dev`, ramas desde `git.integration_branch` e inspeccionar el
  worktree antes de tocarlo

### CR4 — la mecánica del mensaje sobrevive íntegra en el core
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se compone el contexto con `changeledger context`
- **Then** la salida contiene la forma canónica del subject
  `type(scope): description [#<id>]`, la regla de body multi-change
  `ChangeLedger: [#A] [#B]` con la prohibición de lista por comas en un mismo
  corchete, las excepciones de merge y `chore(release)`,
  `changeledger commit -m "..." [--id <id>]` como compositor y
  `changeledger check --commits [<base>]` como linter previo a la review

### CR5 — el commit combinado inevitable queda cubierto en sus dos formas
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se compone el contexto con `changeledger context`
- **Then** la salida declara legítimo el commit combinado cuando varios changes
  comparten ficheros y cuando varias tareas del Plan son inseparables
- **And** en ambos casos obliga a registrar en el Log qué se combinó y por qué

### CR6 — el contrato obliga a inspeccionar el índice tras un hook fallido
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se compone el contexto con `changeledger context`
- **Then** la salida instruye a inspeccionar el conjunto staged, en términos
  equivalentes a `inspect the staged set`, antes de reintentar un commit tras un
  fallo del hook `pre-commit`

### CR7 — el core se mantiene con reserva bajo su techo
- **Given** el árbol tras el cambio
- **When** se ejecuta `node --test test/context.test.mjs`
- **Then** el pack core mide **195 líneas emitidas o menos**, es decir conserva
  al menos 5 líneas de reserva contra el corte de 200 del bootstrap
- **And** el bloque `## Commits` de `templates/contract/core.md` ocupa 28 líneas
  o menos
- **And** el pack core sigue por debajo de su umbral de bytes sin que se haya
  modificado `templates/contract/budgets.yml`

### CR8 — ninguna regla se retira sin dueño verificado
- **Given** el diff completo de este change
- **When** se compara la normativa presente en el contrato antes y después
- **Then** toda obligación que estuviera en `core.md` o `implement.md` antes del
  cambio sigue localizable por grep en `templates/contract/` después
- **And** el pin de snapshot de cada fragmento tocado clasifica cada regla
  afectada como preservada, reemplazada o retirada, y para cada "retirada" nombra
  el fragmento donde vive ahora la obligación

## Plan

- [x] Consolidar en el bloque `## Commits` de `templates/contract/core.md` las cuatro clases de commit, el discriminante, la fórmula de conteo, la mecánica del subject y el body multi-change, las excepciones, el compositor y el linter, la mezcla inevitable en sus dos formas y la inspección del índice staged, actualizar el pin de snapshot de `core.md` con su comentario de clasificación y añadir la comprobación de reserva del core (195 líneas emitidas o menos, bloque de 28 líneas o menos), parando y preguntando al humano si el contenido no cabe en vez de retirar normativa; verify: `node --test test/context.test.mjs` (CR2, CR4, CR5, CR6, CR7)
  - **Resolved:** `2026-07-27T21:11:09Z`
- [x] Retirar de `templates/contract/implement.md` la línea 24 y el párrafo 28-34 más el bloque de mecánica de commits 36-55, conservando intactas las reglas de rama y worktree, actualizar su pin de snapshot con su comentario de clasificación y verificar por grep que toda obligación presente antes en `core.md` e `implement.md` sigue localizable en `templates/contract/`; verify: `node --test test/context.test.mjs` (CR1, CR3, CR8)
  - **Resolved:** `2026-07-27T21:11:09Z`
- [x] Actualizar en `test/cli.test.mjs` las siete aserciones del contrato instalado que fijan por substring la prosa de commits retirada de `templates/contract/implement.md`, apuntándolas a la sede nueva en `core.md`; verify: `node --test test/cli.test.mjs` (CR1, CR3)
  - **Resolved:** `2026-07-27T21:11:38Z`
- [x] Ejecutar el gate completo del proyecto; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T21:11:39Z`

## Log

- **2026-07-26T12:48:37Z** `[note]` Draft: sustituye el juicio de atribución de
  `implement.md` por una unidad de commit contable (tarea del Plan), con tres
  clases cerradas — baseline, task, handoff — y ninguna transición de
  lifecycle como commit propio.
- **2026-07-26T14:05:46Z** `[status]` draft → approved
- **2026-07-26T15:15:46Z** `[note]` Amendment while approved (human-authorized): Proposal extended to a fourth commit kind, Draft (one commit per authored change document, never batched), with the revert/reference/implement-independently discriminant; also adds the agent obligation to inspect the staged index before retrying a commit after any pre-commit hook failure (cross-ref 20260726-141124 for the CLI-side guard). Criterios verificables and the Plan task updated accordingly.
- **2026-07-27T19:50:36Z** `[note]` Amendment while approved (human-authorized 2026-07-27): sede de todo el comportamiento de commits pasa a core.md e implement.md queda sin prosa de commits — decision humana de esta sesion, porque commitear es comun a toda fase y estaba repartido en ocho fragmentos. Anadida la mezcla inevitable de tareas del Plan inseparables (decision humana del 2026-07-26 que el documento contradecia). Techo del core como criterio con salida explicita de parar y preguntar. depends_on suma 20260727-194233 (umbral unico) y related_to suma 20260727-194234 (retirada de copias). Titulo actualizado.
- **2026-07-27T20:53:59Z** `[status]` approved → in-progress
- **2026-07-27T21:10:00Z** `[note]` Enmienda durante in-progress, sin re-aprobacion porque no expande alcance observable: aparece un SEGUNDO sitio de pins que el documento no anticipo. test/cli.test.mjs (test 214902 CR5/CR6) fija por substring siete frases de la prosa de commits que este change retira de implement.md, asi que el gate no puede pasar sin repuntarlas a la sede nueva. Anadida tarea de Plan para ello. Verificado que los siete pins nuevos muerden: mutando cada frase en core.md el test cae en las siete.
- **2026-07-27T21:10:00Z** `[note]` Precisiones al documento: (1) el Proposal decia 'implement.md queda sin ninguna prosa de commits' y su propio Plan/CR3 solo enumeran la unidad y la mecanica del mensaje; ## Correction isolation es comportamiento de la fase de review y se queda, igual que changeledger commit en la lista de comandos. Redactado con precision; el delegado siguio Plan/CR3 y lo reporto en vez de obedecer en silencio. (2) la cifra de bytes del core estaba obsoleta: 9834, no 9809 — la linea BEGIN crecio al publicar la ocupacion en 20260727-194233.
- **2026-07-27T21:11:09Z** `[note]` Tareas 1 y 2 en un commit combinado: son un solo movimiento de prosa —los criterios CR1 y CR3 comprueban ausencia en el pack implement y presencia en el pack core sobre la MISMA salida compuesta, y los dos pins de snapshot cambian a la vez—, asi que separarlas dejaria un commit intermedio con el contrato incoherente. Es exactamente la mezcla inevitable por tareas inseparables que este change legitima. Resultado medido: core 192/200 lineas y 11657/12000 bytes, bloque ## Commits en 27 lineas (techo 28), implement baja a 168/205 y 8205/10000. Ninguna normativa retirada para caber: sobran 3 lineas y 343 bytes.
- **2026-07-27T21:11:39Z** `[note]` Tarea 4: gate completo verde — 822 tests, biome limpio (una linea reformateada por ancho tras repuntar los pins), changeledger check conforme.
- **2026-07-27T21:12:10Z** `[status]` in-progress → in-review
- **2026-07-27T21:12:11Z** `[note]` [review mandate] Mandato: superficie que gobierna — el diff completo de la rama para este change mas toda sede de prosa de commits en templates/contract/ y todo pin que la fije en test/. Puntos de escrutinio explicitos: (a) si alguna obligacion salio de implement.md sin sede verificada por grep de la obligacion misma; (b) si las clasificaciones preserved/replaced/retired de los dos pins de snapshot son ciertas, que salieron falsas ocho veces en 124835; (c) si las siete aserciones repuntadas en cli.test.mjs muerden o quedaron vacuas; (d) si se toco review/validation/close, que es FAIL por alcance; (e) si el bloque cabe por compresion legitima y no por retirada silenciosa.
- **2026-07-27T21:19:19Z** `[review]` in-review → in-progress (retry): CR8 falsificado: dos obligaciones salieron de implement.md sin sede en el contrato. (1) 'record why' del checkpoint de handoff: grep en templates/contract/ no la encuentra en ningún fragmento, y el comentario de clasificación del pin de implement.md declara esa frase retirada a core.md nombrando el checkpoint y el 'never one per transition' pero omitiendo la cláusula del registro. (2) 'name every change sharing the surface' del commit combinado inevitable: la prosa nueva pide registrar qué se combinó y por qué, pero ya no exige nombrar cada change que comparte la superficie. Ambas caben sin añadir líneas.
- **2026-07-27T21:22:13Z** `[status]` in-progress → in-review
- **2026-07-27T21:22:13Z** `[note]` [review mandate] Segunda ronda, mandato minimo: spot check de la correccion — las dos obligaciones restauradas en core.md, la clasificacion de los dos pins y el techo. Sin re-auditar la superficie ya verificada. Correccion sin commitear.
- **2026-07-27T21:26:56Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-27T21:26:56Z** `[note]` Correccion confirmada por revisor fresco. Aclaracion de conteo que el revisor senalo: el bloque ## Commits mide 28 lineas del encabezado a su ultima linea con contenido —la convencion que codifica commitsBlockLines() y contra la que CR7 verifica— y 29 si se cuenta el blanco separador anterior al siguiente encabezado. No hay incumplimiento, pero la correccion lo llevo de 27 a 28: el bloque queda SIN margen contra su techo y cualquier anadido futuro lo rompe. El core queda en 193/200 lineas y 11728/12000 bytes.
