---
id: "20261002-133728"
title: Guardar los registros de consumo en el ledger
type: feature
status: in-progress
created: 2026-10-02T13:37:28Z
depends_on: ["20261001-155612"]
branch: feature/20261002-133728
related_to: ["20260808-142200", "20260808-151640", "20260809-113240", "20260809-113241", "20261002-132127"]
owner: rarc88
release_impact: minor
---

## Request

Los registros de consumo que deja el colector de `20261001-155612` viven sólo en
`.git/changeledger/usage/` de cada clon: no se versionan, no viajan entre
máquinas y se pierden al borrar el clon. El objetivo de medir es obtener
métricas generales de la herramienta, así que los registros deben guardarse en
el ledger y compartirse como el resto de su contenido, igual con la ref de
estado que en el layout legacy. La activación sigue siendo por clon en
`git config changeledger.usage.collector`: cada persona decide si mide, y lo
que mide se comparte.

La finalidad de guardarlos es analizarlos después: un módulo de análisis común
alimentará el comando `changeledger analyze`, pensado para que un agente
consulte cifras agregadas sin leer los registros en bruto, y un panel del
viewer para el humano. Por eso los registros deben poder cargarse junto al resto
del ledger, en ambos layouts, por la misma costura de lectura que usan la CLI y
el viewer.

El humano autoriza explícitamente (2026-10-02) ampliar el techo de
`global-state-scope` para que el árbol de la ref de estado incluya los
registros de consumo; la spec se actualiza en la graduación.

Quedan fuera de este change: el analizador y cualquier vista de los datos, la
migración de los registros ya guardados en `.git/changeledger/usage/` (hoy sólo
existen los del change de prueba descartado `20261002-132127`), la edición o
borrado de registros y cualquier dato de identidad distinto del que ya usa
`owner`.

## Investigation

`20261001-155612` escribe cada registro con `schema: 1` en
`<git-common-dir>/changeledger/usage/<id>/<instante>-<n>.json` después de que la
escritura de la transición tuvo éxito; una foto cuesta unos 1,5 s con precios
online. El destino está concentrado en el colector (`src/usage-collector.mjs`).

Ref de estado (change `20260808-151640`): el árbol es exclusivo.
`statePathIsValid` en `src/state-store.mjs` sólo acepta `manifest.yml`,
`config.yml` y rutas de tres partes `.changeledger-state/<colección>/<nombre>`
cuyas colecciones y extensiones declara `STATE_COLLECTION_EXTENSIONS`
(`changes` `.md`, `specs` `.md`, `releases` `.yml`); `inspectStateTree` y la
escritura rechazan cualquier otra ruta con `invalid state path: …`, y
`loadActiveContent` en `src/repo.mjs` sólo lee esas tres colecciones. Una
subcarpeta por change no cabe en la regla de tres partes. La escritura es un
commit compare-and-swap por mutación (`mutateState`).

`sync` reconcilia por ruta contra la base común: rutas distintas se fusionan
solas y la misma ruta cambiada en ambos lados es conflicto. `import` (change
`20260809-113241`) identifica cada documento por su contenido (change por id,
spec por nombre, release por versión), y `cutover` (change `20260809-113240`)
lee el ledger con `readLedgerAt` en `src/commands/ledger-tree.mjs`, que sólo
conserva las tres colecciones. La integridad de `global-state-scope` (incluye
#3) impide que una identidad presente en una foto desaparezca de su
descendiente; hoy cubre changes, specs y releases.

Layout legacy: las colecciones viven en el worktree (`changes_dir`, `specs_dir`
y `.changeledger/releases` fijo); los loaders ignoran cualquier otra carpeta, y
la guarda de `changeledger commit` en `src/commands/commit.mjs` sólo juzga lo
preparado bajo `changes_dir`. Un archivo nuevo bajo `.changeledger/` sólo viaja
si alguien lo prepara.

La identidad que ya se registra en los changes es la de `owner`, resuelta por
la CLI al crear (este repo resolvió `rarc88`).

Interfaces externas: ninguna nueva; `ccusage` sigue encapsulado en el colector
de `20261001-155612`.

## Proposal

Una colección nueva, `usage`, en ambos layouts, con un archivo plano por
registro para respetar la regla de tres partes y evitar colisiones entre
máquinas:

- Ref de estado: `.changeledger-state/usage/<id>--<YYYYMMDDTHHMMSSZ>-<sufijo>.json`.
- Legacy: `.changeledger/usage/<id>--<YYYYMMDDTHHMMSSZ>-<sufijo>.json`.

`<sufijo>` son 8 caracteres hexadecimales aleatorios, de modo que dos clones
nunca escriben la misma ruta y `sync` siempre fusiona sin conflicto. El
contenido es el registro `schema: 1` del colector más `recorded_by`, la
identidad que la CLI resuelve para `owner`.

Publicación, sin cambiar cuándo se toma la foto (después de la transición):

- Ref de estado: un commit CAS propio en la ref de estado, con mensaje
  `usage: <id> <event>`, que sólo añade el registro. Si la ref avanzó, se
  reintenta una vez contra la revisión nueva; si vuelve a fallar, se avisa con
  `usage: record not published: <motivo>` y la transición no cambia.
- Legacy: el registro se escribe en el worktree y `changeledger commit` prepara
  los registros pendientes del change cuyo id lleva el commit, para que viajen
  con él como su Log.

El colector deja de escribir en `.git/changeledger/usage/`.

La colección se integra en cada costura que hoy enumera colecciones:
`STATE_COLLECTION_EXTENSIONS`/`statePathIsValid`, `loadActiveContent`,
`readLedgerAt` (y con él `cutover` e `import`, que identifica un registro por su
nombre de archivo), la integridad de identidades (un registro nunca desaparece)
y `check`, que valida cada registro.

Alternativas descartadas: acumular en local y publicar en `sync` (otra
maquinaria y registros perdidos si el clon desaparece antes); incluir la foto en
el mismo commit de la transición (obliga a tomarla antes de escribir o a
retener el CAS durante la llamada a `ccusage`); una subcarpeta por change (no
cabe en la regla de tres partes); contadores secuenciales en el nombre (chocan
entre máquinas).

Riesgo de tamaño: el change toca el store, la adopción y `commit` en ambos
layouts. Si en la implementación no cabe en una pasada, se detiene y vuelve al
humano para dividirlo por layout.

## Specification

### CR1 — Con la ref de estado, cada foto es un commit propio que sólo añade su registro
- **Given** un repo activado con `changeledger.usage.collector=ccusage` en git config, el `ccusage` simulado de `20261001-155612` y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** la ref de estado avanza dos commits: el de la transición y, después, uno con mensaje `usage: <id> status` cuyo único cambio es añadir `.changeledger-state/usage/<id>--<instante>-<sufijo>.json`, con `<instante>` el de la línea `[status]` y `<sufijo>` de 8 caracteres hexadecimales
- **And** el registro contiene los campos `schema: 1` del colector más `recorded_by` igual al valor que la CLI resuelve para `owner`, y no se crea `.git/changeledger/usage/`

### CR2 — En legacy, el registro viaja con el commit de su change
- **Given** un repo inactivo con el colector activo y el `ccusage` simulado, y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress` y después `changeledger commit -m "feat(x): y" --id <id>`
- **Then** tras la transición existe `.changeledger/usage/<id>--<instante>-<sufijo>.json` en el worktree y el commit creado lo contiene
- **And** un `changeledger commit` con el id de otro change no lo incluye

### CR3 — Dos clones que miden el mismo change se sincronizan sin conflicto
- **Given** dos clones activados del mismo repo con el colector activo, que registran cada uno una foto del mismo change en el mismo segundo
- **When** ambos ejecutan `changeledger sync`
- **Then** la reconciliación es automática, sin conflicto, y la ref de estado resultante contiene los dos registros

### CR4 — `check` valida cada registro
- **Given** un ledger con un registro válido y, en casos separados, uno con JSON inválido, uno sin `schema: 1`, uno cuyo `change` no coincide con el id de su nombre y uno cuyo nombre no sigue `<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json`
- **When** se ejecuta `changeledger check` en ambos layouts
- **Then** el registro válido no produce diagnóstico y cada caso inválido termina con código distinto de cero con un error que empieza por `usage record <nombre>: `

### CR5 — Un registro nunca desaparece de la ref de estado
- **Given** una ref de estado con un registro de consumo
- **When** una mutación de la ref de estado produce una foto descendiente sin ese registro
- **Then** se rechaza antes de confirmar, igual que la desaparición de un change, y la ref no cambia

### CR6 — `cutover` e `import` llevan los registros
- **Given** un repo legacy con registros en `.changeledger/usage/` y una ref con otros registros en la misma carpeta
- **When** se ejecuta `changeledger cutover` y después `changeledger import --from <ref>` dos veces
- **Then** la ref de estado contiene todos los registros bajo `.changeledger-state/usage/` con su mismo nombre
- **And** el segundo `import` no cambia nada

### CR7 — Un fallo al publicar nunca bloquea la transición
- **Given** un repo activado con el colector activo, cuya ref de estado avanza por otro escritor justo antes de cada intento de publicar el registro
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** el comando termina con código cero, la transición queda en la ref y stderr muestra una línea que empieza por `usage: record not published: `

### CR8 — Sin colector no cambia nada
- **Given** un repo activado y uno inactivo sin valor en `git config changeledger.usage.collector`
- **When** se ejecuta una transición en cada uno
- **Then** la ref de estado avanza sólo el commit de la transición, no existe ninguna carpeta `usage` en el ledger y la salida es la de hoy

### CR9 — El primer uso real compartido entre dos clones
- **Given** este repo con `git config changeledger.usage.collector ccusage`, el `ccusage` 20.0.26 real y un change de prueba autorizado por el humano
- **When** se crea, se aprueba y se inicia desde Claude Code, se ejecuta `changeledger sync` y un segundo clon ejecuta `changeledger activate` y `changeledger sync`
- **Then** el segundo clon ve en `.changeledger-state/usage/` de su ref de estado los tres registros del change de prueba, sin error, con `recorded_by` del primer clon

### CR10 — Los registros se cargan con el resto del ledger
- **Given** un repo activado y uno inactivo, cada uno con dos registros de consumo de un change
- **When** se carga el ledger con `loadRepo` y con la carga asíncrona que usa el viewer
- **Then** ambas cargas exponen los dos registros, ya parseados y asociados al id de su change, en ambos layouts
- **And** un registro inválido no impide cargar el resto del ledger y lo reporta `check` según CR4

## Plan

- [x] Escribir pruebas fallidas de la colección `usage` en el store: rutas, lectura, integridad e identidad
  - **Target:** `test/state-store.test.mjs, test/repo.test.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/repo.test.mjs`
  - **Criteria:** CR1, CR5, CR10
  - **Resolved:** `2026-10-02T15:57:39Z`
- [x] Añadir `usage` a las colecciones del store, a la carga del ledger en ambos layouts y a la integridad de identidades
  - **Target:** `src/state-store.mjs, src/repo.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/repo.test.mjs`
  - **Criteria:** CR1, CR5, CR10
  - **Resolved:** `2026-10-02T15:57:40Z`
- [x] Probar y publicar el registro desde el colector en ambos layouts, con `recorded_by` y reintento único
  - **Target:** `src/usage-collector.mjs, test/usage-collector.test.mjs, test/agent.test.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR7, CR8
  - **Resolved:** `2026-10-02T15:57:40Z`
- [x] Probar y preparar en `changeledger commit` los registros pendientes del change
  - **Target:** `src/commands/commit.mjs, test/commit.test.mjs`
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-02T15:57:40Z`
- [ ] Probar y validar los registros en `check`
  - **Target:** `src/check.mjs, src/commands/check.mjs, test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR4
- [ ] Probar y llevar la colección en `cutover`, `import` y `sync`
  - **Target:** `src/commands/ledger-tree.mjs, src/commands/import.mjs, src/commands/cutover.mjs, test/cutover.test.mjs, test/import.test.mjs, test/sync.test.mjs`
  - **Verify:** `node --test test/cutover.test.mjs test/import.test.mjs test/sync.test.mjs`
  - **Criteria:** CR3, CR6
- [ ] Actualizar la documentación del colector
  - **Target:** `docs/usage-capture.md`
  - **Verify:** `pnpm test`
  - **Support:**
- [ ] Recorrer el primer uso real compartido entre dos clones
  - **Target:** `src/usage-collector.mjs`
  - **Verify:** verify: manual — change de prueba autorizado, sync y segundo clon activado que ve los tres registros
  - **Criteria:** CR9
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-02T15:24:42Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T15:32:33Z** `[status]` approved → in-progress
- **2026-10-02T15:32:33Z** `[branch]` set: feature/20261002-133728 (auto)
