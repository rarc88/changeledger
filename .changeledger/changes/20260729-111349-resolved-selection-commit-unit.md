---
id: "20260729-111349"
title: La unidad de commit es la selección resuelta, no el change entero
type: bug
status: draft
created: 2026-07-29T11:13:49Z
depends_on: []
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

### Segunda sede del mismo empuje

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

### Obligación de graduación

`.changeledger/specs/git-traceability.md` lleva la formulación estrecha **en castellano**,
en su párrafo *"La unidad de commit es el change, y las clases son contables"* y en el de
granularidad que cierra con *"un change produce **dos** commits"*. Al graduar hay que
reescribir los dos; dejarlos sería la clase 19/48, que ya se fugó cinco veces en esta
iniciativa. Su párrafo de formulaciones retiradas también necesita una tercera entrada.

## Specification

La clase Implementation deja de ser contable. El bloque `## Commits` pasa a decir que la
unidad de implementación es **la selección de trabajo resuelta**: se commitea cuando queda
resuelta, sin esperar al resto, y el número de commits de implementación por change no se
fija. La prueba de granularidad se aplica a esa unidad en vez de saltar de la tarea al
change. La garantía del rango del review se conserva como obligación de secuencia —toda
selección commiteada antes de delegar el review— y no como conteo.

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

## Plan

- [ ] Reescribir la clase Implementation y el párrafo de granularidad en `templates/contract/core.md`, retargeteando en la misma pasada los pins de snapshot y sus comentarios de clasificación; verify: `node --test test/context.test.mjs` (CR1, CR2)
- [ ] Ajustar el párrafo de commit combinado y fijar la obligación de secuencia del rango del review en `templates/contract/core.md`, con la aserción que la protege; verify: `node --test test/context.test.mjs` (CR3, CR4)
- [ ] Quitar el cuantificador por tarea de la fila de propiedad del bloque de contexto en `templates/contract/core.md`; verify: `node --test test/cli.test.mjs` (CR5)
- [ ] Correr el gate completo y `changeledger check --commits` antes de pedir review (support)

## Log

- **2026-07-29T11:20:00Z** `[note]` Redactado con la frase literal de Roberto citada en el Request, por la lección de que una decisión traducida de dominio (delegación → commits) es donde se perdió la primera vez. Medido antes de escribir criterios: 5 ocurrencias de `**Implementation**: exactly one`, 2 de `never one per Plan task`, bloque a 32/125 líneas y 620/1250 tokens, core a 197/400 y 2648/4000. Descartado por vacuo un CR de presupuesto: con 93 líneas de holgura no podría fallar (clase del hallazgo 28). El dimensionado del grupo de delegación queda fuera de alcance a propósito, es de CH-5b.
