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

- [ ] `task` construye el candidato y rechaza sobre `introducedErrors`
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Rechazo del `bin` en stderr y código de salida
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR1
- [ ] Operación «marcar una tarea» en la matriz de sedes
  - **Target:** `test/seats-matrix.test.mjs`
  - **Verify:** `node --test test/seats-matrix.test.mjs`
  - **Criteria:** CR5
- [ ] Suite completa y puertas del repo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-23T09:49:31Z** `[version]` 0.18.0
- **2026-10-23T09:58:33Z** `[status]` draft → approved (human via conversation)
- **2026-10-23T11:51:37Z** `[status]` approved → in-progress
- **2026-10-23T11:51:37Z** `[branch]` set: bug/20261023-094931 (auto)
- **2026-10-23T11:51:43Z** `[note]` Rama bug/20261023-094931 creada apilada sobre bug/20261023-094844 (c0b85e61) por orden del humano: la matriz de sedes vive en test/seats-matrix.test.mjs y la regla introducedErrors viene del PR 19.
