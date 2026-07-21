---
id: "20260720-223228"
title: Validación server-side del estado vía pre-receive
type: feature
status: in-progress
created: 2026-07-20T22:32:28Z
depends_on: ["20260720-124231"]
owner: raruiz-hiberuscom
related_to: ["20260720-124231"]
---

## Request

`20260720-124231` (almacén global en `changeledger/state`) incluía originalmente
CR11: exponer el mismo motor de validación del CLI como hook `pre-receive`, para
que un servidor Git administrado pudiera rechazar en el remoto documentos
inválidos, historia reescrita o archivos fuera del layout permitido, sin
depender de que cada cliente se comporte.

Una revisión independiente encontró que esa pieza no funciona en un push real y
el humano decidió extraerla a un change propio en vez de seguir iterando dentro
de un change ya `major` y sobrecargado. Este change recoge exclusivamente ese
trabajo pendiente: una validación server-side que sí sea correcta bajo las
condiciones reales de un `pre-receive`, probada contra un hook real.

## Investigation

`src/git.mjs` centraliza el acceso a objetos Git detrás de un entorno saneado
(`sanitizedEnv`) que elimina `GIT_OBJECT_DIRECTORY` y
`GIT_ALTERNATE_OBJECT_DIRECTORIES` de cada `objectRun`. Eso es correcto para el
CLI cliente: evita que el propio pre-commit hook del repositorio interfiera con
las lecturas de ChangeLedger. Pero es exactamente lo que un `pre-receive`
real necesita para ver los objetos entrantes: Git pone en cuarentena el push
en un directorio de objetos temporal y expone esas dos variables al hook
mientras decide si aceptarlo. La acción `validate-receive` (ahora eliminada de
`20260720-124231`) llamaba al mismo `objectRun` saneado, así que durante un
push real no encontraba los objetos que estaba validando y rechazaba cualquier
actualización de estado.

La prueba de regresión que se añadió para responder al rechazo humano
("bare receive hook") no lo detectó porque publicaba los objetos en el
repositorio bare *antes* de invocar la validación, en vez de simular la
cuarentena de un push en curso. Verificado empíricamente contra un hook
`pre-receive` real: con el entorno heredado, `GIT_OBJECT_DIRECTORY` y
`GIT_ALTERNATE_OBJECT_DIRECTORIES` son visibles y apuntan a la cuarentena; con
el entorno saneado que usa ChangeLedger, no lo son.

## Proposal

(Punto de partida para refinar antes de aprobar — no cerrado.)

La ruta de validación server-side necesita su propio entorno Git: heredar
`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES` cuando existan (para
ver la cuarentena de un `pre-receive` real) sin relajar el saneamiento que usan
el resto de comandos del CLI cliente. El motor de validación compartido
(`validateStateRange` y lo que dependía de él) puede reconstruirse sobre esa
base; no hace falta rediseñar la lógica de validación en sí, solo cómo se
invoca el acceso a objetos en este contexto.

La cobertura de test debe incluir al menos un caso que instale un hook
`pre-receive` real invocando el CLI compilado y ejecute un `git push` genuino
contra un remoto bare, en vez de pre-cargar los objetos y llamar a la función
de validación directamente. Sin esa prueba, un cambio futuro puede volver a
romper esta ruta sin que ningún test lo note.

La auditoría posterior a la aceptación encontró que el probe negativo no
identifica al validador que produjo el rechazo. El cliente acepta el diagnóstico
genérico `pre-receive hook declined`, por lo que un hook ajeno que rechaza todo
se presenta como protección ChangeLedger. Además, el probe reservado se valida
independientemente de `--branch`: un hook instalado para `changeledger/state`
puede certificar falsamente un repositorio cuya autoridad real sea otra rama.

La corrección debe tratar la confirmación como una atestación ligada al
validador, a un desafío no reutilizable y al nombre exacto de la rama candidata.
La investigación de implementación debe escoger el mecanismo Git mínimo que
permita hacerlo sin interpretar mensajes genéricos ni alterar la rama de estado.
Hasta que esa prueba exista, `--confirm-strong` debe fallar cerrado y nunca
degradarse silenciosamente a una afirmación de protección.

## Specification

### CR1 — Validación visible durante la cuarentena de un push real
- **Given** un repositorio bare con el hook `pre-receive` de ChangeLedger instalado
- **When** un cliente hace `git push` con una actualización válida de `changeledger/state`
- **Then** el hook ve los objetos entrantes (cuarentena) y los valida con el mismo motor que usa el CLI
- **And** una actualización inválida se rechaza sin aceptar el push

### CR2 — Sin regresión en el saneamiento del cliente
- **Given** el CLI ejecutándose como cliente (no como hook de recepción)
- **When** ChangeLedger lee o escribe objetos Git
- **Then** el entorno sigue saneado exactamente como antes de este change
- **And** ningún comando cliente hereda variables de cuarentena que no le corresponden

### CR3 — Test de integración contra un hook real
- **Given** un remoto bare temporal con el hook `pre-receive` instalado desde el CLI real
- **When** la suite de regresión ejecuta un `git push` genuino con una actualización inválida y otra válida
- **Then** el rechazo y la aceptación se verifican contra el resultado real del push, no contra una llamada directa a la función de validación con objetos precargados

### CR4 — Reconexión del modo fuerte en `20260720-124231`
- **Given** el hook `pre-receive` de este change instalado y confirmado (`state doctor --confirm-strong` lo detecta funcionando)
- **When** el humano ejecuta `state activate --confirm-strong`
- **Then** la activación puede completarse sin exigir `--advisory`, reconociendo la protección fuerte disponible
- **And** si el hook no está confirmado, `state activate` sigue exigiendo `--advisory` como hoy — el comportamiento actual de `20260720-124231` no cambia por defecto
- **And** sin `--confirm-strong`, ni `state doctor` ni `state activate` empujan el probe al remoto: `doctor` reporta `not-checked` y `activate` exige `--advisory` o `--confirm-strong` explícitamente — la confirmación nunca es un efecto colateral implícito de un diagnóstico o de una activación

### CR5 — Atestación inequívoca del validador y de la rama
- **Given** un hook ajeno que rechaza todos los pushes o cualquier rechazo remoto genérico
- **When** se ejecuta `state doctor --confirm-strong` o `state activate --confirm-strong`
- **Then** ChangeLedger reporta protección no verificada y no acepta el rechazo como evidencia propia
- **Given** un validador ChangeLedger configurado para una rama diferente de `git.state_branch` o de `--branch`
- **When** se solicita confirmación fuerte
- **Then** la confirmación falla indicando la discrepancia exacta
- **And** solo una respuesta ligada al desafío actual, al protocolo soportado y a la rama exacta puede producir `remote_protection: enforced`

### CR6 — Confirmación sin incumplir el contrato append-only
- **Given** un remoto protegido, no protegido o parcialmente disponible
- **When** se ejecuta una confirmación fuerte
- **Then** el mecanismo no usa force-push ni modifica, elimina o rebasa la rama de estado
- **And** cualquier referencia auxiliar y su política de limpieza se definen antes de la implementación, sin prometer limpieza garantizada mediante una operación best-effort
- **And** una confirmación interrumpida conserva un diagnóstico recuperable y nunca se presenta como protección verificada

## Plan

- [x] Add a failing test that installs a real `pre-receive` hook (invoking the built CLI) in a bare remote and pushes a state update through it while the object quarantine is active, confirming it fails closed on a valid update today; then give the receive path its own git env inheriting `GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES` from the hook process instead of stripping them, in `src/git.mjs` and `src/commands/state.mjs`; verify: `node --test test/state-receive.test.mjs` (CR1)
  - **Resolved:** `2026-07-21T13:58:13Z`
- [x] Add a test asserting every client-facing command in `src/git.mjs`'s consumers (`list`, `show`, `status`, `state doctor`) still runs with the fully sanitized env after the receive path gets its own; verify: `node --test test/git.test.mjs` (CR2)
  - **Resolved:** `2026-07-21T13:58:13Z`
- [x] Reintroduce the `state validate-receive` CLI command in `bin/changeledger.mjs`, wired to the fixed validation path, plus the README `pre-receive` hook install instructions removed with CR11; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` (CR1)
  - **Resolved:** `2026-07-21T13:58:14Z`
- [x] Add the real-push integration test described in the Proposal (install the hook from `bin/changeledger.mjs`, `git push` against a bare remote, assert on the push's real accept/reject outcome) as permanent regression coverage; verify: `node --test test/state-receive.test.mjs` (CR3)
  - **Resolved:** `2026-07-21T13:58:15Z`
- [x] Add a test where `state doctor` confirms a working installed hook, then update `activateState` in `src/commands/state.mjs` to accept activation without `--advisory` in that case only, keeping today's `--advisory`-required path unchanged otherwise; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs` (CR4)
  - **Resolved:** `2026-07-21T13:58:16Z`
- [x] Run the full gate and update `templates/contract/`/README wording that still describes pre-receive validation as unavailable; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-21T13:58:16Z`
- [x] Gate `confirmRemoteProtection` behind an explicit `--confirm-strong` flag on `state doctor`/`state activate` in `src/commands/state.mjs` and `bin/changeledger.mjs` so the probe push never runs implicitly; guarantee the throwaway `refs/changeledger/protection-probe` ref is deleted whenever the probe is accepted, with test coverage proving no ref lingers on origin either way; verify: `node --test test/state-command.test.mjs` (CR4)
  - **Resolved:** `2026-07-21T15:39:04Z`
- [x] Add failing regressions in `test/state-command.test.mjs` and `test/state-receive.test.mjs` for an unrelated reject-all hook and for a ChangeLedger hook configured for a different custom state branch, then replace the generic-error inference in `src/commands/state.mjs` with an exact branch-bound attestation; verify: `node --test test/state-command.test.mjs test/state-receive.test.mjs` (CR5)
  - **Resolved:** `2026-07-21T16:31:50Z`
- [x] Remove force-push from the confirmation path in `src/commands/state.mjs`, specify and test interruption/cleanup semantics for any auxiliary ref, and align `README.md` with the implemented append-only behavior; verify: `node --test test/state-command.test.mjs && changeledger check` (CR6)
  - **Resolved:** `2026-07-21T16:31:51Z`

## Log

- **2026-07-20T22:32:28Z** `[note]` Extraído de `20260720-124231` tras revisión independiente: el hook pre-receive original no ve los objetos en cuarentena de un push real porque reutiliza el entorno Git saneado del cliente. Draft pendiente de refinar y aprobar por el humano.
- **2026-07-21T12:49:07Z** `[status]` draft → approved
- **2026-07-21T13:31:45Z** `[status]` approved → in-progress
- **2026-07-21T13:31:45Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-21T13:31:45Z** `[note]` Rama creada desde codex/global-state-branch, no desde dev: dev todavía no tiene el código de 20260720-124231 (done, sin graduar/mergear).
- **2026-07-21T13:58:37Z** `[note]` Implemented CR1-CR4. Env design: new receiveGitEnv() in src/git.mjs re-adds only GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES on top of the sanitized base; validateReceive defaults its gitEnv to receiveGitEnv() so the pre-receive path sees the push quarantine while every client command stays fully sanitized. Rebuilt a lean validateReceive over the shared validateStateRange engine (no cutover/legacy-rollback machinery: that was 124231 CR16, now advisory-only). CR4 mechanism: doctorState/activateState confirm strong protection via a negative probe pushing an invalid commit to a reserved refs/changeledger/protection-probe ref; only a clear pre-receive rejection counts as enforced, so the default --advisory path is never silently weakened. Gate: 794 tests, biome clean, check 207 valid.
- **2026-07-21T13:58:51Z** `[status]` in-progress → in-review
- **2026-07-21T14:04:55Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-21T15:33:51Z** `[validation]` in-validation → in-progress (agent rejected): CR4 correction requested by human before acceptance: gate confirmRemoteProtection probe behind an explicit flag (never run implicitly inside activate/doctor), and guarantee cleanup of refs/changeledger/protection-probe with test coverage.
- **2026-07-21T15:38:57Z** `[note]` CR4 correction applied: confirmRemoteProtection now gated behind --confirm-strong on both state doctor and state activate (never implicit); doctor defaults to remote_protection: not-checked. Hardened confirmRemoteProtection so the throwaway probe-ref is only left when the remote actually accepted it (unprotected), and is always cleaned up in that case. Added test coverage: no push happens without --confirm-strong, and no ref lingers on origin whether the probe is rejected or accepted. Updated CR4 spec, README, and CLI help text. Gate: 796 tests, biome clean, check 207 valid.
- **2026-07-21T15:39:15Z** `[status]` in-progress → in-review
- **2026-07-21T15:44:06Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-21T15:50:22Z** `[validation]` in-validation → done (human accepted)
- **2026-07-21T16:17:54Z** `[status]` done → in-progress (agent reopened): La auditoría posterior demostró que --confirm-strong puede certificar un hook ajeno o un hook configurado para otra rama de estado
