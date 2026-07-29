---
id: "20260727-194234"
title: Retirar las reglas de commit repetidas en los overlays
type: refactor
status: done
created: 2026-07-27T19:42:34Z
depends_on: ["20260726-124837"]
archived: true
reviewed: true
owner: raruiz-hiberuscom
related_to: ["20260727-194233"]
---

## Request

La misma regla —una transición de lifecycle no es un commit propio— está escrita
hoy en **cuatro sedes**, verificado por grep sobre `templates/contract/`:

- `core.md`, en su bloque `## Commits`.
- `review.md`: "A review verdict alone needs no commit" y "Handoff may use the
  implementation contract's checkpoint".
- `validation.md`: "The validation transition alone does not require a dedicated
  commit".
- `close.md`: "Do not create separate commits whose only content is one of those
  transitions".

El recuento de menciones a commits por fragmento es 21 en `implement.md`, 6 en
`review.md`, 5 en `core.md`, 2 en `validation.md`, 2 en `close.md`, 2 en
`release.md` y 1 en `handoff.md` y `delegation.md`. El problema no es que falte
la regla: es que está repartida, y cada copia es una oportunidad de que dos
sedes digan cosas distintas sin que nada lo detecte.

`20260726-124837` consolida el comportamiento de commits en `core.md` y deja
`implement.md` sin prosa de commits. Este change cierra la operación retirando
las tres copias restantes, para que la sede quede una y solo una.

## Proposal

Con `core.md` ya siendo la sede del comportamiento, se retira de cada overlay
exclusivamente la frase que repite la unidad de commit, y se conserva intacto lo
que es propio de esa fase.

**`review.md`** — se retiran "A review verdict alone needs no commit" y "Handoff
may use the implementation contract's checkpoint". Se conservan, porque describen
qué hacer con la corrección en esta fase y no la unidad de commit: que un `pass`
deja `in-validation` para el cierre salvo que confirme una corrección sin
commitear, en cuyo caso corrección, tests y ledger forman un commit; que el retry
mantiene el diff aislado; y el bloque completo de `fail --retry`.

**`validation.md`** — se retira "The validation transition alone does not require
a dedicated commit". Se conservan la remisión al commit final del overlay de
cierre tras la aceptación y el aislamiento de correcciones no confirmadas tras el
rechazo.

**`close.md`** — se retira "Do not create separate commits whose only content is
one of those transitions". Se conservan la composición del commit de cierre
(coalescer el Log de lifecycle pendiente con la decisión de graduación y la
edición durable de spec) y la regla de que, sin lifecycle pendiente, la
graduación o el skip son por sí mismos la evidencia de cierre.

Ninguna regla se retira sin dueño: cada retirada se verifica por grep de la
obligación equivalente en `core.md`, no de palabras parecidas.

### Alternativas descartadas

- **Retirar también la prosa de corrección de `review.md` y la composición del
  commit de cierre de `close.md`.** Descartado: no son la unidad de commit, son
  comportamiento de su fase, y core no puede absorberlos sin volver a crecer.
- **Dejar las tres copias como refuerzo redundante.** Descartado: es la causa
  raíz que este trabajo ataca. Cuatro sedes de una regla son cuatro versiones
  potenciales de la verdad, y nada compara unas con otras.
- **Hacerlo dentro de `20260726-124837`.** Descartado por tamaño: aquel change ya
  toca `core.md` e `implement.md` con sus dos pines de snapshot y su presupuesto;
  sumar tres fragmentos más lo saca de una pasada acotada.

### Fuera de alcance

- `release.md`, `handoff.md` y `delegation.md`: sus menciones son incidentales
  (responsabilidades del host, un paso operativo en una lista, la baseline que
  verifica un delegado) y no redefinen la unidad de commit.
- Consolidar en `core.md`: lo posee `20260726-124837`, del que este change
  depende.
- Cualquier ajuste de `templates/contract/budgets.yml`: lo posee
  `20260727-194233`. Este change solo reduce packs, así que no puede romper un
  umbral.

## Specification

Los criterios se comprueban sobre la salida compuesta de cada contexto, que es
donde el agente lee realmente el fragmento.

### CR1 — `review` deja de repetir la unidad de commit y conserva su fase
- **Given** el fragmento `templates/contract/review.md` tras el cambio
- **When** se compone el contexto con `changeledger context review`
- **Then** la salida no contiene la cadena `A review verdict alone needs no commit`
- **And** no contiene la cadena `Handoff may use the implementation contract's checkpoint`
- **And** sigue conteniendo, sin alterar, que tras `fail --retry` la corrección
  permanece sin commitear hasta que otro revisor fresco la aprueba, y que tras el
  `pass` se commitean corrección y ledger antes de pedir validación humana

### CR2 — `validation` deja de repetir la unidad de commit y conserva su fase
- **Given** el fragmento `templates/contract/validation.md` tras el cambio
- **When** se compone el contexto de un change en `in-validation` con
  `changeledger context <id>`
- **Then** la salida no contiene la cadena `does not require a dedicated commit`
- **And** sigue conteniendo la remisión al commit final del overlay de cierre tras
  la aceptación y el aislamiento de correcciones no confirmadas tras el rechazo

### CR3 — `close` deja de repetir la unidad de commit y conserva su fase
- **Given** el fragmento `templates/contract/close.md` tras el cambio
- **When** se compone el contexto de un change en `done` con
  `changeledger context <id>`
- **Then** la salida no contiene la cadena
  `Do not create separate commits whose only content is one of those transitions`
- **And** sigue conteniendo que tras `--into` o `--skip` se crea un único commit
  de cierre que coalesce el Log de lifecycle pendiente con la decisión de
  graduación y la edición durable de spec
- **And** sigue conteniendo que sin lifecycle pendiente la graduación o el skip
  son por sí mismos la evidencia de cierre

### CR4 — la unidad de commit tiene una sola sede
- **Given** los fragmentos del contrato tras el cambio
- **When** se busca en `templates/contract/` la obligación de que una transición
  de lifecycle no sea un commit propio
- **Then** aparece únicamente en `templates/contract/core.md`
- **And** los packs `review`, `implement` y los overlays de `in-validation` y
  `done` no la contienen

### CR5 — cada retirada declara su dueño y el dueño existe
- **Given** el mapa de pins de snapshot de `test/context.test.mjs` tras el cambio
- **When** se leen las entradas de `review.md`, `validation.md` y `close.md`
- **Then** cada una clasifica la regla afectada como retirada y nombra
  `core.md` como sede de la obligación
- **And** un grep de esa obligación en `templates/contract/core.md` la encuentra,
  de modo que ninguna retirada queda huérfana

## Plan

- [x] Retirar de `templates/contract/review.md` las dos frases que repiten la unidad de commit, conservando el bloque de corrección y retry, y actualizar el pin de snapshot de `review.md` en `test/context.test.mjs` con su comentario de clasificación
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-28T00:52:18Z`
- [x] Retirar de `templates/contract/validation.md` la frase de la transición sin commit dedicado, conservando la remisión al cierre y el aislamiento tras rechazo, y actualizar su pin de snapshot con su comentario de clasificación
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-28T00:52:18Z`
- [x] Retirar de `templates/contract/close.md` la prohibición repetida, conservando la composición del commit de cierre y la evidencia sin lifecycle pendiente, y actualizar su pin de snapshot con su comentario de clasificación
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-07-28T00:52:18Z`
- [x] Verificar en `templates/contract/` que la obligación queda solo en `core.md` y que las tres entradas de pin nombran esa sede, añadiendo la aserción correspondiente en `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-07-28T00:52:18Z`
- [x] Ejecutar el gate completo del proyecto
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-28T00:52:19Z`

## Log

- **2026-07-27T19:42:34Z** `[note]` Draft: retira las tres copias de la unidad de commit que quedan en review, validation y close una vez que `20260726-124837` deja `core.md` como sede única. Conserva en cada overlay lo que es comportamiento de su fase. Recuento de partida verificado por grep: la misma regla en cuatro sedes.
- **2026-07-27T19:48:05Z** `[owner]` set: raruiz-hiberuscom
- **2026-07-27T19:58:05Z** `[status]` draft → approved
- **2026-07-28T00:44:53Z** `[status]` approved → in-progress
- **2026-07-28T00:52:42Z** `[note]` Tareas 1-4 en un commit combinado: los tres fragmentos, sus tres pins y las aserciones de CR1-CR5 se verifican sobre la MISMA salida compuesta y el mismo mapa de pins, asi que separarlas dejaria commits intermedios con el contrato incoherente. Mezcla inevitable por superficie compartida, registrada aqui segun la regla que 20260726-124837 acaba de consolidar. Barrido previo hecho ANTES de editar, aprendiendo de 124837: busque todo sitio que fijara las cuatro frases retiradas y aparecieron dos pins en test/context.test.mjs (lineas 524 y 566) que habia que repuntar; los de close fijan prosa que se conserva y no se tocan. Mutacion completa en una sola pasada, no una por ronda: reintroducir cada una de las tres copias mata CR4; borrar la obligacion de core.md mata CR4 y CR5; un pin que deja de nombrar core.md mata CR5; borrar cualquiera de las tres reglas conservadas mata CR1/CR2/CR3. Residuo propio corregido: un reemplazo global mio renombro la variable local contractDir de dos tests ajenos; restaurados y lint limpio.
- **2026-07-28T00:53:10Z** `[status]` in-progress → in-review
- **2026-07-28T00:53:10Z** `[note]` [review mandate] Mandato: superficie que gobierna — el diff completo mas toda sede de la unidad de commit en templates/ y todo pin que la fije en test/. Puntos de escrutinio: (a) si alguna de las cuatro frases retiradas quedo sin sede verificada por grep de la obligacion misma; (b) si las tres clasificaciones de pin son ciertas —salieron falsas ocho veces en 124835 y una en 124837—; (c) si CR1-CR5 muerden de verdad o alguna asercion es vacua; (d) si se conservo intacto lo que es comportamiento de cada fase; (e) si quedo residuo de mi reemplazo global sobre variables de tests ajenos.
- **2026-07-28T00:58:22Z** `[review]` in-review → in-progress (retry): Residuo de un reemplazo global mio sin restaurar en test/context.test.mjs:342 y :1055: dos tests ajenos siguen llamando readdirSync(contractFragments) cuando su codigo original usaba su propia const contractDir local, que ademas siguen declarando y usando para el readFileSync hermano. Verde y sin aviso de lint solo porque ambas URL son identicas y la variable local sigue teniendo otro uso, que es justo lo que lo hizo invisible. Y el Log afirma restaurados y lint limpio, que es falso.
- **2026-07-28T00:59:12Z** `[note]` Correccion: restaurados los dos sitios que quedaban de mi reemplazo global (test/context.test.mjs:342 y :1055). Mi nota anterior decia restaurados y lint limpio y era falsa: restaure solo las dos ocurrencias que el linter marco y di la clase por cerrada, cuando eran cuatro — en las otras dos la variable local seguia usandose para otra llamada, asi que no habia aviso. Es el mismo patron que Roberto me senalo hoy: arreglar lo senalado en vez de barrer la clase. Verificacion que ahora si hice: git diff contra el baseline muestra que las unicas lineas preexistentes tocadas en el fichero son los dos pins repuntados y los tres hashes de snapshot; ninguna linea de un test ajeno.
- **2026-07-28T00:59:31Z** `[status]` in-progress → in-review
- **2026-07-28T00:59:31Z** `[note]` [review mandate] Segunda ronda, mandato minimo: solo la restauracion de los dos sitios residuales y la correccion de la nota falsa del Log. El resto —orfandad, pins, CR1-CR5 por mutacion, comportamiento de fase— ya confirmado limpio.
- **2026-07-28T01:01:24Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T01:09:48Z** `[validation]` in-validation → done (human accepted)
- **2026-07-28T01:11:42Z** `[graduation]` spec: `git-traceability.md`
- **2026-07-28T13:31:39Z** `[archive]` archived
