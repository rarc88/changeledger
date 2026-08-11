---
id: "20260811-110629"
title: Aterrizar lotes de documentos y eventos en una entrada
type: feature
status: done
created: 2026-08-11T11:06:29Z
depends_on: []
reviewed: true
branch: feature/20260811-110629
related_to: ["20260810-182641"]
owner: rarc88
---

## Request

Decisión conversada con el humano (2026-08-11): el journal de la ref acumula
una entrada por comando cuando el evento lógico es uno solo, y la creación o
actualización de varios documentos exige hoy una invocación (y un commit)
por documento. Se pide un comando que acepte un manifiesto y aterrice
lotes — documentos enteros y eventos de lifecycle propiedad del agente —
como UNA entrada de journal, todo-o-nada.

Dirección fijada en conversación: el manifiesto es un envelope fino (cada
entrada lleva el Markdown completo del documento), nunca una segunda
gramática JSON del contenido por secciones; la edición por secciones queda
excluida — el reemplazo completo es la unidad que garantiza documentos
enteros.

## Investigation

Hechos medidos sobre el journal real (2026-08-11, 96 entradas para ~10
changes):

- `new` + `edit` suman 13 entradas; la ceremonia de lifecycle (`status` 25,
  `log` 17, `owner` 8, `task` 7, `validation` 9, graduaciones 9) suma ~70.
  Un lote solo-documentos ataca el 15% del goteo; el evento lógico completo
  ("arranco el change": status+owner+log; "cierro el lote": validation×N)
  es donde está el volumen.
- La primitiva de aterrizaje múltiple existe y está probada:
  `writeLedgerFiles` (`src/change-store.mjs`) aterriza N entradas en un
  commit CAS (la usan `graduate` — spec+change juntos — y el flujo de
  documentos de `20260810-182641`).
- Las guardas por documento existen en `edit`/`new --from`
  (`src/commands/edit.mjs`, `src/commands/new.mjs`): validación íntegra a la
  severidad del status, inmutables, campos con comando dueño, idempotencia
  byte a byte. El lote las reutiliza por entrada; no nace una segunda
  política.
- Las transiciones tienen dueño (tabla del core): `approve` y
  `validation pass` son del humano; un lote ejecutado por el agente no debe
  poder transportarlas.
- El BEGIN/END persistente entre comandos se descartó en conversación
  (2026-08-11): rompería la verdad única del resolver (overlay staged vs
  ref), crearía estados a medias recuperables y una clase nueva de fallo
  (transacción abandonada). La vida del lote es UN proceso.

## Proposal

Un comando nuevo, `changeledger apply --from <file|->`, que lee un
manifiesto JSON y lo aterriza entero:

- **Entradas de documento:** `{"target": "new" | "change:<id>" |
  "spec:<slug>", "content": "<markdown completo>"}` — semántica idéntica a
  `new --from` / `edit` por entrada, incluidas todas sus guardas y la
  idempotencia (una entrada byte-idéntica no aporta cambios).
- **Entradas de evento (solo ops propiedad del agente):** `{"op": "status" |
  "log" | "task" | "owner", ...args}` — cada op aplica exactamente las
  mismas validaciones que su comando individual. Las transiciones del humano
  (`approve`, `validation pass`) y las terminales se RECHAZAN en el
  manifiesto: siguen siendo comandos individuales y auditables por diseño.
- **Atomicidad:** todo el manifiesto se valida y materializa contra un único
  árbol candidato y aterriza como UN commit CAS (`apply: <resumen>`);
  cualquier entrada inválida = nada aterriza y el error nombra la entrada y
  el defecto. Un manifiesto cuyo efecto neto es vacío es no-op exit 0.
- **Orden:** las entradas se aplican en el orden del manifiesto sobre el
  candidato (un `edit` puede seguir a un `new` del mismo documento dentro
  del lote); la validación de cada entrada ve el candidato acumulado.
- **Modo inactivo:** mismas semánticas y guardas sobre el worktree
  (escrituras atómicas por archivo, sin atomicidad cruzada — la misma
  asimetría documentada de `writeLedgerFiles` — y sin ningún commit).

Alternativas descartadas:

- JSON estructurado por secciones del documento: segunda representación del
  Markdown que puede derivar; dos gramáticas para el mismo contenido.
- Edición por secciones: el autor ya sostiene el documento completo al
  decidir el cambio; el direccionamiento añade bordes (secciones repetidas,
  orden) sin ahorrar composición.
- Transacción persistente BEGIN/END: ver Investigation.
- Permitir transiciones humanas en el lote: abarataría exactamente la
  auditabilidad que la tabla de dueños existe para proteger.

El comando acepta `--dry-run`: valida el manifiesto completo — errores y
warnings de `check` sobre el candidato resultante — sin escribir nada, para
que el ciclo componer→corregir itere en local y el journal reciba UNA
entrada ya limpia. Evidencia del 2026-08-11: crear el draft de este mismo
change costó 3 entradas (`new` + 2 `edit`) porque los warnings solo
aparecían tras aterrizar.

Escenarios: arranque de change (status+owner+log en una entrada); creación
de varios drafts de una tanda (N `new` en una entrada, sustituyendo al
vehículo+import de la etapa 2); corrección de frontmatter en lote (el caso
real del 2026-08-11: restaurar el owner de ~9 changes archivados debe costar
una entrada, no nueve); componer→dry-run→corregir→aterrizar una vez;
manifiesto con una entrada corrupta (nada aterriza); lote en repo inactivo.

## Specification

### CR1 — Un manifiesto de N documentos aterriza en un solo commit
- **Given** un repo activado y un manifiesto con dos `new` (documentos completos válidos) y un `change:<id>` de un change existente
- **When** se ejecuta `changeledger apply --from <manifiesto>`
- **Then** los tres documentos quedan en la ref exactamente como los declara el manifiesto y el journal gana exactamente un commit

### CR2 — Una entrada inválida impide todo el lote
- **Given** un manifiesto donde una entrada intermedia viola una guarda (documento inválido, campo con dueño alterado, o id tomado)
- **When** se ejecuta `changeledger apply`
- **Then** exit distinto de cero nombrando la entrada (posición o id) y el defecto, y la ref queda inmóvil — ninguna entrada anterior aterrizó

### CR3 — Los eventos de agente comparten la entrada
- **Given** un manifiesto con `{"op":"status", to:"in-progress"}`, `{"op":"owner"}` y `{"op":"log"}` sobre el mismo change approved
- **When** se ejecuta `changeledger apply`
- **Then** el change queda in-progress con owner y Log actualizados, todo en un único commit de journal, y cada op aplicó las mismas validaciones que su comando individual

### CR4 — Las transiciones del humano no viajan en el lote
- **Given** un manifiesto que incluye `{"op":"status", to:"approved"}` (o una op `validation`/`discard`)
- **When** se ejecuta `changeledger apply`
- **Then** el lote entero se rechaza nombrando la op y su comando individual dueño, sin escribir nada

### CR5 — Idempotencia del lote
- **Given** un manifiesto ya aplicado cuyo efecto neto sobre el candidato es vacío
- **When** se re-ejecuta `changeledger apply` con el mismo manifiesto
- **Then** exit 0 sin ningún commit nuevo en el journal

### CR6 — Modo inactivo simétrico
- **Given** un repo inactivo y un manifiesto válido de documentos y eventos de agente
- **When** se ejecuta `changeledger apply`
- **Then** el efecto sobre el worktree es el mismo que los comandos individuales y no se crea ningún commit en ninguna ref

### CR7 — dry-run valida todo sin escribir
- **Given** un manifiesto cuyo candidato produciría un warning de `check` (p. ej. una mención sin declarar) y otro manifiesto limpio
- **When** se ejecuta `changeledger apply --dry-run` con cada uno
- **Then** el primero reporta el warning exacto que `check` daría tras aterrizar y el segundo reporta limpio, la ref queda inmóvil en ambos y ningún archivo del worktree cambia

### CR8 — Primer uso end-to-end
- **Given** este propio repo activado y la próxima tanda real de trabajo
- **When** se arranca un change con un solo `apply` (status+owner+log) y se draftean dos documentos de una tanda con otro
- **Then** el journal gana exactamente dos entradas para lo que hoy costaba cinco o más, con `list`/`show`/viewer sirviendo el resultado idéntico al de los comandos individuales

## Plan

- [x] Parser y validación del manifiesto: envelope, targets, ops permitidas
  y rechazo de ops del humano
  - **Target:** `src/commands/apply.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR2, CR4
  - **Resolved:** `2026-08-11T11:29:17Z`
- [x] Aterrizaje atómico: candidato acumulado en orden, `writeLedgerFiles`,
  idempotencia
  - **Target:** `src/commands/apply.mjs`, `src/change-store.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR1, CR3, CR5
  - **Resolved:** `2026-08-11T11:29:17Z`
- [x] Camino inactivo y `--dry-run`
  - **Target:** `src/commands/apply.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR6, CR7
  - **Resolved:** `2026-08-11T11:29:18Z`
- [x] Dogfood del primer uso real y suite completa
  - **Target:** `src/commands/apply.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR8
  - **Resolved:** `2026-08-11T14:16:16Z`

## Log
- **2026-08-11T11:12:37Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T11:12:37Z** `[status]` approved → in-progress
- **2026-08-11T11:12:37Z** `[branch]` set: feature/20260811-110629 (auto)
- **2026-08-11T11:31:58Z** `[note]` Implementación cerrada (CR1–CR7; CR8 queda para el primer uso real). Decisiones que el documento no fijaba: (1) el manifiesto es un array JSON de entradas, sin envelope ni resumen del autor — el subject `apply: <resumen>` se genera de las entradas y se trunca a 96 caracteres con `+N more`; (2) una entrada `new` admite `slug` opcional para nombrar el archivo y, si falta, se deriva del título del propio documento; (3) las entradas de evento nombran su change con `id` y llevan los argumentos de su comando individual: status `to`, log `message`, task `action`/`n`/`reason`, owner `name` (`-` limpia); (4) una op fuera de las cuatro del agente se rechaza nombrando su comando dueño cuando lo tiene, y como `unknown op` si no; (5) los warnings de `check` sobre el candidato se reportan en los dos modos, no solo en `--dry-run`; (6) el error de una entrada se etiqueta con su posición más su `target` (documento) u `op` (evento); (7) `writeLedgerFiles` no necesitó extensión — ya aterriza N entradas en un commit CAS; `apply` solo crea los directorios que falten antes de la llamada en modo inactivo; (8) un manifiesto vacío es no-op válido, no error de forma; (9) si dos entradas tocan el mismo documento, la idempotencia se juzga contra lo que sostiene el ledger, no contra la entrada anterior. Las guardas por entrada se reutilizan como costuras extraídas (prepareChangeEdit/prepareSpecEdit en edit.mjs, prepareNewChange en new.mjs, statusMutation/ownerMutation/logMutation/taskMutation y assertStatusDestinationAllowed en agent.mjs), sin copiar política.
- **2026-08-11T11:34:11Z** `[status]` in-progress → in-review
- **2026-08-11T11:34:12Z** `[note]` Mandato del review: auditoría completa del diff dev..HEAD — comando de escritura por lotes nuevo MÁS la extracción de asientos compartidos de edit/new/agent (riesgo prioritario: deriva de comportamiento en los comandos individuales refactorizados); CR8 queda para el dogfood del orquestador tras el cierre
- **2026-08-11T11:42:38Z** `[review]` in-review → in-progress (retry): F1: apply --dry-run imprime los errores de checkRepo(candidate) pero sale con exit 0 (apply.mjs ~86 computa errors sin gatearlos), así que componer→dry-run→aterrizar no es puerta programática: un script aterriza un lote que pnpm verify rechaza después. Corregir: exit distinto de cero en dry-run cuando el candidato lleva errores, con test que lo pinee
- **2026-08-11T11:49:32Z** `[status]` in-progress → in-review
- **2026-08-11T11:49:32Z** `[note]` Mandato de la confirmación: mínimo — F1 cerrado (dry-run gatea errores del candidato con exit real) + ausencia de regresión en el diff sin commitear
- **2026-08-11T11:55:32Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-11T14:16:17Z** `[note]` CR8 ejecutado con trabajo real: tanda de 2 drafts (122030+122031) en UNA entrada de journal + arranque de 122030 (status+log) en UNA — 2 entradas donde el flujo por comandos costaba 5+. Antes, primer uso productivo: restauración del owner de 10 changes archivados en una entrada (112→113). El dry-run cazó un warning de mención antes de aterrizar en su primer uso
- **2026-08-11T14:16:17Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T14:16:48Z** `[graduation]` spec: `architecture.md`
