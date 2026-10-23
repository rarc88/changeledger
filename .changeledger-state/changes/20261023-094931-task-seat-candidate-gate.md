---
id: "20261023-094931"
title: La sede task corre la misma comprobación de candidato que apply
type: bug
status: in-progress
created: 2026-10-23T09:49:31Z
depends_on: []
branch: bug/20261023-094931
related_to: ["20261022-213751", "20261021-223918", "20260811-110629"]
owner: raruiz-hiberuscom
---

## Request

Dos sedes de la misma operación responden distinto a la misma entrada.
Marcar una tarea del Plan tiene dos sedes: el comando suelto
`changeledger task <id> block|done <n>` y la entrada
`{"op": "task", "id": "<id>", "action": "block|done", "n": <n>}` de
`changeledger apply`. Sobre un change `done` con todas sus tareas hechas,
`task <id> block 1 "r"` escribe el bloqueo y deja el repo con el error de
`check` `status is "done" but 1 task(s) are not done`; la misma entrada
vía `apply` se rechaza en el guard final del candidato,
`assertCandidateClean`, sin escribir nada. Lo ejecutó la revisión de
`#20261022-213751` y quedó registrado en su Log como fuera de alcance.

Lo pedido: que `task` corra sobre el documento que su transformación
produce la misma regla que `apply` aplica al candidato —solo los errores
que la escritura introduce la rechazan— y que la matriz de sedes lo
someta junto a `apply`. Queda fuera: `log` y `owner`, cuyas
transformaciones no producen ningún error de `check` que se haya
ejecutado, y `status`, que ya valida con `assertChangeTextValid`.

## Investigation

### Las dos sedes y su regla

| sede | función | regla actual |
|---|---|---|
| `task <id> <action> <n>` | `task` en `src/commands/agent.mjs`: `locate` + `mutateLedgerFile(repo, target, taskMutation(...))` | ninguna comprobación del documento resultante |
| `apply {"op": "task"}` | `applyEvent` en `src/commands/apply.mjs` con la misma `taskMutation`, y después `assertCandidateClean` sobre `introducedErrors(repo, candidate)` | solo los errores que el lote introduce |

Comparten la transformación de texto (`taskMutation` es la sede única del
«qué se escribe») y divergen en la puerta: `apply` valida el candidato
completo contra el repo cargado; `task` escribe lo que `setTask` devuelva.
`setTask` solo rechaza lo estructural (no hay sección Plan, índice fuera
de rango); el estado del change no entra.

### Causa raíz

Las sedes de evento se añadieron como transformaciones de texto reutilizadas
por `apply` (`#20260811-110629`), y la puerta de candidato se puso en
`apply`, que es donde había un candidato acumulado que validar. El comando
suelto nunca construyó un candidato, así que nunca tuvo puerta. Es la misma
forma que `#20261022-213751` cerró en las sedes de documento: una regla en
una sede y no en la otra.

### Dirección

- `task` construye el candidato (`repo.changes` con el documento mutado
  en lugar del actual), calcula `introducedErrors(repo, candidate)` con el
  ayudante de `src/check.mjs` y, si hay alguno, rechaza antes de escribir
  con un mensaje que nombra la sede y copia la forma de `apply`:
  `task <id> <n> <action> refused, nothing was written — the resulting
  candidate carries N validation error(s):` seguido de una línea por error
  `  <fichero>: <mensaje>`.
- Igual en las dos disposiciones: en worktree el documento queda
  byte-idéntico; en activado el tip de la ref de estado no se mueve.
- `test/seats-matrix.test.mjs` gana una operación «marcar una tarea» con
  las dos sedes y entradas enumeradas: bloquear sobre `done` (rechazo),
  marcar hecha sobre `in-progress` (aceptación), bloquear sobre
  `in-progress` (aceptación); falsable por sede.
- Verdad persistente: `architecture.md` describe la regla de admisión como
  la de «las sedes de documento» y dice que `assertCandidateClean`
  «responde por lo que una entrada de evento deja detrás, como un `task
  block` sobre un change `done`». Al cerrar, `task` entra en la lista de
  sedes sobre la regla y el ejemplo del guard deja de ser `task block`
  (`--into architecture`).

Interfaces externas: el mensaje de rechazo de `task` es salida nueva de CLI;
se declara estable y se fija en CR1.

## Specification

### CR1 — task block sobre un change done se rechaza sin escribir
- **Given** un repo activado con un change `done` de tipo `feature`, con una tarea del Plan resuelta y `checkRepo` sin errores
- **When** se ejecuta `task <id> block 1 "r"`
- **Then** rechaza con el mensaje completo `task <id> 1 block refused, nothing was written — the resulting candidate carries 1 validation error(s):` seguido de la única línea `  <fichero del change>: status is "done" but 1 task(s) are not done`
- **And** el tip de `refs/heads/changeledger/state` no se mueve y el documento almacenado es byte-idéntico
- **And** `changeledger task <id> block 1 r` desde el `bin` imprime `Error: <ese mensaje>` en stderr y sale con código distinto de cero

### CR2 — El mismo rechazo en un repo en worktree
- **Given** el mismo change en un repo sin activar
- **When** se ejecuta `task <id> block 1 "r"`
- **Then** rechaza con el mismo mensaje y el fichero del change queda byte-idéntico

### CR3 — task done y task block sobre in-progress siguen aceptando
- **Given** un change `in-progress` con una tarea abierta
- **When** se ejecuta `task <id> done 1`
- **Then** acepta y la tarea queda `[x]` con su `Resolved`, como fija hoy el test `task done marks the task with a timestamp` de `test/agent.test.mjs`
- **And** `task <id> block 1 "r"` sobre otro change `in-progress` acepta y la tarea queda `[!]` con su `Blocked`

### CR4 — Un error previo ajeno no bloquea task
- **Given** un repo con un change `in-progress` con una tarea abierta y otro change que `check` reporta como `<otro>.md: parent references missing change "20200101-000000"`
- **When** se ejecuta `task <id> done 1` sobre el primero
- **Then** acepta
- **And** `task <id> block 1 "r"` sobre un change `done` del mismo repo rechaza listando solo la línea `status is "done" but 1 task(s) are not done`, sin la del otro change

### CR5 — Las dos sedes de marcar una tarea responden igual en la matriz
- **Given** las entradas enumeradas de la operación «marcar una tarea» en `test/seats-matrix.test.mjs`: bloquear sobre `done`, marcar hecha sobre `in-progress`, bloquear sobre `in-progress`
- **When** cada entrada se somete a `task` y a `apply` con `{"op": "task"}`
- **Then** las dos sedes responden lo mismo en cada fila: rechazo, aceptación, aceptación
- **And** cada fila es falsable por sede: anular la comprobación de candidato en `task` pone en rojo la fila de `done` nombrando `task`

## Plan

- [x] `task` construye el candidato y rechaza sobre `introducedErrors`
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-23T12:10:31Z`
- [x] Rechazo del `bin` en stderr y código de salida
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-23T12:10:31Z`
- [x] Operación «marcar una tarea» en la matriz de sedes
  - **Target:** `test/seats-matrix.test.mjs`
  - **Verify:** `node --test test/seats-matrix.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-23T12:10:32Z`
- [x] Suite completa y puertas del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-23T12:13:32Z`

## Log
- **2026-10-23T09:49:31Z** `[version]` 0.18.0
- **2026-10-23T09:58:33Z** `[status]` draft → approved (human via conversation)
- **2026-10-23T11:51:37Z** `[status]` approved → in-progress
- **2026-10-23T11:51:37Z** `[branch]` set: bug/20261023-094931 (auto)
- **2026-10-23T11:51:43Z** `[note]` Rama bug/20261023-094931 creada apilada sobre bug/20261023-094844 (c0b85e61) por orden del humano: la matriz de sedes vive en test/seats-matrix.test.mjs y la regla introducedErrors viene del PR 19.
- **2026-10-23T12:10:33Z** `[note]` Selección única (tareas 1-3) implementada: task construye el candidato con el texto mutado y rechaza sobre introducedErrors dentro del callback de mutateLedgerFile, con el mensaje 'task <id> <n> <action> refused, nothing was written — the resulting candidate carries N validation error(s):'; en worktree carga el repo con isolateChangeErrors para que un hermano ilegible no cueste la marca (decisión no especificada, con test propio). Tests CR1-CR5 rojo→verde con evidencia literal; mutantes: quitar la puerta pone en rojo CR1, CR2, CR4 y la fila done de la matriz nombrando task; gatear sobre todos los errores pone en rojo CR4; quitar assertCandidateClean de apply pone en rojo la fila done por desacuerdo de sedes. Residual del change corregido por el orquestador: el comentario de test/apply.test.mjs que decía que la sede task no rechaza. Decisión del implementador aceptada: la entrada del registro 'assertCandidateClean has no matrix that reaches its refusal' se borra porque la fila done de la matriz la alcanza ahora (mutante c). Residual preexistente, fuera de alcance: en repo activado locate carga sin aislamiento, así que un hermano ilegible sigue bloqueando task ahí. Residual de cierre: architecture.md nombra task como ejemplo de lo que solo el guard final de apply responde.
- **2026-10-23T12:13:33Z** `[note]` Tarea 4: pnpm verify — biome limpio (134 ficheros), suite 2145/2146; el único fallo es 'CR6: the skeletons ship in the publishable package' (npm 12, preexistente en dev, ajeno a este change); changeledger check en verde por separado.
- **2026-10-23T12:13:33Z** `[status]` in-progress → in-review
- **2026-10-23T12:13:38Z** `[note]` Mandato de la revisión (ronda 1): auditoría completa del diff bug/20261023-094844..HEAD —un commit: src/commands/agent.mjs, test/{agent,cli,seats-matrix,apply}.test.mjs— contra CR1-CR5 y contra la superficie que el change gobierna: las dos sedes de marcar una tarea (task y apply op:task) y la regla introducedErrors que ahora comparten. Fuera del mandato se reporta sin inspeccionar.
- **2026-10-23T12:23:15Z** `[review]` in-review → in-progress: ronda 1 (auditoría completa): CR1-CR5 confirmados con mutantes por sede y por mensaje; un defecto de prosa del orquestador: el comentario reescrito en test/apply.test.mjs dice que taskMutation 'itself refuses nothing', falso como universal (lanza ante n fuera de rango, razón ausente y acción desconocida); estrechar al evento. Menor: el comentario de src/check.mjs lista cinco sedes sobre introducedErrors y task es la sexta. Clasificación: enumeración incompleta de prosa dentro de la estrategia verificada; corrección normal sobre el mismo diff.
- **2026-10-23T12:24:12Z** `[note]` Corrección de la ronda 1, prosa solo, sin commit hasta confirmación: el comentario de test/apply.test.mjs se estrecha a 'taskMutation does not refuse it (it checks the task line, not the change's status)'; el comentario de src/check.mjs sobre introducedErrors añade task como sede sobre la misma regla. Follow-ups reportados por el revisor fuera de mandato: (1) en worktree, task ahora carga el repo completo y un spec sin frontmatter o un release .yml ilegible lo hace lanzar un error crudo donde antes aceptaba — coincide con apply, status y el repo activado; sin criterio que lo cubra, decisión del humano; (2) en repo activado un hermano ilegible sigue bloqueando task vía locate, preexistente; (3) el reemplazo de candidato de task sustituye todo change con el mismo id, replaceChange de apply solo el primero: solo importa con un error de id duplicado ya presente.
