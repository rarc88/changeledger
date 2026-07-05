---
id: "20260704-144327"
title: Esqueletos de prompt portables por rol para delegar subagentes
type: feature
status: in-review
created: 2026-07-04T14:43:27Z
depends_on: []
owner: raruiz-hiberuscom
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

Los contextos operan con presupuestos de bytes ajustados a propósito (ver Log
de 20260704-114323 y el rediseño de presupuestos a múltiplos de 1000). Insertar
el contenido completo de tres esqueletos en cualquier composición la inflaría
en cada carga para un contenido que solo hace falta al delegar. Los archivos
deben quedar fuera de las composiciones y servirse bajo demanda por un comando
propio; el core incorpora únicamente su puntero de descubrimiento.

`templates/contract/review.md` ya documenta el checklist de inspección y los
comandos de veredicto para quien revisa. Un esqueleto de prompt para el rol
`review` no debe repetir ese checklist — debe referenciarlo, para no crear una
segunda fuente de verdad que pueda divergir (el mismo riesgo identificado en
20260704-114323 CR2).

El modo genérico `changeledger context review` entrega el checklist, pero no
adjunta el change seleccionado. En cambio, `changeledger context <change-id>`
infiere el pack correcto desde el lifecycle y añade el documento concreto con
sus CR y Plan. Para implementación y review, donde el change ya existe, el
esqueleto debe señalar el contexto por id después del bootstrap obligatorio.
Investigación también puede delegarse durante la conversación inicial, antes
de que exista autorización para crear un change; su esqueleto no puede exigir
un `change_id`.

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

Todo esqueleto recuerda obedecer primero el bootstrap del repo. Implementación
y review indican después `changeledger context {{change_id}}`, que entrega el
pack inferido y el change seleccionado. Investigación permite trabajar sin id;
si el orquestador proporciona uno, usa también su contexto por id. El
esqueleto de review referencia el checklist recibido por ese contexto, en vez
de repetirlo.

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
- **Then** el esqueleto le exige obedecer primero el bootstrap del repo
- **And** implementación y review usan `changeledger context {{change_id}}` para recibir el pack inferido y el change seleccionado
- **And** review usa el checklist de ese contexto sin duplicarlo en el esqueleto
- **And** investigación admite que todavía no exista `change_id` y solo carga contexto por id cuando el orquestador proporciona uno

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
- **And** el comando los resuelve desde la instalación del paquete, no desde el working tree del repo consumidor

## Plan

- [x] Añadir pruebas fallidas en `test/agent-prompt.test.mjs` para salida delimitada exacta dentro y fuera de un repo y error de rol desconocido; luego implementar `src/commands/agent-prompt.mjs`, compartir el framing/versionado necesario y registrar `agent-prompt` en `bin/changeledger.mjs`; verify: `node --test test/agent-prompt.test.mjs` (CR1, CR2) — 2026-07-05T14:24:08Z
- [x] Escribir `templates/contract/agent-prompts/investigation.md`, `implementation.md` y `review.md` con todos los campos de delegación, límites por efectos, retorno y carga de contexto por rol; verify: `node --test test/agent-prompt.test.mjs` (CR3, CR4) — 2026-07-05T14:24:08Z
- [x] Ampliar la regla mínima existente en `templates/contract/core.md` con el puntero a `changeledger agent-prompt <role>`, sin duplicarlo en `delegation.md`; verify: `node --test test/context.test.mjs` (confirma descubrimiento pre-draft y que `225213 CR6` sigue pasando sin tocar los presupuestos) (CR5) — 2026-07-05T14:24:08Z
- [x] Añadir en `test/agent-prompt.test.mjs` cobertura del artefacto publicable que compruebe la inclusión y resolución de `templates/contract/agent-prompts/` desde el paquete; verify: `node --test test/agent-prompt.test.mjs` (CR6) — 2026-07-05T14:24:08Z
- [x] Ejecutar el quality gate completo al terminar; verify: `pnpm verify` (support) — 2026-07-05T14:24:08Z

## Log

- **2026-07-04T23:32:10Z** — Draft refinado tras revisión humana: límites agnósticos por efectos, contrato completo de delegación, contexto por change id para implementación/review, investigación sin id, comando utilizable fuera de un repo, delimitadores propios y prueba del paquete portable. Se mantienen los presupuestos actuales; el puntero bajo demanda debe caber sin ampliarlos.
- **2026-07-04T23:32:10Z** — La graduación a `.changeledger/specs/contract-discovery.md` queda como decisión post-aceptación exigida por el lifecycle, no como tarea de implementación que impediría llegar a review.
- **2026-07-04T23:59:24Z** — Corregida la descubribilidad pre-draft: el puntero a `agent-prompt` pertenece a la regla mínima de delegación del core, único contexto garantizado durante la conversación inicial, y no a `delegation.md`. El contenido completo sigue bajo demanda y los presupuestos no cambian.
- **2026-07-05T13:57:37Z** — status: draft → approved
- **2026-07-05T14:16:24Z** — status: approved → in-progress
- **2026-07-05T14:16:24Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-05T14:24:08Z** — Comando agent-prompt <role> anadido (investigation|implementation|review), sirve esqueletos estaticos del paquete via stdout con delimitadores propios; funciona fuera de repo; rol desconocido sale con codigo !=0. Framing/version extraidos a src/framing.mjs compartido con context (salida byte-identica). 3 plantillas en templates/contract/agent-prompts/ con contrato completo de delegacion, limites por efectos, retorno y carga de contexto por rol. Puntero en core.md (reempaquetado para no exceder 120 lineas), sin duplicar en delegation. Test de npm pack confirma inclusion portable. 548 tests verdes.
- **2026-07-05T14:24:08Z** — status: in-progress → in-review
