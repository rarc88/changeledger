---
id: "20261002-161641"
title: Tolerar en la ref de estado colecciones que la CLI no conoce
type: feature
status: in-progress
created: 2026-10-02T16:16:41Z
depends_on: []
branch: feature/20261002-161641
related_to: ["20261002-133728", "20260808-151640", "20260808-142200", "20260925-130844", "20260924-184354"]
owner: rarc88
release_impact: minor
---

## Request

Al recorrer CR9 de `20261002-133728`, la ref de estado de este repo, también la
publicada en origin, recibió los primeros registros de consumo. Desde ese
momento la CLI instalada `0.17.0`, que no conoce la colección `usage`, falla en
cualquier comando con `invalid state path: .changeledger-state/usage/…`. El
guard de `min_cli_version` no llega a actuar, porque la lectura del snapshot
falla antes. Cualquier colección futura repetiría el problema con cada CLI
anterior a ella.

Se pide que una CLI que encuentra en la ref de estado una colección bien formada
que no conoce siga funcionando con el resto del ledger, avise con claridad que
hay datos que no sabe leer y pida actualizar, y nunca los pierda al escribir. El
humano autoriza que el change toque el techo de `global-state-scope`; la spec se
actualiza en la graduación.

Quedan fuera de este change: arreglar las CLIs ya publicadas, que no pueden
aprender esta regla; mostrar el aviso en la interfaz del viewer, más allá del
stderr de su servidor; y relajar la validación de rutas mal formadas.

## Investigation

`inspectStateTree` en `src/state-store.mjs` recorre todas las entradas del árbol
y lanza `invalid state path: <ruta>` en la primera que `statePathIsValid`
rechaza. `statePathIsValid` sólo acepta `manifest.yml`, `config.yml` y rutas de
tres partes `.changeledger-state/<colección>/<nombre>` cuya colección y
extensión declara `STATE_COLLECTION_EXTENSIONS`. Una colección desconocida y una
ruta mal formada producen hoy el mismo error.

La escritura (`mutateState`) construye el árbol nuevo sembrándolo con
`read-tree` desde la revisión base y aplicando sólo las rutas que cambian; las
entradas que la mutación no toca pasan intactas. La integridad de
`global-state-scope` (incluye #3) impide hoy que desaparezcan changes, specs,
releases y, con `20261002-133728`, registros de consumo.

Los guards de `min_cli_version` (change `20260924-184354`) leen la configuración
efectiva; con la ref de estado, ese config sale del mismo snapshot que falla. El
borrador `20260925-130844` trata otro caso de compatibilidad: una ref de estado
cuyo mínimo supera la CLI instalada.

Interfaces externas: ninguna.

## Proposal

Distinguir en `inspectStateTree` dos casos que hoy comparten el mismo error:

- **Ruta mal formada** (raíz distinta, profundidad distinta de tres, nombre de
  colección fuera de `/^[a-z][a-z0-9-]*$/`, archivo suelto bajo la raíz que no es
  manifest ni config): sigue fallando con `invalid state path: <ruta>`.
- **Colección bien formada pero desconocida**: la lectura la omite, conserva sus
  entradas en el snapshot como desconocidas y emite una vez por comando en
  stderr:
  `warning: the state ref holds collections ChangeLedger <VERSION> does not know (<colección>, …); update the installation to use them`.

La escritura sigue sembrando desde la base, así que las entradas desconocidas
pasan intactas. La integridad las cubre como a cualquier identidad: una
mutación, un merge de `sync` o un import que las quite se rechaza. `check` no
las valida y repite el aviso.

Alternativa descartada: fallar cerrado con un mensaje mejor. Es más simple, pero
deja a la CLI antigua sin acceso a todo el ledger por una colección opcional,
que es justo el fallo observado.

## Specification

### CR1 — Una colección desconocida no impide trabajar
- **Given** un repo activado cuya ref de estado contiene `.changeledger-state/future/a.json` además de sus changes, y un change `approved`
- **When** se ejecutan `changeledger list`, `changeledger context` y `changeledger status <id> in-progress`
- **Then** los tres terminan con código cero con su salida habitual
- **And** cada uno escribe en stderr una sola vez `warning: the state ref holds collections ChangeLedger <VERSION> does not know (future); update the installation to use them`

### CR2 — Escribir conserva las entradas desconocidas
- **Given** la ref de CR1
- **When** `changeledger status <id> in-progress` crea un commit en la ref de estado
- **Then** el árbol del commit nuevo contiene `.changeledger-state/future/a.json` con el mismo blob que la revisión anterior

### CR3 — Nada puede hacer desaparecer una entrada desconocida
- **Given** la ref de CR1
- **When** una mutación de la ref de estado produce una foto descendiente sin `.changeledger-state/future/a.json`, y en otro caso un `sync` cuyo merge la perdería
- **Then** ambos se rechazan antes de confirmar, igual que la desaparición de un change, y la ref no cambia

### CR4 — Las rutas mal formadas siguen siendo un error
- **Given** refs de estado que contienen, cada una, `.changeledger-state/future/sub/a.json`, `.changeledger-state/Future/a.json`, `.changeledger-state/loose.yml` y `other/a.json`
- **When** se ejecuta `changeledger list` sobre cada una
- **Then** cada ejecución termina con código distinto de cero y muestra `invalid state path: <ruta>`

### CR5 — `check` avisa sin validar lo desconocido
- **Given** la ref de CR1 con todos sus changes válidos
- **When** se ejecuta `changeledger check`
- **Then** termina con código cero y muestra el aviso de CR1

### CR6 — El primer uso real: una CLI anterior frente a una colección nueva
- **Given** una ref de estado con una colección que la CLI en ejecución no declara en `STATE_COLLECTION_EXTENSIONS`, simulando una versión posterior
- **When** el humano o el agente ejecuta su flujo habitual: `changeledger context`, `changeledger list --status approved`, una transición y `changeledger sync`
- **Then** todo funciona con el aviso, y la colección sigue en la ref local y en la remota después del `sync`

## Plan

- [x] Escribir pruebas fallidas: lectura tolerante, aviso, conservación, integridad y rutas mal formadas
  - **Target:** `test/state-store.test.mjs, test/cli-bin.test.mjs, test/sync.test.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/cli-bin.test.mjs test/sync.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-10-12T11:29:19Z`
- [x] Separar en el store las colecciones desconocidas de las rutas mal formadas y cubrirlas con la integridad
  - **Target:** `src/state-store.mjs, src/repo.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/repo.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-12T11:29:20Z`
- [x] Emitir el aviso una vez por comando y repetirlo en `check`
  - **Target:** `bin/changeledger.mjs, src/commands/check.mjs, test/cli-bin.test.mjs, test/check.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/check.test.mjs`
  - **Criteria:** CR1, CR5
  - **Resolved:** `2026-10-12T11:29:20Z`
- [x] Probar el flujo habitual completo frente a una colección futura, con `sync`
  - **Target:** `test/sync.test.mjs`
  - **Verify:** `node --test test/sync.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-12T11:29:20Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T11:29:21Z`

## Log
- **2026-10-02T16:16:41Z** `[version]` 0.18.0-dev
- **2026-10-07T17:21:52Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T11:14:58Z** `[status]` approved → in-progress
- **2026-10-12T11:14:58Z** `[branch]` set: feature/20261002-161641 (auto)
- **2026-10-12T11:29:21Z** `[note]` Implementación delegada (subagente, top tier), tareas 1 a 5; pnpm verify en verde con 1806/1806. classifyStatePath distingue known, unknown y malformed (nombre de colección /^[a-z][a-z0-9-]*$/); readSnapshot deja las entradas desconocidas fuera de documents, sin leer su blob, y las expone en unknown y unknownCollections; mutateState rechaza borrar o reescribir una entrada desconocida; commitMergedState rechaza un merge que pierda, por ruta, una entrada desconocida de cualquiera de los padres; el bin escribe el aviso una vez por proceso y check lo repite como warn en el informe de todo el repo. Defecto reproducido: list, context y check salían con invalid state path: .changeledger-state/future/a.json. Mutantes M1-M8 (desconocida como mal formada, aviso por lectura, entradas borradas al escribir, integridad de mutateState y del merge sin desconocidas, regex aflojada, check sin aviso, contenido leído, check <id> con aviso); todos fallan. Decisiones no especificadas: reescribir una entrada desconocida también se rechaza; el merge compara por ruta y acepta el blob del otro lado; el aviso lista las colecciones de la primera lectura; --version y --help también lo muestran; check <id> no lo repite y el aviso cuenta como warning sin cambiar el código de salida; las entradas desconocidas no tienen regla de extensión. Residuos: el fast-forward de sync no comprueba que sobrevivan entradas desconocidas ni identidades conocidas, y el merge tampoco comprueba las conocidas, así que «igual que la desaparición de un change» de CR3 sólo vale para mutateState; publishedMatches de cutover compara documents, que ya no incluye las desconocidas (no ejecutado); una colisión en una colección desconocida se informa como document; dos ls-tree extra por merge.
- **2026-10-12T11:29:22Z** `[status]` in-progress → in-review
- **2026-10-12T11:29:43Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD (0588cfd) contra CR1-CR6 y el Plan, dentro del techo de global-state-scope, con las decisiones no especificadas y los residuos del Log como puntos de escrutinio. Fuera del mandato: el hueco previo de sync, que no comprueba en fast-forward ni en merge que sobrevivan las identidades conocidas.
- **2026-10-12T11:36:41Z** `[review]` in-review → in-progress (retry): F1: readSnapshot deja las entradas desconocidas fuera de documents, pero publishedMatches y assertRevertRestoresSnapshot de src/commands/cutover.mjs siguen comparando sólo documents; ejecutado: con future/a.json añadida a la ref antes del commit de limpieza, cutover reanuda con exit 0 y cutover --undo borra la ref y deja el blob sin referencia, cuando en dev se detenía con invalid state path. Mismo patrón en initializedPublicationMatches, que sugiere git update-ref -d. El comentario de cutover.mjs que dice que rutas y contenidos idénticos implican un árbol idéntico queda falso. F2: el test de check sin aviso usa una ref sin colecciones conocidas. F3: el comentario «Its blob may come from either side» de state-store.mjs sugiere un límite que el merge no aplica.
