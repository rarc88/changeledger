---
id: "20261012-212527"
title: "La suite falla en Windows: pruebas de señales del envoltorio e imports de rutas absolutas"
type: bug
status: in-review
created: 2026-10-12T21:25:27Z
depends_on: []
branch: bug/20261012-212527
related_to: ["20261002-133728", "20261007-135154", "20260812-025623", "20261001-155612", "20260730-220857"]
owner: rarc88
---

## Request

En el workflow `CI` (`.github/workflows/ci.yml`), los jobs `verify (node 24 / windows-latest)`
y `verify (node 26 / windows-latest)` fallan con seis pruebas que pasan en Linux y macOS:

- las cuatro pruebas de señales del envoltorio `scripts/run-tests.mjs` en
  `test/run-tests.test.mjs` (`CR3: <signal> ends the run with <code> and cleans up`);
- dos pruebas de `test/usage-collector.test.mjs`: `the test helpers isolate a developer's
  global git config` y `an env override on (emulated) Windows reaches no shell and prints no
  DEP0190`, ambas con `ERR_UNSUPPORTED_ESM_URL_SCHEME`;
- tras corregir esas seis, el CI de Windows del PR rarc88/changeledger#9 mostró una séptima:
  `174310 CR7: a fresh repo refuses new hotfix until release_branch is declared, then it loads
  end to end` (`test/cli-bin.test.mjs`).

Se pide, en un único change para los fallos de Windows:

1. que la suite vuelva a estar verde en Windows sin perder la cobertura de esas pruebas en
   Linux y macOS;
2. determinar si cada defecto está en el producto (`src/`, `bin/`, `scripts/`) o sólo en las
   pruebas;
3. localizar otras apariciones del patrón de `import()` que fallarían en Windows aunque hoy no
   figuren entre los fallos.

Queda fuera el fallo de macOS en `20261002-133728 CR1`, que tiene su propio change.

## Investigation

### Pruebas de señales del envoltorio

**Evidencia.** Logs de los jobs 114928276384 (node 24.21.0, Windows Server 2025)
y 114928276613 (node 26). Fallan las **cuatro** variantes del bucle de
`test/run-tests.test.mjs` (`CR3: <signal> ends the run with <code> and cleans up`),
no sólo SIGINT y SIGTERM:

| Señal enviada | Esperado | Observado en Windows |
|---|---|---|
| SIGINT | `{ status: 130, sig: null }` | `{ status: null, sig: 'SIGINT' }` |
| SIGTERM | `{ status: 143, sig: null }` | `{ status: null, sig: 'SIGTERM' }` |
| SIGHUP | `{ status: 129, sig: null }` | `{ status: null, sig: 'SIGKILL' }` |
| SIGQUIT | `{ status: 131, sig: null }` | `{ status: null, sig: 'SIGQUIT' }` |

En macOS (jobs 114928276410 y 114928276467) y en Linux (`node --test
test/run-tests.test.mjs` en este clon, node 24.21.0, `dev` en `f391718c`) las
cuatro pasan y el archivo informa `ℹ skipped 0`.

**Qué hace el envoltorio.** `scripts/run-tests.mjs` instala, antes de crear la
raíz, manejadores `process.on` para SIGINT, SIGTERM, SIGHUP y SIGQUIT (mapa
`forwarded`); cada uno guarda la señal recibida en `received` y reenvía al hijo
`node --test` SIGINT o SIGTERM con `child.kill`. Al `close` del hijo, `finish`
borra la raíz (`fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })`)
y sale con `128 + os.constants.signals[received]` (130, 143, 129, 131) o con el
código del hijo. Todo depende de que el proceso del envoltorio **ejecute** su
manejador.

**Cómo envía la señal el test.** Lanza el envoltorio con `spawn` sobre el fixture
`test/fixtures/run-tests/hang.mjs`, espera el informe del test colgado y llama a
`child.kill(signal)` sobre el envoltorio; luego afirma `{ status: code, sig: null }`
y que el sandbox quede vacío.

**Semántica de Node en Windows (documentada).**

- `subprocess.kill([signal])`
  (<https://nodejs.org/api/child_process.html#subprocesskillsignal>): en Windows,
  donde no existen señales POSIX, `'SIGKILL'`, `'SIGTERM'`, `'SIGINT'` y
  `'SIGQUIT'` terminan el proceso de forma forzosa y abrupta (como `'SIGKILL'`), y
  cualquier otra señal cuyo nombre exista en Windows, como `'SIGHUP'`, hace lo
  mismo.
- `process` → *Signal events*
  (<https://nodejs.org/api/process.html#signal-events>): Windows no tiene señales;
  enviar SIGINT, SIGTERM o SIGKILL con `process.kill()`/`subprocess.kill()` termina
  el proceso incondicionalmente y después el padre lo ve como terminado por esa
  señal. En la misma sección: SIGTERM no existe en Windows (sólo se puede
  escuchar); SIGINT desde el terminal (Ctrl+C) sí se entrega en todas las
  plataformas; SIGHUP se genera en Windows al cerrar la ventana de la consola y
  Windows termina Node unos 10 s después; SIGBREAK se entrega con Ctrl+Break.

Eso explica las cuatro filas: el test termina el envoltorio con
`TerminateProcess`, ningún manejador corre, no hay `process.exit(130…)`, y el
padre ve `signal` en vez de `status` (para SIGHUP, la señal coaccionada se
informa como `SIGKILL`). Además, la raíz `changeledger-test-*` queda en el
sandbox y el `node --test` nieto queda huérfano hasta que `t.after` mata el test
colgado; no llega a afirmarse porque el `deepEqual` del resultado falla antes.

**Producto frente a test.** La causa raíz está en el test: `child.kill(signal)`
sólo es una señal entregable en POSIX; en Windows es una terminación forzosa,
equivalente al SIGKILL que la cabecera de `scripts/run-tests.mjs` y la spec ya
declaran no cubierto. Ningún código del envoltorio puede ejecutarse tras
`TerminateProcess`, así que no existe arreglo de producto para ese camino (un
manejador de `'exit'` tampoco corre). En Windows, los únicos caminos que llegan a
los manejadores del envoltorio son Ctrl+C en la consola (SIGINT) y cerrar la
ventana de la consola (SIGHUP, con unos 10 s); ambos ya están cubiertos por el
mapa `forwarded`. SIGTERM y SIGQUIT nunca se entregan desde fuera en Windows.

Lo que este análisis **no** puede establecer sin una consola Windows:

- Que Ctrl+C real limpie la raíz en Windows. El change 20261007-135154 lo dejó
  como residuo en su Log («Windows (TEMP/TMP) no se ejecutó»). Con Ctrl+C la
  consola entrega el evento a todos sus procesos; el manejador del envoltorio
  termina `node --test` a la fuerza (`child.kill('SIGINT')` es `TerminateProcess`
  en Windows) mientras los procesos de test reciben su propio Ctrl+C. El
  `rmSync` con `maxRetries: 5` podría encontrarse un proceso de test o un `git`
  aún vivo dentro de la raíz (EBUSY/EPERM en Windows); si los reintentos se
  agotan, el envoltorio lo dice en stderr (`run-tests: could not remove …`) y la
  raíz queda. No ejecutado.
- Cómo cancela GitHub Actions un job en Windows (evento de consola o terminación
  forzosa del árbol). En los runners alojados la máquina se desecha, así que una
  raíz que quede no tiene efecto; en un runner propio sí.
- Ctrl+Break (SIGBREAK) no está en `forwarded`: termina el envoltorio con la
  acción por defecto y deja la raíz. No observado; ver decisiones abajo.

**Alternativas descartadas.**

- Emular Ctrl+C en el test de Windows: Node no expone
  `GenerateConsoleCtrlEvent`, y el evento iría a toda la consola, incluido el
  propio `node --test` que ejecuta la suite.
- Limpieza en `process.on('exit')`: no corre tras `TerminateProcess`.
- Barrido al arrancar de raíces `changeledger-test-*` viejas: borraría la raíz de
  una ejecución concurrente salvo que se añada detección de vida por PID; amplía
  el alcance a SIGKILL en POSIX y responde a un problema no observado
  (`INTENT.md`: problemas observados, núcleo pequeño).

**Precedente.** El repo ya acota a POSIX con
`{ skip: process.platform === 'win32' && '<motivo>' }` (`test/import.test.mjs`,
`test/edit.test.mjs`, `test/repo.test.mjs`, `test/cutover.test.mjs`; change
20260812-025623). Comprobado aquí con un fixture equivalente: el reporter `spec`
muestra `﹣ <nombre> (…) # <motivo>` y el resumen cuenta el test en `skipped`, no
en `fail`.

**Spec afectada.** `lifecycle.md` (graduada desde 20261007-135154) dice que
`scripts/run-tests.mjs` borra la raíz «tras SIGINT, SIGTERM, SIGHUP o SIGQUIT; un
SIGKILL del envoltorio la deja atrás», sin plataforma. En la graduación debe
quedar acotado: en POSIX, esas cuatro señales; en Windows, sólo Ctrl+C (SIGINT) y
cerrar la consola (SIGHUP) llegan al envoltorio, y cualquier terminación forzosa
(`process.kill`/`subprocess.kill` con cualquier señal, `taskkill /F`, Ctrl+Break)
deja la raíz como un SIGKILL; la limpieza con Ctrl+C en Windows no se ha
ejecutado.

**Interfaces externas.** Ninguna nueva. El texto del reporter de `node --test`
(`﹣ … # motivo`) se lee a mano en el log del CI; ningún criterio lo consume de
forma automática.

### Imports de rutas absolutas en `test/usage-collector.test.mjs`

**Evidencia.** Logs de los jobs 114928276384 (node 24.21.0) y 114928276613 (node 26), `dev` en
`f391718c`. Cada log termina con `ℹ fail 6`: las cuatro pruebas de señales de
`test/run-tests.test.mjs` (sección anterior) y estas dos; ninguna otra falla.
En macOS y Linux las dos pasan (`node --test test/usage-collector.test.mjs` en este clon:
`pass 37, fail 0`).

**Causa raíz.** Las dos pruebas lanzan un hijo `node --input-type=module -e <script>` y el
script incrusta como especificador de `import()` una ruta del sistema de ficheros sin convertir
a URL:

- `the test helpers isolate a developer's global git config`: dos `await import(...)`, uno de
  `path.resolve('test/helpers/git-env.mjs')` (sólo en la variante `withHelper`) y otro de
  `path.resolve('src/config.mjs')`, ambos con `JSON.stringify(path.resolve(...))`.
- `an env override on (emulated) Windows reaches no shell and prints no DEP0190`: un
  `await import(...)` de `path.resolve('src/usage-collector.mjs')`.

En Windows `path.resolve` devuelve `D:\a\changeledger\changeledger\src\config.mjs`; el cargador
ESM de Node lo interpreta como una URL, ve el esquema `d:` y lanza
`ERR_UNSUPPORTED_ESM_URL_SCHEME` antes de ejecutar nada. En POSIX una ruta absoluta
(`/home/…`) se acepta como URL relativa al origen, por eso nunca falló allí. El log lo muestra:
el script impreso termina en `await import("D:\\a\\changeledger\\changeledger\\src\\config.mjs")`.

**Reproducción en Linux.** Se puede reproducir sin Windows: con node 24.21.0,
`node --input-type=module -e 'await import("D:\\a\\x\\src\\config.mjs")'` falla con el mismo
`ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'd:'`, mientras que
`pathToFileURL('D:\\a\\x\\src\\config.mjs', { windows: true }).href` da
`file:///D:/a/x/src/config.mjs`, que es un especificador válido. Una ruta POSIX absoluta cruda
carga bien (por eso Linux pasa) y `pathToFileURL(ruta).href` también.

**Producto frente a test.** Sólo test. Un barrido de `import(`, `--import`, `--require`, `-e` /
`--input-type`, `createRequire` y `register(` sobre `src/`, `bin/`, `scripts/` y `test/`:

- `src/`, `bin/` y `scripts/` no tienen ningún `import()` dinámico ni `--import` en el lado Node.
  Los únicos `import(` de `src/` son `import('/shared/metrics.mjs')` y
  `import('/shared/usage-analysis.mjs')` en `src/viewer/public/app.js`, que corre en el
  navegador con URLs HTTP, no en Node. `src/usage-collector.mjs` lanza un supervisor con
  `node -e` pero éste sólo hace `require` de módulos `node:` (`child_process`, `fs`, `os`).
  `bin/changeledger.mjs` y `src/viewer/server/router.mjs` usan `createRequire(import.meta.url)`,
  que ya es una URL.
- No hay arreglo de producto.

**Otras apariciones.** Las únicas tres incrustaciones con `path.resolve(...)` directo en un
`import` de un script hijo son estas tres (dos pruebas, tres especificadores). El
resto de la suite ya sigue la forma correcta, así que no hay un cuarto fallo latente:

- Con `pathToFileURL(...).href`: `test/cli.test.mjs` (`new reserves ids atomically…`),
  `test/agent.test.mjs` (`212314 CR1: concurrent task mutations…`) y `test/sync.test.mjs`
  (`snapshotInOwnProcess`).
- Con `new URL('../src/…', import.meta.url).href`: `test/agent.test.mjs`
  (`150232 CR3: release publication wins…`) y `test/registry.test.mjs` (`registryMjsUrl`).
- Con especificador relativo, sin ruta absoluta: `await import('../src/…')` en
  `test/view.test.mjs`, `test/viewer-metadata.test.mjs`, `test/viewer-sanitize.test.mjs`,
  `test/cutover.test.mjs`, `test/framing.test.mjs`, `test/usage-analysis.test.mjs`
  y `test/app-state.test.mjs`.
- Las pruebas que lanzan `node <ruta absoluta de un script>` (`test/helpers/ccusage.mjs`,
  `test/fixtures/ccusage/*.mjs`, `test/helpers/versioned-cli.mjs`) pasan la ruta como
  argumento del ejecutable, no como especificador ESM, y Windows la acepta.

Esa cuenta se comprobó con
`grep -rnE '(import\(|from )\$\{JSON\.stringify\(path\.(resolve|join)\(' test`: tres coincidencias,
todas en `test/usage-collector.test.mjs`.

**Arreglo mínimo.** Envolver los tres especificadores con `pathToFileURL(path.resolve(…)).href`
(`import { pathToFileURL } from 'node:url'`), igual que `sync.test.mjs`, `cli.test.mjs` y
`agent.test.mjs`. Nada más cambia: ni `src/`, ni los fixtures, ni lo que las pruebas afirman.

**Historia.** Las dos pruebas nacieron en el change 20261001-155612: la de aislamiento en
`ee978f27` y la de DEP0190 en `8c36b4d9`. No se ha determinado por qué el CI de Windows no las
había hecho fallar antes (los logs anteriores no se han revisado).
Precedente de arreglos de portabilidad en pruebas: 20260730-220857 (fixtures que asumían POSIX).

**Lo que no se puede establecer sin Windows.** Que, una vez resuelto el `import`, las dos
pruebas pasen enteras en Windows. La de aislamiento además comprueba que
`GIT_CONFIG_GLOBAL` apunte al fichero de la prueba (otras pruebas del mismo archivo ya lo hacen
y pasan en Windows) y la de DEP0190 que el hijo imprima `ran` con `process.platform` forzado
a `win32` sobre un Windows real; ninguna se ha ejecutado allí tras el arreglo. Por eso la
verificación definitiva es el CI de Windows (CR5).

**Alternativas descartadas.**

- Saltar las dos pruebas en Windows: la de DEP0190 emula Windows precisamente para vigilar ese
  camino, y la de aislamiento protege la hermeticidad en todas las plataformas; el defecto es
  de la construcción del script, no de una limitación de la plataforma.
- Pasar las rutas al hijo por `process.argv` y hacer `import(pathToFileURL(argv[1]).href)`
  dentro del script: es equivalente pero más ruido que convertir antes de incrustar.
- Un ayudante compartido en `test/helpers/`: tres usos en un solo archivo no lo justifican
  (`INTENT.md`: problemas observados, núcleo pequeño); el barrido de CR4 es el guard.

**Interfaces externas.** `pathToFileURL` de `node:url` y el mensaje del cargador ESM de Node
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`) son interfaces estables de Node >= 24 (`engines`); ningún
criterio consume de forma automática el texto del log del CI, que se lee a mano.

### Separador de ruta en `174310 CR7`

El test `174310 CR7` de `test/cli-bin.test.mjs` afirma la salida de `new` con
`/^Created .*\.changeledger\/changes\/\d{8}-\d{6}-x\.md$/m`. En Windows el CLI imprime la
ruta con su separador nativo: `Created C:\Users\RUNNER~1\…\.changeledger\changes\20261012-220144-x.md`
(jobs 115025290058 y 115025290137 del run 38313728966), y la expresión no casa. El producto es
correcto (imprime la ruta del sistema); el defecto es del test, que fija `/`. Es la única
expresión de `test/` con `\.changeledger\/changes\/` (grep). Arreglo: aceptar cualquiera de
los dos separadores (`[\\/]`) en esa expresión.

## Specification

### CR1 — En Windows las cuatro pruebas de señales se saltan con motivo
- **Given** el job `verify` del workflow `CI` en `windows-latest` (node 24 y node 26)
- **When** ejecuta `pnpm test`
- **Then** los tests `CR3: SIGINT ends the run with 130 and cleans up`, `CR3: SIGTERM ends the run with 143 and cleans up`, `CR3: SIGHUP ends the run with 129 and cleans up` y `CR3: SIGQUIT ends the run with 131 and cleans up` aparecen como saltados (`﹣ <nombre> (…) # <motivo>`), con un motivo que nombra que en Windows `child.kill()` termina el envoltorio de forma forzosa sin ejecutar ningún manejador
- **And** ninguno de los cuatro figura en la lista `failing tests` del log

### CR2 — Fuera de Windows las cuatro pruebas siguen ejecutándose
- **Given** una plataforma distinta de `win32` (Linux en local; macOS y Linux en el CI)
- **When** se ejecuta `node --test test/run-tests.test.mjs`
- **Then** los siete tests del archivo pasan, entre ellos los cuatro `CR3: <signal> ends the run with <code> and cleans up`
- **And** el resumen informa `ℹ skipped 0`

### CR3 — Las dos pruebas siguen pasando fuera de Windows con el especificador convertido
- **Given** Linux o macOS con node >= 24 y `test/usage-collector.test.mjs` sin otro cambio que la conversión de los tres especificadores
- **When** se ejecuta `node --test test/usage-collector.test.mjs`
- **Then** `the test helpers isolate a developer's global git config` y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` pasan
- **And** la primera sigue afirmando que el hijo sin el ayudante imprime `ccusage` y con el ayudante `undefined`, y la segunda que el hijo sale con estado 0, imprime `{"code":null,"status":0,"out":"ran"}` y no escribe nada en stderr
- **And** el resumen informa `ℹ fail 0`

### CR4 — Ninguna prueba incrusta una ruta cruda como especificador de import de un script hijo
- **Given** los ficheros `test/**/*.mjs` del repo
- **When** una prueba de barrido de `test/usage-collector.test.mjs` los lee y busca `import(${JSON.stringify(path.resolve(…))})` o `import … from ${JSON.stringify(path.resolve(…))}` (o `path.join`) en el código fuente
- **Then** no encuentra ninguna coincidencia
- **And** antes de convertir los especificadores encuentra tres, las de `the test helpers isolate a developer's global git config` (dos) y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` (una), de modo que la prueba falla en Linux con el código actual
- **And** el barrido ignora la forma que sí es válida: `pathToFileURL(path.resolve(…)).href` y `new URL(…, import.meta.url).href`

### CR5 — En el CI de Windows las dos pruebas dejan de fallar
- **Given** el job `verify` del workflow `CI` en `windows-latest` (node 24 y node 26) con el arreglo aplicado
- **When** ejecuta `pnpm test`
- **Then** `the test helpers isolate a developer's global git config` y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` figuran como `✔` y ninguna aparece bajo `failing tests`
- **And** ninguno de los dos logs contiene `ERR_UNSUPPORTED_ESM_URL_SCHEME`

### CR6 — El producto no cambia
- **Given** el commit que resuelve este change
- **When** se compara con su padre
- **Then** sólo cambian `test/run-tests.test.mjs`, `test/usage-collector.test.mjs`, `test/cli-bin.test.mjs` y el comentario de cabecera de `scripts/run-tests.mjs`; `src/`, `bin/` y `templates/` quedan intactos
- **And** el CLI se comporta igual que antes porque ningún código de `src/`, `bin/` ni `scripts/` importa una ruta absoluta (el análisis de la Investigation)

### CR7 — `174310 CR7` acepta el separador de ruta de la plataforma
- **Given** el test `174310 CR7: a fresh repo refuses new hotfix until release_branch is declared, then it loads end to end` de `test/cli-bin.test.mjs`
- **When** se ejecuta en Linux y en el job `verify` de `windows-latest` (node 24 y node 26)
- **Then** pasa en las dos plataformas: su aserción sobre la salida de `new` casa tanto `Created …/.changeledger/changes/<id>-x.md` como `Created …\.changeledger\changes\<id>-x.md`
- **And** en Linux, con la expresión revertida a sólo `/` y la salida simulada con `\`, la aserción falla

## Plan

- [x] Acotar a plataformas distintas de `win32` el bucle de pruebas de señales
  de `test/run-tests.test.mjs` con `skip: process.platform === 'win32' && '<motivo>'`
  y un comentario que cite la semántica documentada de `subprocess.kill` en Windows
  - **Target:** `test/run-tests.test.mjs`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-12T21:55:48Z`
- [x] Comprobar en el CI de Windows que las cuatro pruebas se saltan con su motivo
  y no figuran entre los fallos
  - **Target:** `test/run-tests.test.mjs`
  - **Verify:** verify: manual — en los logs de `verify (node 24 / windows-latest)` y `verify (node 26 / windows-latest)`, las cuatro líneas `﹣ CR3: … # <motivo>` y ninguna de ellas bajo `failing tests`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-12T22:14:49Z`
- [x] Nombrar en la cabecera de `scripts/run-tests.mjs` el alcance en Windows:
  sólo Ctrl+C (SIGINT) y cerrar la consola (SIGHUP) llegan a los manejadores;
  cualquier terminación forzosa deja la raíz como SIGKILL; Ctrl+C en Windows no
  se ha ejecutado
  - **Support:** comentario, sin comportamiento observable
  - **Resolved:** `2026-10-12T21:55:48Z`
- [x] Escribir la prueba de barrido de CR4 en `test/usage-collector.test.mjs` y comprobar
  que falla con tres coincidencias antes de tocar los especificadores
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-12T21:55:48Z`
- [x] Convertir con `pathToFileURL(path.resolve(…)).href` los tres especificadores de
  `the test helpers isolate a developer's global git config` y
  `an env override on (emulated) Windows reaches no shell and prints no DEP0190`, e importar
  `pathToFileURL` de `node:url`; el barrido pasa y las dos pruebas conservan sus aserciones
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR3, CR4, CR6
  - **Resolved:** `2026-10-12T21:55:49Z`
- [x] Comprobar en el CI de Windows que las dos pruebas pasan y que el log no contiene
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** verify: manual — en los logs de `verify (node 24 / windows-latest)` y `verify (node 26 / windows-latest)`, ambas pruebas con `✔`, ninguna bajo `failing tests` y cero apariciones de `ERR_UNSUPPORTED_ESM_URL_SCHEME`; si aflora otro fallo dentro de ellas, anotarlo en el Log y parar
  - **Criteria:** CR5
  - **Resolved:** `2026-10-12T22:14:50Z`
- [x] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-12T21:55:49Z`

- [x] Aceptar ambos separadores de ruta en la aserción `Created …` de `174310 CR7`
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-12T22:16:37Z`
- [x] Comprobar en el CI de Windows que `174310 CR7` pasa
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** verify: manual — en los logs de `verify (node 24 / windows-latest)` y `verify (node 26 / windows-latest)`, `174310 CR7` con `✔` y ninguna prueba bajo `failing tests`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-12T22:31:44Z`
- [x] Ejecutar el gate completo tras CR7
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-12T22:16:37Z`

## Log
- **2026-10-12T21:25:27Z** `[version]` 0.18.0-dev
- **2026-10-12T21:35:27Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T21:44:12Z** `[status]` approved → in-progress
- **2026-10-12T21:44:12Z** `[branch]` set: bug/20261012-212527 (auto)
- **2026-10-12T21:55:47Z** `[note]` Implementación (sin Windows): las cuatro pruebas de señales de test/run-tests.test.mjs se saltan en win32 con el motivo «on Windows child.kill() terminates the wrapper forcibly and runs no signal handler»; los tres especificadores de import de test/usage-collector.test.mjs pasan por pathToFileURL(path.resolve(...)).href; test de barrido nuevo «no test embeds a raw filesystem path as an import specifier of a child script», rojo antes de la conversión con tres coincidencias; comentario de cabecera de scripts/run-tests.mjs con el alcance en Windows. Con process.platform simulado como win32, el reporter muestra las cuatro pruebas saltadas con su motivo. 4 mutantes caen. pnpm verify en verde (2001 tests, 0 saltados). Pendiente: las tareas 2 y 6 (CR1 y CR5) sólo se verifican en el CI de Windows. Residuos: spec lifecycle sin acotar por plataforma (graduación); limpieza con Ctrl+C real en Windows no ejecutada; Ctrl+Break no reenviado; el barrido sólo cubre la forma JSON.stringify(path.resolve|join(...)) en test/**/*.mjs.
- **2026-10-12T22:14:49Z** `[note]` CI de Windows del PR rarc88/changeledger#9 (run 38313728966, jobs 115025290058 y 115025290137): las cuatro pruebas CR3 de señales aparecen saltadas con el motivo «on Windows child.kill() terminates the wrapper forcibly and runs no signal handler» y ninguna figura bajo failing tests (CR1); «the test helpers isolate a developer's global git config» y «an env override on (emulated) Windows reaches no shell and prints no DEP0190» pasan con ✔ y ningún log contiene ERR_UNSUPPORTED_ESM_URL_SCHEME (CR5). Queda un fallo nuevo en ambos jobs: 174310 CR7 (test/cli-bin.test.mjs) exige una ruta con / y Windows imprime \ en «Created …\.changeledger\changes\…-x.md»; se incorpora a este change por decisión del humano (un único change para los fallos de Windows).
- **2026-10-12T22:16:36Z** `[note]` CR7: la aserción Created … de 174310 CR7 acepta [\\/] como separador. Comprobado en Linux con node: la expresión anterior no casa una salida Created C:\…\.changeledger\changes\<id>-x.md y sí la nueva; ambas casan la forma con /. El test pasa en Linux; pnpm verify en verde (2001).
- **2026-10-12T22:31:43Z** `[note]` CI de Windows del PR rarc88/changeledger#9 sobre 2a71cba7 (run 38315727343, jobs 115031757739 y 115031757758): verde, 174310 CR7 con ✔, fail 0, skipped 11 (las cuatro de señales más siete saltos POSIX previos). Los dos jobs de macOS de este PR fallan sólo en 20261002-133728 CR1, que corrige #20261012-213243 (ya en dev).
- **2026-10-12T22:31:45Z** `[status]` in-progress → in-review
- **2026-10-12T22:31:50Z** `[note]` Mandato de revisión: la superficie que gobierna el change — los saltos win32 de test/run-tests.test.mjs, los especificadores y el barrido de test/usage-collector.test.mjs, la aserción de 174310 CR7 en test/cli-bin.test.mjs y el comentario de cabecera de scripts/run-tests.mjs; rango f391718c..2a71cba7, con la evidencia del CI de Windows en el Log.
