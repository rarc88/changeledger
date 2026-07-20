---
id: "20260704-144327"
title: Esqueletos de prompt portables por rol para delegar subagentes
type: feature
status: done
created: 2026-07-04T14:43:27Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Al delegar trabajo a subagentes (investigación, implementación, review), el
orquestador redacta el prompt de delegación desde cero cada vez, guiado solo
por la prosa de `delegation.md`. Eso deja margen a omitir detalles críticos
bajo presión — el change 20260704-114323 documentó exactamente ese patrón para
review (el subagente terminó sin restricción de solo lectura explícita porque
el orquestador no la incluyó en su prompt ad hoc).

Se quiere un esqueleto de prompt por rol —investigación, implementación,
review— que el orquestador pueda obtener de forma determinista y portable
(cualquier repo que instale `changeledger`, no solo este), en vez de redactar
cada delegación desde cero.

## Investigation

`templates/contract/*.md` es el contrato canónico que vive dentro del paquete
`changeledger` (ver `.changeledger/specs/contract-discovery.md`); no existe
como carpeta en los repos que consumen la herramienta. Por eso un puntero de
tipo "lee el archivo en `templates/contract/...`" solo funciona en este repo
(que es la propia herramienta, dogfooding) — en cualquier otro repo esa ruta
no existe en el working tree del agente. La única entrega portable es a través
de un comando CLI que imprima el contenido por stdout, como ya hace
`changeledger context <mode>` vía `buildContext`/`compose` en
`src/commands/context.mjs`.

El core es el único contexto garantizado durante la conversación inicial,
antes de crear un draft. Ya contiene la regla mínima de que cada delegación
debe declarar ownership, retorno e integración. El descubrimiento del comando
de esqueletos debe añadirse a esa misma regla, sin sumar otra sección; si se
anunciara solo en `delegation.md`, compuesto en `spec` e `implement`, el rol de
investigación se descubriría demasiado tarde para su caso principal.

La validación humana rechazó la primera entrega porque aplicó ese bootstrap del
orquestador también a los delegados. Los tres esqueletos ordenaban cargar el
core completo y, para implementación/review, el contexto por id. Eso entrega a
una hoja read-only toda la matriz de lifecycle y los mecanismos del
orquestador, y a implementación la guía completa de mutaciones, correcciones y
handoff. La seguridad quedaba en una prohibición textual posterior, pero la
audiencia recibía conocimiento operacional que no necesita.

La corrección requiere una entrada distinta, no adelgazar el core para todos.
Un delegado que llega identificado por un esqueleto emitido por ChangeLedger
puede cargar una cápsula autocontenida de su rol. El bootstrap administrado debe
reconocer esa excepción estrecha sin permitir que un agente normal se salte el
core.

Los contextos operan con presupuestos de bytes ajustados a propósito (ver Log
de 20260704-114323 y el rediseño de presupuestos a múltiplos de 1000). Insertar
el contenido completo de tres esqueletos en cualquier composición la inflaría
en cada carga para un contenido que solo hace falta al delegar. Los archivos
deben quedar fuera de las composiciones y servirse bajo demanda por un comando
propio; el core incorpora únicamente su puntero de descubrimiento.

`templates/contract/review.md` mezclaba el checklist de inspección con los
comandos de veredicto del orquestador. La primera entrega hizo que el esqueleto
referenciara ese pack completo. La corrección mueve el checklist, sin copiarlo,
a la cápsula `agent-context review`; `review.md` conserva la orquestación y los
veredictos. Así cada audiencia tiene una sola fuente.

Antes de la corrección, `changeledger context review` mezclaba checklist del
revisor con mecánica del orquestador, y `changeledger context <change-id>`
infería ese mismo pack desde lifecycle. Ninguno era apropiado para una hoja
delegada. La cápsula de review posee ahora solo inspección y retorno;
implementation recibe Specification/Plan y disciplina de escritura sin
comandos de ledger.
Investigación puede delegarse antes de que exista un change, por lo que su
cápsula admite id opcional.

El contrato vigente de `delegation.md` exige que todo prompt declare motivo,
ownership o pregunta, resultado esperado, dificultad o riesgo e integración.
Los esqueletos deben materializar todos esos campos, no reducir el contrato a
límites y retorno. Esos límites se expresan por efectos (no modificar archivos,
Git o ledger), no con nombres de herramientas como `Edit`/`Write`, que cambian
entre harnesses y dejarían vías de escritura equivalentes sin cubrir.

Como los esqueletos son assets estáticos del paquete y no leen configuración
del proyecto, el comando no necesita un repo inicializado. La promesa de
portabilidad exige probar además que los archivos entran en el paquete
publicable, no solo que existen en el checkout de desarrollo.

## Proposal

Añadir un comando nuevo, independiente de `context`: `changeledger agent-prompt
<role>`, con `role` en `investigation | implementation | review`. Imprime por
stdout el esqueleto correspondiente y funciona aunque el directorio actual no
sea un repo ChangeLedger. La salida usa delimitadores propios,
`CHANGELEDGER AGENT PROMPT BEGIN — role: <role> — v<version>` y
`CHANGELEDGER AGENT PROMPT END — if this line is missing, the output was
truncated: stop and re-run`, con el mismo protocolo anti-truncamiento que
`context` sin presentar el asset como si fuera un contexto compuesto. La
implementación comparte el mecanismo de framing/versionado para que ambos
sentinelas no diverjan por copias independientes.

El contenido de cada esqueleto vive en un archivo de texto plano nuevo,
`templates/contract/agent-prompts/<role>.md`, fuera de `MODE_CONTEXT` — no se
compone en ningún modo existente, así que no afecta los presupuestos de
`spec`/`implement`/`review`/`release`/`core`; solo su puntero se integra en la
regla mínima de delegación ya presente en `core.md`. Cada archivo declara el
rol, qué efectos tiene autorizados, que no vuelve a delegar ni muta el ledger,
qué debe devolver y placeholders literales para todos los campos de
`delegation.md`:
motivo, ownership/pregunta, resultado, dificultad/riesgo e integración. Los
placeholders adicionales son específicos del rol: `{{question}}` y un
`{{change_id}}` opcional para investigación; `{{change_id}}` y `{{files}}`
para implementación; `{{change_id}}` para review.

Cada esqueleto identifica al receptor como delegado y le ordena ejecutar una
única entrada autocontenida: `changeledger agent-context <role> [change-id]`.
El nuevo comando requiere un repo ChangeLedger, deriva la política efectiva y
compone un fragmento mínimo del rol. Implementation y review exigen id;
investigation lo admite opcional. Cuando hay id se adjunta el change completo,
porque su longitud pertenece al trabajo, no al contrato base.

Las cápsulas viven en `templates/contract/agent-contexts/<role>.md`, fuera de
`MODE_CONTEXT`. Investigation y review son read-only. Implementation limita
escrituras al ownership recibido en el prompt. Ninguna cápsula enseña comandos
de status, task, log, review, graduación o archivo; ningún delegado vuelve a
delegar. Review contiene el checklist canónico de inspección, mientras
`templates/contract/review.md` conserva solo la receta del orquestador y apunta
a la cápsula para la inspección, evitando dos checklists.

`agent-context implementation` solo acepta changes `approved` o `in-progress`;
`review` solo `in-review`. La salida usa framing/versionado propio y declara
explícitamente que no extiende el core ni lo necesita. El bootstrap administrado
permite saltar el core únicamente cuando un prompt de delegación ChangeLedger
identifica el rol y ordena esta entrada; el flujo normal sigue ejecutando
`changeledger context` primero.

La frase existente en `core.md` sobre el contrato mínimo del prompt añade
`changeledger agent-prompt <role>` como forma de obtener el esqueleto completo.
No se repite el puntero en `delegation.md`: el core posee el descubrimiento y
el pack de tarea conserva el detalle normativo.

Se descarta interpolar automáticamente los placeholders (leer el change y
sustituir `{{change_id}}` por su valor real) en esta primera entrega: es lógica
nueva que no se justifica todavía sin evidencia de que rellenar a mano genere
fricción real. Se descarta también crear roles adicionales (`verification`,
`proposal-spec`) ahora — se agregan después como archivos nuevos, sin rediseño,
si hace falta. Se descarta cualquier definición de subagente específica de
Claude Code (p. ej. `.claude/agents/*.md` con restricción estructural de
herramientas): el contrato de ChangeLedger debe seguir siendo agnóstico de
herramienta/harness.

Se descarta reutilizar directamente `implement.md` o `review.md` en las
cápsulas: ambos contienen responsabilidades del orquestador. También se
descarta confiar solo en la prohibición del prompt mientras se carga el core
completo: reduce autoridad por prosa, pero no reduce contexto ni ambigüedad.

## Specification

### CR1 — El comando imprime el esqueleto de un rol conocido
- **Given** una instalación de ChangeLedger, incluso fuera de un repo inicializado
- **When** se ejecuta `changeledger agent-prompt review`
- **Then** la salida comienza con `===== CHANGELEDGER AGENT PROMPT BEGIN — role: review — v<version> =====`
- **And** contiene exactamente el contenido de `templates/contract/agent-prompts/review.md`
- **And** termina con `===== CHANGELEDGER AGENT PROMPT END — if this line is missing, the output was truncated: stop and re-run =====`
- **And** el mismo comando con `investigation` o `implementation` imprime el archivo correspondiente

### CR2 — Rol desconocido falla con mensaje útil
- **Given** una instalación de ChangeLedger, incluso fuera de un repo inicializado
- **When** se ejecuta `changeledger agent-prompt scaffolding` (rol no reconocido)
- **Then** el comando termina con código de salida distinto de cero
- **And** el mensaje de error lista los roles válidos (`investigation, implementation, review`)

### CR3 — Cada esqueleto materializa el contrato completo de delegación
- **Given** el archivo `templates/contract/agent-prompts/<role>.md` para cada rol
- **When** se lee su contenido
- **Then** incluye placeholders para motivo, ownership o pregunta, resultado esperado, dificultad o riesgo e integración
- **And** declara qué debe devolver el subagente al orquestador y que no puede volver a delegar ni mutar el ledger
- **And** investigación y review prohíben cualquier operación que modifique archivos, Git o el ledger, sin depender de nombres de herramientas de un harness
- **And** implementación limita las escrituras a los archivos bajo ownership, prohíbe revertir trabajo ajeno, exige reportar solapamientos y reserva el ledger al orquestador

### CR4 — Cada rol carga el contexto disponible sin inventar un change
- **Given** un subagente nuevo que recibe uno de los esqueletos
- **When** comienza su trabajo en el repo objetivo
- **Then** el esqueleto lo identifica como delegado y usa `changeledger agent-context <role> [change-id]` como única carga ChangeLedger
- **And** no le ordena cargar `changeledger context` ni `changeledger context <id>`
- **And** implementación y review exigen `change_id`
- **And** investigación admite que todavía no exista `change_id` y lo pasa solo cuando el orquestador lo proporciona

### CR5 — El core descubre el comando antes de que exista un draft
- **Given** un agente que acaba de cargar el bootstrap core durante la conversación inicial
- **When** considera delegar una investigación antes de crear un change
- **Then** la regla mínima de delegación en `templates/contract/core.md` referencia `changeledger agent-prompt <role>` para obtener el esqueleto completo
- **And** no incorpora el contenido de los esqueletos ni duplica el puntero en `delegation.md`
- **And** la prueba de presupuesto de bytes/líneas (`225213 CR6` en `test/context.test.mjs`) sigue pasando con los valores actuales (8000/12000/8000/4000/3000), sin necesitar otro ajuste de emergencia

### CR6 — Los esqueletos forman parte del paquete portable
- **Given** el artefacto que publicaría `npm pack`
- **When** se inspecciona su lista de archivos
- **Then** contiene los tres archivos bajo `templates/contract/agent-prompts/`
- **And** contiene las tres cápsulas bajo `templates/contract/agent-contexts/`
- **And** el comando los resuelve desde la instalación del paquete, no desde el working tree del repo consumidor

### CR7 — Agent-context entrega una cápsula autocontenida y valida el rol
- **Given** un repo ChangeLedger y un change en el estado apropiado
- **When** se ejecuta `changeledger agent-context review <id>` o `implementation <id>`
- **Then** la salida tiene delimitadores `CHANGELEDGER AGENT CONTEXT BEGIN/END`, política efectiva, la cápsula del rol y el change completo
- **And** declara que sustituye al core para ese delegado y que no debe cargar `changeledger context`
- **And** implementation solo acepta `approved|in-progress` y review solo `in-review`, con error sin escribir para otro estado
- **And** investigation funciona sin id y adjunta el change solo cuando recibe uno

### CR8 — Cada cápsula conoce solo su responsabilidad
- **Given** las tres salidas base de `agent-context` sin contar el change adjunto
- **When** se inspeccionan sus reglas y presupuesto
- **Then** investigation y review son read-only; implementation limita escritura al ownership del prompt
- **And** ninguna contiene comandos de lifecycle, task, log, review, graduación o archivo ni guía para volver a delegar
- **And** review contiene el único checklist del delegado y `templates/contract/review.md` se limita a la receta/veredicto del orquestador con un puntero a esa cápsula
- **And** cada salida base queda bajo 60 líneas y 3000 bytes

### CR9 — El bootstrap conserva el flujo normal y permite la excepción delegada
- **Given** un `AGENTS.md` registrado por ChangeLedger
- **When** lo lee un agente normal
- **Then** sigue obligado a ejecutar primero `changeledger context` completo
- **And** solo un agente identificado por un prompt `agent-prompt` puede ejecutar en su lugar el `agent-context` del mismo rol
- **And** ambos caminos conservan el protocolo de captura completa y fallo cerrado por centinela

## Plan

- [x] Añadir pruebas fallidas en `test/agent-prompt.test.mjs` para salida delimitada exacta dentro y fuera de un repo y error de rol desconocido; luego implementar `src/commands/agent-prompt.mjs`, compartir el framing/versionado necesario y registrar `agent-prompt` en `bin/changeledger.mjs`; verify: `node --test test/agent-prompt.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-05T14:24:08Z`
- [x] Escribir `templates/contract/agent-prompts/investigation.md`, `implementation.md` y `review.md` con todos los campos de delegación, límites por efectos, retorno y carga de contexto por rol; verify: `node --test test/agent-prompt.test.mjs` (CR3, CR4)
  - **Resolved:** `2026-07-05T14:24:08Z`
- [x] Ampliar la regla mínima existente en `templates/contract/core.md` con el puntero a `changeledger agent-prompt <role>`, sin duplicarlo en `delegation.md`; verify: `node --test test/context.test.mjs` (confirma descubrimiento pre-draft y que `225213 CR6` sigue pasando sin tocar los presupuestos) (CR5)
  - **Resolved:** `2026-07-05T14:24:08Z`
- [x] Añadir en `test/agent-prompt.test.mjs` cobertura del artefacto publicable que compruebe la inclusión y resolución de `templates/contract/agent-prompts/` desde el paquete; verify: `node --test test/agent-prompt.test.mjs` (CR6)
  - **Resolved:** `2026-07-05T14:24:08Z`
- [x] Ejecutar el quality gate completo al terminar; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-05T14:24:08Z`
- [x] Añadir regresiones en `test/agent-context.test.mjs`, `test/agent-prompt.test.mjs` y `test/contract.test.mjs`, luego implementar `src/commands/agent-context.mjs`, registrar el comando en `bin/changeledger.mjs` y refrescar bootstrap/README; verify: `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs test/contract.test.mjs` (CR4, CR7, CR9)
  - **Resolved:** `2026-07-05T22:22:18Z`
- [x] Crear `templates/contract/agent-contexts/{investigation,implementation,review}.md`, mover allí el checklist delegado de `templates/contract/review.md` y ajustar los esqueletos para la entrada única; verify: `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs test/context.test.mjs` (CR4, CR8)
  - **Resolved:** `2026-07-05T22:22:18Z`
- [x] Probar los presupuestos base y el artefacto publicable desde `test/agent-context.test.mjs` y `test/agent-prompt.test.mjs`, manteniendo el core dentro de su presupuesto; verify: `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs test/context.test.mjs` (support)
  - **Resolved:** `2026-07-05T22:22:18Z`
- [x] Ejecutar el quality gate completo tras la corrección; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-10T10:22:14Z`

## Log

- **2026-07-04T23:32:10Z** `[note]` Draft refinado tras revisión humana: límites agnósticos por efectos, contrato completo de delegación, contexto por change id para implementación/review, investigación sin id, comando utilizable fuera de un repo, delimitadores propios y prueba del paquete portable. Se mantienen los presupuestos actuales; el puntero bajo demanda debe caber sin ampliarlos.
- **2026-07-04T23:32:10Z** `[note]` La graduación a `.changeledger/specs/contract-discovery.md` queda como decisión post-aceptación exigida por el lifecycle, no como tarea de implementación que impediría llegar a review.
- **2026-07-04T23:59:24Z** `[note]` Corregida la descubribilidad pre-draft: el puntero a `agent-prompt` pertenece a la regla mínima de delegación del core, único contexto garantizado durante la conversación inicial, y no a `delegation.md`. El contenido completo sigue bajo demanda y los presupuestos no cambian.
- **2026-07-05T13:57:37Z** `[status]` draft → approved
- **2026-07-05T14:16:24Z** `[status]` approved → in-progress
- **2026-07-05T14:16:24Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-05T14:24:08Z** `[note]` Comando agent-prompt <role> anadido (investigation|implementation|review), sirve esqueletos estaticos del paquete via stdout con delimitadores propios; funciona fuera de repo; rol desconocido sale con codigo !=0. Framing/version extraidos a src/framing.mjs compartido con context (salida byte-identica). 3 plantillas en templates/contract/agent-prompts/ con contrato completo de delegacion, limites por efectos, retorno y carga de contexto por rol. Puntero en core.md (reempaquetado para no exceder 120 lineas), sin duplicar en delegation. Test de npm pack confirma inclusion portable. 548 tests verdes.
- **2026-07-05T14:24:08Z** `[status]` in-progress → in-review
- **2026-07-05T14:36:11Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-05T16:53:38Z** `[validation]` in-validation → in-progress (human rejected): Necesita ajustes
- **2026-07-05T22:24:17Z** `[note]` Corrección tras rechazo humano: añadido agent-context autocontenido por rol con guards de lifecycle, política efectiva y change adjunto; bootstrap permite la excepción solo a prompts agent-prompt del mismo rol; checklist delegado movido a la cápsula review. Bases medidas: investigation 892 bytes, implementation 1082 bytes, review por debajo de 3000 bytes; lint/check y 119 tests contractuales verdes. Gate completo pendiente por rechazo de permiso de la app antes de ejecutar.
- **2026-07-10T10:22:14Z** `[note]` Gate completo recuperado: pnpm verify verde (555 tests, lint y changeledger check). Se desbloquea la tarea de quality gate.
- **2026-07-10T10:22:14Z** `[status]` in-progress → in-review
- **2026-07-10T10:25:22Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-10T20:16:09Z** `[validation]` in-validation → done (human accepted)
- **2026-07-10T20:19:47Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-10T20:19:48Z** `[archive]` archived
