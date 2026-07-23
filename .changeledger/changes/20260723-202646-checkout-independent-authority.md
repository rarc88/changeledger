---
id: "20260723-202646"
title: Autoridad de estado independiente del checkout
type: feature
status: draft
created: 2026-07-23T20:26:46Z
depends_on: ["20260722-202057"]
related_to: ["20260721-193101", "20260721-193103", "20260721-193104", "20260721-193106", "20260722-163406", "20260722-181234", "20260722-203030"]
release_impact: minor
---

## Request

La auditoría externa del 2026-07-23 sobre el baseline `3267a28b` encontró un crítico arquitectónico: la activación del estado global vive en `.changeledger/authority.yml`, un archivo del working tree. Cambiar a una rama creada antes del cutover (o borrar el archivo) hace desaparecer la autoridad y el ledger cae al modo legacy aunque el clon conserve `refs/changeledger/confirmed` — verdades distintas según la rama, lo contrario del objetivo del estado global. La contención inmediata (autoridad ausente + refs v2 → fail closed) se entrega en [20260722-202057]; este change decide y entrega la resolución de autoridad que no depende del checkout.

## Investigation

- `loadLedgerStore` selecciona el modo leyendo `authorityFor(changeledgerDir)` — un `parseYaml` del archivo del worktree. Toda la cadena (validación, réplica, viewer) hereda esa decisión por checkout.
- Los refs de réplica (`refs/changeledger/confirmed|pending|observed`) ya son por-repositorio (git common dir), igual que `refs/heads/changeledger/state`: la mitad del sistema ya es independiente del checkout; solo la activación no lo es.
- El cutover ([20260721-193103]) escribe `authority.yml` y lo committea en las ramas post-cutover; las ramas anteriores no lo tienen y los worktrees pueden mezclar ambas épocas.
- `state activate --prepare` solo crea la rama candidata: en ese momento aún no hubo merge ni decisión humana, así que la instalación de la activación debe ser un paso posterior y separado.
- `state export --recovery-branch` ([20260722-181234], [20260722-163406]) elimina `authority.yml` de la rama: el diseño debe cubrir también la desactivación, o el recovery dejaría un repo que sigue en modo state.
- `repoProvenance()` resuelve `project_id` directamente desde el `authority.yml` visible y captura cualquier error, independientemente de `loadLedgerStore`; cambiar solo la carga del ledger dejaría receipts, agent, search y viewer expuestos a una procedencia distinta de la autoridad operativa.
- La contención de [20260722-202057] cubre authority v1 o ausente cuando existe alguna ref de réplica v2; no define un clon post-cutover que tiene authority v2 pero todavía no recibió refs internas ni instaló la activación.
- El recovery no puede limitarse a borrar `refs/changeledger/activation`: si conserva `confirmed` u `observed`, [20260722-202057] rechazará el checkout recuperado sin authority. La desactivación debe retirar juntas la activación y las refs de réplica que demuestran el modo v2.
- Alcance a cubrir explícitamente: ramas pre-cutover, worktrees múltiples, clones nuevos (que NO reciben `refs/changeledger/*` al clonar), repos legacy, y la precedencia entre activación local y el `authority.yml` de la rama visible. La separación autoridad-local vs enforcement-remoto de [20260721-193104] y el alcance documentado en [20260722-203030] se mantienen.

## Proposal

Alternativas evaluadas:

1. **Ref interno de activación** — `refs/changeledger/activation` apunta al commit exacto que contiene la autoridad activa; las cargas leen `<commit>:.changeledger/authority.yml`. Ventajas: compartido por todos los worktrees vía common dir; el commit queda alcanzable; actualizaciones CAS y crash-safe con `update-ref`; una sola copia de la verdad (no hay segundo YAML que pueda divergir). Coste: instalación explícita en clones nuevos (igual que cualquier alternativa local).
2. **Metadata YAML en el git common dir**. Descartada frente a 1: duplica la autoridad en un segundo archivo mutable sin CAS ni alcanzabilidad.
3. **Resolución desde la rama de integración protegida**. Descartada como mecanismo primario: acopla lecturas locales a un ref remoto que puede faltar u obsolescer; queda solo como fuente del bootstrap explícito de clones nuevos.
4. **Solo contención** (fail closed permanente sin autoridad). Descartada: ramas pre-cutover serían callejones sin salida permanentes.

Elegida: **1**. `changeledger state activate` tiene tres modos mutuamente excluyentes:

- `--prepare --baseline <oid>` conserva su responsabilidad actual y no instala ni modifica refs de activación.
- `--install --integration-ref <full-ref>` instala desde un ref local totalmente calificado, sin fetch implícito. `<full-ref>` debe ser `refs/heads/<integration>` o `refs/remotes/<remote>/<integration>`, donde `<integration>` es `git.integration_branch`. El comando resuelve su tip exacto `T`, lee `<T>:.changeledger/authority.yml`, exige format v2 y valida baseline, manifest, `project_id`, `inventory_digest` y `minimum_client_version`. Una transacción verifica que `<full-ref>` siga en `T` y crea `refs/changeledger/activation` mediante CAS. Si ya apunta a `T`, devuelve éxito sin escritura; si apunta a otro OID, falla y preserva el valor anterior. El ref queda fijado en `T`: sync, lecturas y avances posteriores de integración nunca lo mueven.
- `--deactivate --integration-ref <full-ref>` ejecuta el camino inverso tras recovery. Verifica el tip exacto y estable del ref de integración, que ese commit ya no contiene `.changeledger/authority.yml`, que `pending` no existe y que `confirmed`/`observed` existen y son iguales. Una sola transacción CAS elimina `activation`, `confirmed` y `observed`; si las tres ya están ausentes, devuelve éxito sin escritura.

El `authority.yml` del worktree pasa a ser artefacto de transporte para cutover/bootstrap, nunca autoridad operativa. Un resolvedor único suministra la autoridad tanto a `loadLedgerStore` como a `repoProvenance` y sus consumidores; ninguna ruta puede volver a decidir el `project_id` desde el checkout cuando la activación existe.

Precedencia (con `refs/changeledger/activation` presente, la activación manda):

| Situación del worktree | Resultado |
|---|---|
| activación + authority ausente (rama pre-cutover) | modo state por activación |
| activación + authority v1 antigua | modo state por activación; el archivo visible se ignora sin modificar stdout/stderr |
| activación + authority v2 idéntica | modo state por activación |
| activación + authority v2 divergente | fail closed: `state authority conflict: refs/changeledger/activation (<oid>) differs from .changeledger/authority.yml` |
| authority v2 sin activación, existan o no refs v2 | modo bootstrap: los comandos ordinarios fallan con `state authority format_version: 2 is not installed; run \`changeledger state activate --install --integration-ref <full-ref>\``; `--install` opera directamente desde el ref explícito |
| authority ausente o v1 + refs v2 | fail closed ([20260722-202057]) |
| authority ausente + sin refs v2 | modo worktree; un clon pre-cutover puede optar por el bootstrap explícito desde un ref de integración exacto |
| authority v1 + sin refs v2 | comportamiento v1 existente |

Después de desactivar, todos los worktrees aplican de nuevo la matriz sin refs v2: el checkout recuperado o pre-cutover sin authority usa worktree; uno post-cutover con authority v2 queda en bootstrap y no puede reactivar state por sí solo; un v1 genuino conserva su comportamiento. Las refs y commits de la rama `changeledger/state` no se borran, por lo que la evidencia permanece recuperable.

## Specification

### CR1 — La verdad no cambia con la rama
- **Given** un repo con `refs/changeledger/activation` instalado y `refs/changeledger/confirmed` publicado
- **When** se cambia a una rama pre-cutover sin `authority.yml` y se ejecuta `changeledger context`
- **Then** el ledger carga en modo state con la misma revisión confirmada que en la rama post-cutover

### CR2 — Todos los worktrees comparten la activación
- **Given** el mismo repo con un worktree adicional en una rama pre-cutover
- **When** se carga el ledger desde ese worktree
- **Then** el modo es state y la revisión coincide con la del worktree principal

### CR3 — prepare no instala; install verifica y fija el ref
- **Given** un repo donde `state activate --prepare` creó la rama candidata y ningún merge ocurrió
- **When** se ejecuta `changeledger state activate --prepare --baseline <oid>` o se carga el ledger desde cualquier worktree
- **Then** el modo no cambia y ninguna ref de activación o réplica se escribe
- **And** después del merge, `changeledger state activate --install --integration-ref <full-ref>` resuelve el tip `T` del ref totalmente calificado que corresponde a `git.integration_branch`, verifica que siga en `T` durante la transacción y que su authority v2 coincida con baseline, manifest, `project_id`, `inventory_digest` y `minimum_client_version`, y crea `refs/changeledger/activation = T` mediante CAS
- **And** repetir la instalación con `activation = T` devuelve éxito sin escritura; con `activation = <old>` diferente falla exactamente con `state activation already points to <old>; refusing to replace it with <T>`
- **And** un ref incorrecto falla con `state activation install requires --integration-ref to name git.integration_branch <branch>`, un ref movido concurrentemente con `state activation source changed concurrently; retry`, y cualquier discrepancia de contenido con uno de `state activation source project_id does not match baseline manifest`, `state activation source inventory_digest does not match baseline manifest` o `state activation source minimum_client_version does not match baseline manifest`

### CR4 — Precedencia con authority divergente
- **Given** activación instalada y un worktree cuya `authority.yml` v2 difiere de la del commit de activación
- **When** se carga el ledger
- **Then** falla exactamente con `state authority conflict: refs/changeledger/activation (<oid>) differs from .changeledger/authority.yml`
- **And** con una v1 antigua o sin archivo carga en modo state por activación, sin modificar stdout/stderr por el archivo ignorado

### CR5 — Desactivación atómica para recovery
- **Given** un repo activado sin pending, con confirmed/observed consistentes y la integración recuperada sin `authority.yml`
- **When** se ejecuta `changeledger state activate --deactivate --integration-ref <full-ref>`
- **Then** una transacción CAS verifica que el ref de integración no cambió y elimina juntas `refs/changeledger/activation`, `refs/changeledger/confirmed` y `refs/changeledger/observed`, preservando la rama y los commits de state
- **And** si las tres refs ya están ausentes devuelve éxito sin escritura; si `pending` existe falla con `state activation deactivation requires no refs/changeledger/pending`, si confirmed/observed faltan o difieren falla con `state activation deactivation requires matching refs/changeledger/confirmed and refs/changeledger/observed`, y si la integración aún contiene authority falla con `state activation deactivation requires <full-ref> without .changeledger/authority.yml`
- **And** tras el éxito, un checkout sin authority carga en worktree y uno con authority v2 queda en modo bootstrap, nunca en state operativo

### CR6 — Clon nuevo: bootstrap explícito o legacy honesto
- **Given** un clon nuevo de una rama pre-cutover (sin `refs/changeledger/*` ni activación)
- **When** se carga el ledger
- **Then** carga en modo worktree, indistinguible de legacy
- **And** `changeledger state activate --install --integration-ref <full-ref>` puede instalar directamente desde el ref de integración exacto, sin depender del checkout ni hacer fetch implícito, aplicando CR3

### CR7 — Los repos legacy no cambian
- **Given** un repo sin refs v2, sin activación y sin authority
- **When** se carga el ledger
- **Then** modo worktree exactamente igual que hoy

### CR8 — Clon post-cutover exige bootstrap
- **Given** un clon nuevo de la rama post-cutover con `authority.yml` v2 pero sin `refs/changeledger/*` ni activación
- **When** un comando ordinario intenta leer o mutar el ledger
- **Then** falla exactamente con `state authority format_version: 2 is not installed; run \`changeledger state activate --install --integration-ref <full-ref>\``
- **And** la instalación explícita desde el ref de integración exacto aplica CR3 y habilita posteriormente state sync

### CR9 — Procedencia usa la misma autoridad
- **Given** una activación cuyo authority declara `project_id: alpha` y un checkout pre-cutover sin authority o con un config visible diferente
- **When** agent, search, viewer o cualquier comando construye la procedencia o un receipt
- **Then** reporta `project_id: alpha` desde la activación y el repository path real
- **And** nunca cae al config del checkout ni oculta un conflicto de CR4

## Plan

- [ ] Implementar un resolvedor único en `src/ledger-store.mjs` para leer `refs/changeledger/activation`, cargar `<commit>:.changeledger/authority.yml` y aplicar la matriz desde `loadLedgerStore` y `repoProvenance`; empezar con tests rojos de ramas/worktrees, conflictos, receipts y OIDs SHA-1/SHA-256; verify: `node --test test/ledger-store.test.mjs test/cli-bin.test.mjs` (CR1, CR2, CR4, CR7, CR9)
- [ ] Separar los modos `--prepare`/`--install`/`--deactivate` en `src/state-migration.mjs`, `src/commands/state.mjs` y `bin/changeledger.mjs`; implementar instalación desde el tip exacto, verificación de contenido y transacción CAS con idempotencia, partiendo de tests rojos; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs` (CR3)
- [ ] Implementar en `src/state-migration.mjs` y `src/commands/state.mjs` la desactivación transaccional de activation/confirmed/observed con guards sobre pending e integración, y probar recovery con worktrees pre/post-cutover mezclados antes del código; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs test/ledger-store.test.mjs` (CR5)
- [ ] Añadir fixtures conductuales de clones pre-cutover y post-cutover, bootstrap sin red y sync posterior, y documentar adopción/recovery en `templates/contract/` y README; verify: `node --test test/state-command.test.mjs test/ledger-store.test.mjs && node bin/changeledger.mjs check` (CR6, CR8)
- [ ] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)

## Log
