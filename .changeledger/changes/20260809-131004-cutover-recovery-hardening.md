---
id: "20260809-131004"
title: Recuperar el cutover ante señuelos e interrupciones
type: bug
status: draft
created: 2026-08-09T13:10:04Z
depends_on: ["20260809-113240"]
related_to: []
owner: rarc88
---

## Request

Follow-ups del review de `20260809-113240`, autorizados por el humano el
2026-08-09: un commit señuelo brickea ambos comandos de adopción, y las
ventanas de interrupción del cutover fallan cerrado pero sin recuperación por
re-ejecución ni mensaje que diga cómo salir. Incluye dos remates de calidad
del mismo review: orden de búsqueda explícito por descendencia y una aserción
casi vacua en los tests de `activate`.

Fuera de alcance: cualquier resolución automática de conflictos de contenido
(el conflicto de revert sigue siendo del humano) y cualquier cambio en la
condición de reversibilidad (la ref de estado en el baseline registrado).

## Investigation

Los cuatro hallazgos vienen del review y la confirmación de `20260809-113240`,
todos ejecutados en fixtures por los revisores, no razonados:

- **Señuelo sin trailer (causa raíz del brick).** `cutoverBaselineAt`
  (`src/commands/cutover.mjs`) lanza por diseño cuando un commit tiene el
  subject exacto del cutover pero no el trailer
  `Changeledger-Cutover-Baseline`; `findCutover` deja escapar ese throw en
  lugar de tratar el commit como no-match. Ejecutado: con un commit manual así
  sembrado antes del corte, `cutover` sale 1, y tras un corte legítimo
  `cutover --undo` también sale 1 — un corte real con trailer válido más
  profundo en la historia nunca se alcanza. Solo lo produce un commit escrito
  a mano (cherry-pick y rebase arrastran el trailer), y falla ruidoso, pero
  deja ambos comandos inutilizables hasta limpiar la historia.
- **Ventanas de interrupción sin salida.** Tres estados intermedios son
  alcanzables si el proceso muere a mitad; ninguno se recupera re-ejecutando y
  los mensajes nombran el síntoma, no el estado ni la salida:
  - S2 (media publicación): `initState` corrió y el `mutateState` del config
    no; la ref existe con manifest + config con pérdida. Re-ejecutar `cutover`
    dice "already exists … refusing to touch refs" y el humano queda solo ante
    un `update-ref -d` a mano sin pista en el mensaje.
  - S3 (publicado y activado, sin commit de limpieza): re-ejecutar `cutover`
    falla con "already activated" aunque lo único pendiente sea el commit de
    limpieza, que es determinista.
  - S1 (undo interrumpido entre el commit de revert y el borrado de refs): el
    ledger está de vuelta en el worktree y el repo sigue activado; `--undo`
    dice "nothing to undo" y `cutover` dice "already activated" — el repo
    parece deshecho y no lo está.
- **Orden de búsqueda implícito.** "El más reciente" en `findCutover` es el
  orden por defecto de `git log`, priorizado por fecha entre ramas. En
  historia lineal la topología manda (ejecutado con fechas invertidas), pero
  un corte alcanzado vía merge de una rama lateral podría en principio
  ordenarse por fecha; `--topo-order` hace explícita la intención sin coste.
- **Aserción casi vacua.** El test "activate outside a ChangeLedger repo" de
  `test/activate.test.mjs` asierta `/ChangeLedger/`, que matchea casi
  cualquier error del comando.

Clasificación de changes relacionados: `20260809-113240` (done, graduado a
`architecture.md`) es prerrequisito de ejecución — este change edita el código
que aquél creó. La sección "Adopción del estado global" de `architecture.md`
documenta el comportamiento vigente y se reconciliará al graduar.

## Specification

### CR1 — Un señuelo sin trailer no brickea los comandos
- **Given** una historia con un commit manual cuyo subject es exactamente `chore(state): cut the ledger over to the state ref` pero sin el trailer `Changeledger-Cutover-Baseline`, y un corte legítimo posterior
- **When** se ejecutan `changeledger cutover` (re-run) y `changeledger cutover --undo`
- **Then** el señuelo se ignora como no-match con un aviso que nombra su oid, el re-run es no-op con exit 0 y el undo revierte el corte legítimo con exit 0

### CR2 — El corte vivo se elige por descendencia, no por fecha
- **Given** una historia donde el commit de cutover vivo es el más reciente por topología pero el más antiguo por fecha de committer, con un corte deshecho alcanzable vía merge de una rama lateral con fechas posteriores
- **When** se ejecuta `changeledger cutover --undo`
- **Then** se revierte el corte vivo (el más reciente por descendencia desde HEAD) y el ledger queda restaurado byte a byte

### CR3 — La media publicación nombra el estado y la salida
- **Given** un repo donde `initState` publicó la ref de estado pero la activación no existe (interrupción S2)
- **When** se ejecuta `changeledger cutover`
- **Then** el comando falla con exit distinto de cero y el mensaje declara que existe una publicación a medias, nombra la ref presente y la ausente, y da la salida manual literal (`git update-ref -d refs/heads/changeledger/state`) antes de re-ejecutar

### CR4 — El corte publicado y activado se completa re-ejecutando
- **Given** un repo con la ref de estado y la activación presentes y coherentes con el ledger del commit de integración, pero sin el commit de limpieza (interrupción S3)
- **When** se ejecuta `changeledger cutover`
- **Then** exit 0: se crea únicamente el commit de limpieza pendiente y el resultado final es indistinguible de un cutover no interrumpido

### CR5 — El undo interrumpido se completa re-ejecutando
- **Given** un repo donde el commit de revert del undo ya aterrizó pero las refs de estado y activación siguen presentes con la ref en el baseline (interrupción S1)
- **When** se ejecuta `changeledger cutover --undo`
- **Then** exit 0: se borran ambas refs con old-value observado y el repo queda desactivado, indistinguible de un undo no interrumpido

## Plan

- [ ] `findCutover` trata el subject sin trailer como no-match con aviso, y
  ordena la búsqueda con `--topo-order`
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Detección y mensaje de la media publicación con la salida manual literal
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR3
- [ ] Reanudación determinista de las ventanas S3 (cutover) y S1 (undo)
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR4, CR5
- [ ] Endurecer la aserción del test "activate outside a ChangeLedger repo"
  para que fije el mensaje real en vez de `/ChangeLedger/`
  - **Support:**
  - **Verify:** `node --test test/activate.test.mjs`
- [ ] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
