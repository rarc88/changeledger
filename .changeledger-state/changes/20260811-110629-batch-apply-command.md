---
id: "20260811-110629"
title: Aterrizar lotes de documentos y eventos en una entrada
type: feature
status: draft
created: 2026-08-11T11:06:29Z
depends_on: []
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

Escenarios: arranque de change (status+owner+log en una entrada); creación
de varios drafts de una tanda (N `new` en una entrada, sustituyendo al
vehículo+import de la etapa 2); corrección de frontmatter en lote;
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

### CR7 — Primer uso end-to-end
- **Given** este propio repo activado y la próxima tanda real de trabajo
- **When** se arranca un change con un solo `apply` (status+owner+log) y se draftean dos documentos de una tanda con otro
- **Then** el journal gana exactamente dos entradas para lo que hoy costaba cinco o más, con `list`/`show`/viewer sirviendo el resultado idéntico al de los comandos individuales

## Plan

- [ ] Parser y validación del manifiesto: envelope, targets, ops permitidas
  y rechazo de ops del humano
  - **Target:** `src/commands/apply.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR2, CR4
- [ ] Aterrizaje atómico: candidato acumulado en orden, `writeLedgerFiles`,
  idempotencia
  - **Target:** `src/commands/apply.mjs`, `src/change-store.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR1, CR3, CR5
- [ ] Camino inactivo
  - **Target:** `src/commands/apply.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR6
- [ ] Dogfood del primer uso real y suite completa
  - **Target:** `src/commands/apply.mjs`
  - **Verify:** `pnpm verify`
  - **Criteria:** CR7

## Log
