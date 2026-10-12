---
id: "20261012-212527"
title: Las pruebas de señales del envoltorio de la suite fallan en Windows
type: bug
status: draft
created: 2026-10-12T21:25:27Z
depends_on: []
related_to: ["20261007-135154", "20260812-025623"]
owner: rarc88
---

## Request

En el workflow `CI` (`.github/workflows/ci.yml`), los jobs `verify (node 24 / windows-latest)`
y `verify (node 26 / windows-latest)` fallan en `test/run-tests.test.mjs` con las
pruebas de señales del envoltorio `scripts/run-tests.mjs`, que pasan en Linux y
macOS. Se pide:

1. que la suite vuelva a estar verde en Windows sin perder la cobertura de
   señales en Linux y macOS;
2. determinar si el defecto está en el producto (¿se queda la raíz temporal en
   Windows cuando el usuario pulsa Ctrl+C o el CI cancela?) o sólo en un test que
   afirma un comportamiento exclusivo de POSIX.

Quedan fuera de este change los otros dos fallos de esos mismos jobs en
`test/usage-collector.test.mjs` (`the test helpers isolate a developer's global
git config` y `an env override on (emulated) Windows reaches no shell and prints
no DEP0190`, ambos `ERR_UNSUPPORTED_ESM_URL_SCHEME` por un `import()` de una ruta
absoluta `D:\…`), y el fallo de macOS en `20261002-133728 CR1`: son causas
distintas.

## Investigation

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

## Plan

- [ ] Acotar a plataformas distintas de `win32` el bucle de pruebas de señales
  de `test/run-tests.test.mjs` con `skip: process.platform === 'win32' && '<motivo>'`
  y un comentario que cite la semántica documentada de `subprocess.kill` en Windows
  - **Target:** `test/run-tests.test.mjs`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR2
- [ ] Comprobar en el CI de Windows que las cuatro pruebas se saltan con su motivo
  y no figuran entre los fallos
  - **Target:** `test/run-tests.test.mjs`
  - **Verify:** verify: manual — en los logs de `verify (node 24 / windows-latest)` y `verify (node 26 / windows-latest)`, las cuatro líneas `﹣ CR3: … # <motivo>` y ninguna de ellas bajo `failing tests`
  - **Criteria:** CR1
- [ ] Nombrar en la cabecera de `scripts/run-tests.mjs` el alcance en Windows:
  sólo Ctrl+C (SIGINT) y cerrar la consola (SIGHUP) llegan a los manejadores;
  cualquier terminación forzosa deja la raíz como SIGKILL; Ctrl+C en Windows no
  se ha ejecutado
  - **Support:** comentario, sin comportamiento observable
- [ ] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-12T21:25:27Z** `[version]` 0.18.0-dev
