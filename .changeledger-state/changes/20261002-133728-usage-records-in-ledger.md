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
- [x] Probar y validar los registros en `check`
  - **Target:** `src/check.mjs, src/commands/check.mjs, test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-02T15:57:41Z`
- [x] Probar y llevar la colección en `cutover`, `import` y `sync`
  - **Target:** `src/commands/ledger-tree.mjs, src/commands/import.mjs, src/commands/cutover.mjs, test/cutover.test.mjs, test/import.test.mjs, test/sync.test.mjs`
  - **Verify:** `node --test test/cutover.test.mjs test/import.test.mjs test/sync.test.mjs`
  - **Criteria:** CR3, CR6
  - **Resolved:** `2026-10-02T15:57:41Z`
- [x] Actualizar la documentación del colector
  - **Target:** `docs/usage-capture.md`
  - **Verify:** `pnpm test`
  - **Support:**
  - **Resolved:** `2026-10-02T15:57:42Z`
- [x] Recorrer el primer uso real compartido entre dos clones
  - **Target:** `src/usage-collector.mjs`
  - **Verify:** verify: manual — change de prueba autorizado, sync y segundo clon activado que ve los tres registros
  - **Criteria:** CR9
  - **Resolved:** `2026-10-02T16:00:33Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-02T15:57:42Z`

## Log
- **2026-10-02T15:24:42Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T15:32:33Z** `[status]` approved → in-progress
- **2026-10-02T15:32:33Z** `[branch]` set: feature/20261002-133728 (auto)
- **2026-10-02T15:57:42Z** `[note]` Implementación delegada (subagente, top tier), tareas 1-7 y 9. Decisiones no especificadas: recorded_by va tras to y una identidad vacía se guarda como null; nuevas costuras usage.stateRun y usage.ownerHandle; sólo un conflicto CAS se reintenta, cualquier otro fallo avisa usage: record not published una vez por registro; un stage.remove explícito de un registro se rechaza con su propio mensaje; en legacy un nombre ocupado recibe otro sufijo; check valida los registros sólo repo-wide y reporta el primer defecto de cada uno; el loader legacy lee sólo *.json; commit prepara los registros tras su guarda, nunca con --no-change ni en un repo activado; import identifica un registro por su nombre y el mismo nombre con otros bytes es conflicto; la limpieza y el undo de cutover incluyen .changeledger/usage; el test CR9 de 20261001-155612, que afirmaba que los registros quedan fuera del ledger, se sustituyó. Residuos: el merge y el fast-forward de sync no comprueban que un documento sobreviva (anterior a este change); sin guarda contra reescribir un registro existente (colisión de sufijo en el mismo segundo, 1 entre 2^32); un registro inválido bloquea las escrituras que pasan por checkRepo; una ruta usage que no sea .json falla toda la lectura; recorded_by cuesta una llamada gh api user por foto; CR7 probado en proceso; el viewer no expone usage (fuera de alcance). Gate: pnpm verify en verde con 1690/1690 tests.
- **2026-10-02T16:00:33Z** `[version]` 0.18.0-dev
- **2026-10-02T16:00:33Z** `[note]` CR9 recorrido por el orquestador con autorización del humano: con git config changeledger.usage.collector ccusage y la CLI de esta rama, el change de prueba 20261002-155917 se creó, aprobó e inició; la ref de estado ganó tres commits usage: <id> <event> tras sus transiciones, cada uno con un registro en .changeledger-state/usage/; tras changeledger sync, un segundo clon de GitHub activado vio en su ref los tres registros (created, draft → approved, approved → in-progress), sin error, con recorded_by rarc88 y pricing online, y su check terminó sin errores. El change de prueba se descartó, su rama se borró, el valor de git config se retiró y el clon temporal se eliminó. Hallazgo: en cuanto la ref de estado contiene un registro, la CLI instalada 0.17.0, que no conoce la colección usage, falla en cualquier comando con invalid state path; el guard de min_cli_version no la detiene porque la lectura del snapshot falla antes. La ref publicada en origin ya contiene registros.
- **2026-10-02T16:17:20Z** `[status]` in-progress → in-review
- **2026-10-02T16:17:23Z** `[note]` Mandato del review: la superficie que el change gobierna — el rango dev..HEAD (93d00ba) contra CR1-CR10 y el Plan, con las decisiones no especificadas y los residuos del Log como puntos de escrutinio; el hallazgo de compatibilidad con CLIs anteriores queda fuera del mandato, documentado como 20261002-161641.
- **2026-10-02T16:28:07Z** `[review]` in-review → in-progress (retry): D1: en legacy, con .changeledger/usage/ en .gitignore, changeledger commit --id falla por el git add de los registros y bloquea todos los commits del change; la medición no debe bloquear commit. D2: con la ref de estado una colisión de sufijo sobrescribe un registro sin aviso, y lo desmienten tres textos universales (import dice que el contenido nunca se reescribe, el test CR3 de no sobrescritura sólo corre en legacy, y mutateState dice que los registros nunca se eliminan cuando el fast-forward de sync sí puede). D3: un registro sin change se reporta como change "undefined".
- **2026-10-02T16:34:06Z** `[note]` Corrección del retry (subagente corrector): D1, commit deja fuera los registros sin seguimiento que git ignora y lo avisa con usage: records ignored by git were not staged, convierte cualquier otro fallo de preparación en el aviso usage: records not staged y nunca bloquea el commit, y prepara con git add -f los registros ya versionados bajo una regla de ignorado; D2, mutateState rechaza cambiar los bytes de un registro existente y el colector vuelve a sortear el sufijo también con la ref de estado (costura usage.randomSuffix), con la prueba de colisión en ambos layouts y los textos acotados a lo que garantizan; D3, check reporta missing "change" y missing "schema". Residuos: integridad en el fast-forward y merge de sync, sin timeout ni caché para la llamada a gh de recorded_by, registros de schema desconocido bloquean apply, un git cat-file extra por publicación. Gate del orquestador: pnpm verify en verde con 1698/1698 tests. Mandato de la confirmación: sólo el diff sin commitear frente a HEAD (93d00ba) y los defectos D1-D3 del review fail anterior, más cualquier regresión que introduzca.
- **2026-10-02T16:34:07Z** `[status]` in-progress → in-review
- **2026-10-02T16:38:55Z** `[review]` in-review → in-progress (retry): Confirmación: D1-D3 cerrados sin regresiones, pero las dos ediciones de redacción que el orquestador añadió al candidato dejaron una frase falsa: el apartado legacy de docs/usage-capture.md seguía diciendo Measurement never blocks the commit, desmentido por un .changeledger/usage ilegible (EACCES al cargar el ledger, commit --id sale con 1).
- **2026-10-02T16:38:55Z** `[note]` Corrección del orquestador: la frase del apartado legacy de docs/usage-capture.md queda acotada a la preparación de registros, como el comentario de commit.mjs, y se reajusta una línea que superaba el ancho del párrafo.
- **2026-10-02T16:41:28Z** `[note]` Tercera ronda autorizada por el humano, limitada a la redacción de docs/usage-capture.md y del comentario de src/commands/commit.mjs. Mandato: sólo esos dos archivos del diff sin commitear frente a HEAD (93d00ba); el resto del diff ya quedó confirmado.
- **2026-10-02T16:41:28Z** `[status]` in-progress → in-review
- **2026-10-02T16:42:11Z** `[review]` in-review → in-progress (retry): Tercera ronda: la frase sobre el sufijo afirma que si falla la comprobación de si un nombre existe el registro no se publica, pero stateHolds trata cualquier fallo de git cat-file -e como nombre libre y el registro se publica; sólo un nombre realmente ocupado se rechaza con usage: record not published. Además una línea del párrafo mide 90 columnas.
- **2026-10-02T16:42:35Z** `[note]` Corrección del orquestador tras la tercera ronda: el párrafo del sufijo dice ahora que, con la ref de estado, publicar en un nombre ya ocupado se rechaza con usage: record not published en vez de sobrescribir, sin afirmar nada sobre un fallo de la comprobación de existencia, y se reajusta a 80 columnas.
- **2026-10-02T16:43:00Z** `[note]` Cuarta ronda autorizada por el humano, limitada al párrafo del sufijo de docs/usage-capture.md.
- **2026-10-02T16:43:01Z** `[status]` in-progress → in-review
- **2026-10-02T16:43:41Z** `[review]` in-review → in-progress (retry): Cuarta ronda: la primera frase del párrafo dice que un nombre ocupado saca otro sufijo en ambos layouts, pero con la ref de estado stateHolds trata un fallo de git cat-file -e como nombre libre y no vuelve a sortear; sólo la guarda de mutateState lo rechaza después (y con bytes idénticos no hay nada que rechazar).
- **2026-10-02T16:43:50Z** `[note]` Corrección del orquestador tras la cuarta ronda: el párrafo separa los layouts; en el worktree un nombre ocupado saca otro sufijo; con la ref de estado el colector vuelve a sortear cuando su comprobación encuentra el nombre ocupado, y si la comprobación no lo ve y los bytes difieren, mutateState rechaza cambiar el registro existente con el aviso usage: record not published.
