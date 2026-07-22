---
id: "20260721-193104"
title: Desacoplar el enforcement remoto del almacén global
type: feature
status: in-progress
created: 2026-07-21T19:31:04Z
depends_on: ["20260721-193101", "20260721-193102", "20260721-193103"]
owner: Roberto Ruiz
related_to: ["20260721-193106"]
release_impact: minor
---

## Request

El core puede publicar fast-forward con compare-and-swap, pero no controla quién
puede actualizar el remoto ni puede convertir una identidad local de Git en una
frontera de seguridad. La protección disponible cambia entre GitHub.com,
GitLab/GitHub self-managed y otros servidores. ChangeLedger debe separar la
validez del snapshot, la protección de historia y la autenticación de actor, y
solo afirmar las garantías que el proveedor realmente demuestre.

## Investigation

El prototipo en `codex/global-state-branch@6ac08826` combina hook genérico,
probes remotos, owner local y una etiqueta `remote_protection: enforced`. La
auditoría encontró que una atestación podía afirmar owner enforcement solo por
recibir `--actor`, incluso cuando `--human-override` omitía la comprobación. Un
actor pasado por CLI o variable de entorno tampoco es necesariamente la
identidad autenticada por el servidor.

El modelo vigente no convierte `owner` en una ACL: identifica responsabilidad y
se autoasigna desde una identidad local tolerante. Los commits de estado tampoco
guardan una identidad de proveedor. Exigir que el pusher coincida con `owner` o
con un trailer inventaría una política de autorización nueva y, además, pediría
al cliente conocer de antemano la identidad que autenticará el servidor. Este
change no añade esa semántica: autenticar actor y autorizar una operación quedan
como capacidades distintas; el adaptador genérico inicial solo valida contenido
e historia.

Los servidores self-managed pueden ejecutar validación `pre-receive`, pero su
instalación y forma de exponer identidad son específicas del proveedor. Los
servicios hosted suelen ofrecer reglas de rama/path, no hooks arbitrarios. Por
eso un único probe “strong” oculta diferencias relevantes y empuja complejidad
de infraestructura dentro del core.

Se conserva del prototipo el motor puro de validación de rangos, el acceso a
objetos en cuarentena, la compatibilidad SHA-256 y los tests de push real. Se
descartan la atestación basada en texto stderr como certificado general, el
actor configurado estáticamente y cualquier override humano no autenticado.

El estado v2 cambia también la frontera técnica. El snapshot contiene config,
changes, specs y releases bajo `.changeledger-state`; su manifest y authority
fijan proyecto, baseline, digest y versión mínima. Un bare remoto no tiene
worktree desde el cual descubrir `dev`: el adaptador debe instalarse con
`state_ref` e `integration_ref` explícitos, y contrastarlos con config/authority.
La protección de integración empieza después del cutover. Mientras no exista
authority activa falla como `not-active`, en vez de adivinar una migración; una
recuperación que elimina authority requiere una acción administrativa externa y
visible, no un bypass del payload recibido.

## Proposal

El core expondrá `validateStateUpdate()` y `validateReceiveBatch()` en
`src/state-validation.mjs`. La CLI `state validate-update` recibe old SHA, new
SHA, ref, state ref e integration ref explícitos; `state validate-receive` lee
el batch NUL/line-safe de `pre-receive`. Ninguno ofrece `--actor`, override o
probe. Las funciones usan únicamente objetos Git y valores entregados, no red,
worktree, Git config de usuario ni descubrimiento de identidades.

Para `changeledger/state`, una creación solo es válida si publica exactamente el
baseline de la authority activa; una actualización debe ser fast-forward desde
el old SHA anunciado. Cada commit nuevo —no solo el head final— debe ser un
snapshot cerrado y válido del mismo proyecto, descender del baseline y mantener
manifest/config/authority compatibles. Delete, objetos ausentes, OIDs ambiguos,
refs inesperadas o un old SHA que no coincide fallan cerrados.

Para integración, el old SHA debe contener la authority v2 activa. Cada commit
nuevo conserva esa authority byte por byte y no puede añadir, modificar o borrar
ningún path legacy de config, changes, specs o releases derivado del config del
snapshot confirmado. Código ajeno a esos roots sigue permitido. Authority
ausente, cambiada o eliminada falla; por ello el hook de integración se instala
después de fusionar el cutover y una recovery branch exige que un administrador
retire temporalmente esa protección según el runbook de `20260721-193106`.

`state doctor` reportará capacidades ortogonales mediante un modelo puro de
evidencia de adaptador:

| Capacidad | Valores |
|---|---|
| `history_protection` | `unknown`, `advisory`, `enforced` |
| `content_validation` | `unavailable`, `configured`, `verified` |
| `actor_authentication` | `unavailable`, `provider-asserted`, `verified` |
| `legacy_path_protection` | `unavailable`, `configured`, `verified` |

Nunca colapsará esas filas en “strong”. `verified` solo puede originarse en un
adaptador ejecutado dentro de la frontera confiable del servidor y debe incluir
provider, ref exacta, OID observado y mecanismo. Opciones CLI, archivos JSON del
usuario, stderr, rechazo genérico o texto libre solo permiten `configured` o
`unknown`. Sin adaptador, doctor conserva `unknown`/`unavailable` y declara que
usuarios con acceso Git pueden saltarse el CLI.

Los adaptadores viven fuera del protocolo de réplica. La primera entrega incluye
un wrapper `pre-receive` self-managed parametrizado por refs. Produce evidencia
verificada de content/legacy validation porque él mismo ejecuta el validador en
cuarentena; actor authentication permanece `unavailable`, ya que un hook Git
genérico no recibe una identidad portable. La interfaz reserva evidencia de
actor estructurada para adaptadores futuros, pero este change no la usa para
autorizar por `owner` ni modifica los mensajes de commits de estado.

El batch rechaza actualizaciones duplicadas de una ref protegida y valida state e
integración contra el mismo snapshot de refs recibido al inicio. Evalúa cada
commit nuevo con límites explícitos: número de commits, suma de tamaños de
objetos únicos enumerados por `rev-list --objects` y deadline monotónico. Cada
subproceso Git recibe el tiempo restante; exceder commits, bytes o tiempo falla
con el nombre, límite y valor observado, sin actualizar refs.

Los proveedores hosted sin hooks pueden alcanzar `history_protection=enforced`
mediante un adaptador futuro que consulte una API autenticada; declarar una
regla en config no basta. Permanecen con `content_validation=unavailable` a
menos que usen un flujo mediado verificable. La interfaz de capacidades permite
añadirlos sin cambiar `LedgerStore`, `state sync` ni el formato del snapshot.

## Specification

### CR1 — Input y batch fallan cerrados
- **Given** líneas `old new ref` con OIDs SHA-1 o SHA-256 y state/integration refs explícitas
- **When** `validateReceiveBatch` recibe una línea truncada, OID cero inválido para la operación, objeto ausente, ref duplicada o ref protegida distinta
- **Then** rechaza todo el batch nombrando línea/ref y no escribe refs, worktree u objetos de publicación
- **And** refs no protegidas se ignoran sin convertirlas en evidencia de protección

### CR2 — State ref valida cada snapshot nuevo
- **Given** authority activa con baseline `S0`, old `S1` y new `S3` que introduce `S2`
- **When** se valida `refs/heads/changeledger/state`
- **Then** exige `S1` como old exacto, fast-forward y ancestry desde `S0`
- **And** valida `S2` y `S3` completos contra project_id, manifest, config, inventory_digest, minimum_client_version y layout cerrado
- **And** delete, un intermedio inválido o creación distinta de `S0` falla aunque el head final sea válido

### CR3 — Integración conserva authority y bloquea legacy
- **Given** integración activa `I1` con authority v2 y roots legacy derivados del config confirmado
- **When** `I1 → I2` conserva authority byte por byte y solo cambia `src/app.mjs`
- **Then** acepta el avance fast-forward
- **When** cualquier commit añade, modifica o borra authority, config, changes, specs o releases legacy
- **Then** rechaza el batch nombrando commit y path
- **And** una integración sin authority activa falla `integration protection is not active`

### CR4 — Actor y override no se simulan
- **Given** el adaptador self-managed genérico
- **When** el cliente añade trailers, Git config, `--actor`, `--human-override` o variables de usuario
- **Then** la CLI rechaza las opciones y actor_authentication permanece `unavailable`
- **And** `owner` sigue siendo responsabilidad, no una ACL implícita

### CR5 — Capacidades independientes y con procedencia
- **Given** evidencia de un adaptador hosted que verificó una regla de fast-forward pero no ejecuta validación de contenido
- **When** el agregador de doctor la recibe desde la interfaz confiable
- **Then** informa `history_protection=enforced` y `content_validation=unavailable`
- **And** cada capacidad incluye provider, ref/OID, mecanismo y evidencia o motivo
- **And** input del usuario, config estática o stderr nunca produce `verified` ni una garantía agregada `strong`

### CR6 — Integración self-managed real y cuarentena
- **Given** un remoto bare con el wrapper `pre-receive` instalado después del cutover
- **When** se hacen pushes reales válidos e inválidos a state e integración en SHA-1 y SHA-256
- **Then** el hook lee objetos entrantes mediante quarantine y acepta/rechaza como el validador puro
- **And** un proceso cliente saneado elimina variables Git de quarantine, mientras el adaptador server-side las conserva

### CR7 — Presupuesto operacional exacto
- **Given** límites `max_commits=2`, `max_object_bytes=4096` y `timeout_ms=100`
- **When** un batch observa 3 commits, 4097 bytes únicos o supera el deadline inyectado
- **Then** falla antes de seguir recorriendo con `commit limit 2 exceeded`, `object byte limit 4096 exceeded` o `validation timeout 100ms exceeded`
- **And** cada subproceso Git usa como timeout el presupuesto restante

### CR8 — Recovery y bootstrap son administrativos
- **Given** protección de integración activa
- **When** una push normal intenta eliminar authority para materializar recovery
- **Then** el hook la rechaza sin aceptar flags del payload
- **And** README explica instalar protección tras activation y retirar/restaurar la regla mediante administración del proveedor para recovery

### CR9 — CLI y receipts no prometen más de lo probado
- **Given** `state validate-update`, `state validate-receive` o doctor exitoso/fallido
- **When** termina el comando con salida humana o `--json`
- **Then** identifica refs, old/new OIDs, commits/bytes observados, capacidades, provider y resultado sin red ni escritura
- **And** help no ofrece actor, override, probe o detección automática del provider

## Plan

- [x] Añadir fixtures SHA-1/SHA-256 y parser de batch/input estricto en `test/state-validation.test.mjs` y `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs` (CR1)
  - **Resolved:** `2026-07-22T15:14:35Z`
- [x] Extraer validación server-safe de snapshots v2 desde `src/ledger-store.mjs` y validar cada commit de state en `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs test/ledger-store.test.mjs` (CR2)
  - **Resolved:** `2026-07-22T15:14:35Z`
- [x] Implementar protección post-cutover de authority y roots legacy de integración en `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs` (CR3, CR8)
  - **Resolved:** `2026-07-22T15:14:35Z`
- [x] Implementar contadores de commits/objetos únicos y deadline por subproceso en `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs` (CR7)
  - **Resolved:** `2026-07-22T15:14:35Z`
- [x] Añadir modelo puro de capacidades con procedencia y composición de doctor en `src/state-capabilities.mjs` y `src/commands/state.mjs`; verify: `node --test test/state-capabilities.test.mjs test/state-command.test.mjs` (CR4, CR5)
  - **Resolved:** `2026-07-22T15:14:35Z`
- [x] Crear `src/state-receive.mjs` y wrapper self-managed `hooks/pre-receive` sin actor/override/probe; verify: `node --test test/state-receive.test.mjs test/git.test.mjs` (CR1, CR4, CR6)
  - **Resolved:** `2026-07-22T15:14:36Z`
- [x] Cablear `state validate-update`/`validate-receive`, help y receipts en `bin/changeledger.mjs`; verify: `node --test test/state-receive.test.mjs test/cli-bin.test.mjs` (CR4, CR9)
  - **Resolved:** `2026-07-22T15:14:36Z`
- [x] Documentar instalación post-activation, recovery administrativa y matriz provider/advisory en `README.md` y `templates/contract/core.md`; verify: `node --test test/context.test.mjs && changeledger check` (CR5, CR8, CR9)
  - **Resolved:** `2026-07-22T15:14:36Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T15:18:59Z`

## Log

- **2026-07-21T19:31:04Z** `[note]` Draft v2 separa garantías de historia, contenido, actor y paths legacy; ninguna se infiere de un rechazo remoto genérico.
- **2026-07-22T14:52:14Z** `[note]` Readiness elimina owner-as-ACL y evidencia simulable, fija semántica por ref/commit, instalación post-cutover, recovery administrativa, budgets exactos y procedencia de capacidades.
- **2026-07-22T14:52:42Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T14:52:42Z** `[status]` approved → in-progress
- **2026-07-22T14:52:42Z** `[owner]` set: Roberto Ruiz (auto)
