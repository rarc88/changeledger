---
id: "20260809-131004"
title: Recuperar el cutover ante señuelos e interrupciones
type: bug
status: in-validation
created: 2026-08-09T13:10:04Z
depends_on: ["20260809-113240", "20260809-113241"]
branch: integration/in-validation
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

Ampliado el 2026-08-09 por decisión del humano con dos absorciones del review
de `20260809-113241`: extraer el lector compartido del árbol del ledger que
`import.mjs` duplicó de `cutover.mjs` porque este archivo estaba vetado
durante su implementación, y devolver el fail-fast al fixture compartido de
tests que la corrección de B relajó con `--allow-empty` global.

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
- **Duplicación deliberada (review de `20260809-113241`).** `readLedgerAt` y
  `toPosix` en `src/commands/import.mjs` son casi-duplicados de los de
  `src/commands/cutover.mjs` (~85-90% compartido según el diff del revisor;
  la divergencia real es que el import no exige `config.yml`). Fue la opción
  correcta bajo el veto de archivo, pero el hogar de esa lectura es un módulo
  compartido.
- **Fail-fast del fixture relajado (confirmación de `20260809-113241`).** El
  helper `activatedRepo` de `test/import.test.mjs` pasó a commitear el source
  con `--allow-empty` porque un escenario nuevo no escribe archivos; con ello
  todos los escenarios pierden el fallo ruidoso "nothing to commit" que
  delataba un fixture que no escribió nada. Debe ser opt-in por escenario.

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

### CR6 — La extracción del lector compartido no cambia comportamiento
- **Given** el lector del árbol del ledger extraído a un módulo compartido y `cutover.mjs` e `import.mjs` consumiéndolo
- **When** se ejecutan las suites existentes `test/cutover.test.mjs` y `test/import.test.mjs`
- **Then** pasan sin modificar ninguna aserción (hoy pasan: 14/14 y 10+ de cutover en verde en dev), y la única divergencia funcional entre ambos consumidores sigue siendo que el import no exige `config.yml` en la fuente

## Plan

- [x] `findCutover` trata el subject sin trailer como no-match con aviso, y
  ordena la búsqueda con `--topo-order`
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-09T15:21:35Z`
- [x] Detección y mensaje de la media publicación con la salida manual literal
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-08-09T15:21:35Z`
- [x] Reanudación determinista de las ventanas S3 (cutover) y S1 (undo)
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-08-09T15:21:35Z`
- [x] Extraer el lector compartido del árbol del ledger y consumirlo desde
  `cutover.mjs` e `import.mjs`
  - **Target:** `src/commands/cutover.mjs`, `src/commands/import.mjs`
  - **Verify:** `node --test test/cutover.test.mjs test/import.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-09T15:21:36Z`
- [x] Endurecer la aserción del test "activate outside a ChangeLedger repo"
  para que fije el mensaje real en vez de `/ChangeLedger/`
  - **Support:**
  - **Verify:** `node --test test/activate.test.mjs`
  - **Resolved:** `2026-08-09T15:21:36Z`
- [x] Devolver el fail-fast al fixture de `test/import.test.mjs`: el
  `--allow-empty` del source pasa a ser opt-in por escenario
  - **Support:**
  - **Verify:** `node --test test/import.test.mjs`
  - **Resolved:** `2026-08-09T15:21:36Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T15:21:36Z`

## Log
- **2026-08-09T14:52:37Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T14:55:26Z** `[status]` approved → in-progress
- **2026-08-09T14:55:26Z** `[branch]` set: bug/20260809-131004 (auto)
- **2026-08-09T15:22:20Z** `[status]` in-progress → in-review
- **2026-08-09T15:23:34Z** `[note]` Mandato de review: auditoría completa de CR1-CR6, ventanas S1-S3, selección topológica, CAS de borrado de refs, extracción compartida y regresiones de cutover/import/activate; candidato fijo 420d8945 sobre baseline c44d987f.
- **2026-08-09T15:31:30Z** `[review]` in-review → in-progress (retry): CR4 no reanuda S3 cuando la limpieza exacta ya quedó staged entre git rm y git commit; CR5 puede borrar refs con cambios no confirmados en colecciones configuradas fuera de .changeledger/.
- **2026-08-09T15:37:37Z** `[status]` in-progress → in-review
- **2026-08-09T15:37:37Z** `[note]` Mandato de review de confirmación: verificar exclusivamente S3 con limpieza exacta ya staged, rechazo de staging parcial/extra y S1 con cambios no confirmados en colecciones configuradas externas; candidato sin commit sobre 420d8945.
- **2026-08-09T15:41:37Z** `[review]` in-review → in-progress (retry): CR4 aún permite completar S3 con contenido ledger ignorado y no trackeado porque exactStagedCleanup usa ls-files --others --exclude-standard.
- **2026-08-09T15:46:01Z** `[status]` in-progress → in-review
- **2026-08-09T15:46:01Z** `[note]` Mandato de segunda confirmación: verificar únicamente contenido ledger ignorado/no trackeado durante S3, el aislamiento por pathspec y que no reabra los guards S3/S1 ya confirmados; candidato sin commit sobre 420d8945.
- **2026-08-09T15:50:41Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T18:11:50Z** `[validation]` in-validation → in-progress (human rejected via conversation): Post-review con borde ejecutado: findCutover ganó --first-parent sin declararlo en CRs, Plan ni mandatos, y mata el undo cuando el commit de corte es alcanzable solo vía segundo padre (workflow ordinario de merge) con mensaje factualmente falso, dejando el repo activado sin ledger. Además un corte genuino con trailer perdido (--amend/squash) se reclasifica en silencio como señuelo, perdiendo el error accionable previo.
- **2026-08-09T18:39:11Z** `[branch]` set: integration/in-validation
- **2026-08-09T18:52:21Z** `[status]` in-progress → in-review
- **2026-08-09T18:52:21Z** `[note]` Mandato de confirmación (corrección del rechazo humano): diff sin commitear en src/commands/cutover.mjs y test/cutover.test.mjs — verificar D1 cerrado (corte alcanzable solo vía segundo padre se encuentra y el undo restaura) y D2 cerrado (trailer perdido falla nombrando el oid, nunca 'nothing is reachable'), CR1/CR2/CR8 sin regresión, y escrutar la DESVIACIÓN de diseño reportada: selección por baseline-concuerda-con-la-ref en vez de first-parent/más-reciente (el corrector probó que la regla prescrita rompía CR2). Residual advisory S3/S1 intacto por mandato.
- **2026-08-09T19:09:07Z** `[review]` in-review → in-progress (retry): Confirmación: D1 y D2 cerrados y la desviación de selección por baseline validada como sólida, pero (1) el gate del fallo por trailer ((tip!==null||activated)) no tiene test — el mutante que lo elimina sobrevive 29/29 y sin gate un decoy brickea repos nunca cortados; (2) quitar --first-parent de findCompletedUndo es no declarado, sin test (mutante sobrevive) y regresiona una forma ejecutada: un undo manual en rama lateral mergeado -s ours antes funcionaba (undo real exit 0) y ahora falla llamándolo 'interrupted'. Corrección: test del decoy en repo nunca cortado, y restaurar --first-parent en findCompletedUndo.
- **2026-08-09T19:15:01Z** `[status]` in-progress → in-review
- **2026-08-09T19:15:01Z** `[note]` Mandato de segunda confirmación: verificar únicamente los dos huecos del retry anterior — test del decoy en repo nunca cortado matando al mutante del gate, y --first-parent restaurado en findCompletedUndo (forma del undo descartado -s ours vuelve a funcionar) sin romper D1/D2 ni CR1/CR2/CR8; candidato sin commit sobre f6295f56.
- **2026-08-09T19:22:28Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T19:22:28Z** `[note]` Follow-ups acumulados de las dos confirmaciones (no bloqueantes): fail-closed cuando varios registros llevan el baseline de la ref (solo alcanzable forjando el trailer a mano; un cherry-pick real conflictúa); el --first-parent de findCompletedUndo queda guardado solo por su comentario (mutante sobrevive a la suite; el escenario -s ours lo cubre fuera de suite); el brazo activated-only del gate del decoy sin escenario dedicado; asimetría advisory del contenido ignorado S3/S1.
