---
id: "20261012-212837"
title: "Dos pruebas del colector de consumo importan rutas absolutas y fallan en Windows"
type: bug
status: draft
created: 2026-10-12T21:28:37Z
depends_on: []
related_to: ["20261001-155612", "20261012-212527", "20260730-220857"]
owner: rarc88
---

## Request

En el workflow `CI` (`.github/workflows/ci.yml`), los jobs `verify (node 24 / windows-latest)`
y `verify (node 26 / windows-latest)` fallan en `test/usage-collector.test.mjs` con dos pruebas,
que pasan en Linux y macOS:

- `the test helpers isolate a developer's global git config`
- `an env override on (emulated) Windows reaches no shell and prints no DEP0190`

Ambas terminan con `Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: … On Windows, absolute paths must be
valid file:// URLs. Received protocol 'd:'`. Se pide:

1. que esas dos pruebas pasen en Windows sin perder lo que verifican en Linux y macOS;
2. determinar si el defecto está en el producto (`src/`, `bin/`, `scripts/`) o sólo en las
   pruebas;
3. localizar otras apariciones del mismo patrón en la suite o en `src/` que fallarían en
   Windows aunque hoy no figuren entre los fallos.

Quedan fuera de este change las cuatro pruebas `CR3: <signal> ends the run with <code> and cleans up`
de `test/run-tests.test.mjs` (otro fallo de esos mismos jobs, causa distinta: lo trata el change
20261012-212527) y el fallo de macOS en `20261002-133728 CR1`.

## Investigation

**Evidencia.** Logs de los jobs 114928276384 (node 24.21.0) y 114928276613 (node 26), `dev` en
`f391718c`. Cada log termina con `ℹ fail 6`: las cuatro pruebas de señales de
`test/run-tests.test.mjs` (change 20261012-212527) y las dos de este change; ninguna otra falla.
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
`import` de un script hijo son las tres de este change (dos pruebas, tres especificadores). El
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
verificación definitiva es el CI de Windows (CR3).

**Alternativas descartadas.**

- Saltar las dos pruebas en Windows: la de DEP0190 emula Windows precisamente para vigilar ese
  camino, y la de aislamiento protege la hermeticidad en todas las plataformas; el defecto es
  de la construcción del script, no de una limitación de la plataforma.
- Pasar las rutas al hijo por `process.argv` y hacer `import(pathToFileURL(argv[1]).href)`
  dentro del script: es equivalente pero más ruido que convertir antes de incrustar.
- Un ayudante compartido en `test/helpers/`: tres usos en un solo archivo no lo justifican
  (`INTENT.md`: problemas observados, núcleo pequeño); el barrido de CR2 es el guard.

**Interfaces externas.** `pathToFileURL` de `node:url` y el mensaje del cargador ESM de Node
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`) son interfaces estables de Node >= 24 (`engines`); ningún
criterio consume de forma automática el texto del log del CI, que se lee a mano.

## Specification

### CR1 — Las dos pruebas siguen pasando fuera de Windows con el especificador convertido
- **Given** Linux o macOS con node >= 24 y `test/usage-collector.test.mjs` sin otro cambio que la conversión de los tres especificadores
- **When** se ejecuta `node --test test/usage-collector.test.mjs`
- **Then** `the test helpers isolate a developer's global git config` y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` pasan
- **And** la primera sigue afirmando que el hijo sin el ayudante imprime `ccusage` y con el ayudante `undefined`, y la segunda que el hijo sale con estado 0, imprime `{"code":null,"status":0,"out":"ran"}` y no escribe nada en stderr
- **And** el resumen informa `ℹ fail 0`

### CR2 — Ninguna prueba incrusta una ruta cruda como especificador de import de un script hijo
- **Given** los ficheros `test/**/*.mjs` del repo
- **When** una prueba de barrido de `test/usage-collector.test.mjs` los lee y busca `import(${JSON.stringify(path.resolve(…))})` o `import … from ${JSON.stringify(path.resolve(…))}` (o `path.join`) en el código fuente
- **Then** no encuentra ninguna coincidencia
- **And** antes de convertir los especificadores encuentra tres, las de `the test helpers isolate a developer's global git config` (dos) y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` (una), de modo que la prueba falla en Linux con el código actual
- **And** el barrido ignora la forma que sí es válida: `pathToFileURL(path.resolve(…)).href` y `new URL(…, import.meta.url).href`

### CR3 — En el CI de Windows las dos pruebas dejan de fallar
- **Given** el job `verify` del workflow `CI` en `windows-latest` (node 24 y node 26) con el arreglo aplicado
- **When** ejecuta `pnpm test`
- **Then** `the test helpers isolate a developer's global git config` y `an env override on (emulated) Windows reaches no shell and prints no DEP0190` figuran como `✔` y ninguna aparece bajo `failing tests`
- **And** ninguno de los dos logs contiene `ERR_UNSUPPORTED_ESM_URL_SCHEME`

### CR4 — El producto no cambia
- **Given** el commit que resuelve este change
- **When** se compara con su padre
- **Then** sólo cambia `test/usage-collector.test.mjs`; `src/`, `bin/`, `scripts/` y `templates/` quedan intactos
- **And** el CLI se comporta igual que antes porque ningún código de `src/`, `bin/` ni `scripts/` importa una ruta absoluta (el análisis de la Investigation)

## Plan

- [ ] Escribir la prueba de barrido de CR2 en `test/usage-collector.test.mjs` y comprobar
  que falla con tres coincidencias antes de tocar los especificadores
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR2
- [ ] Convertir con `pathToFileURL(path.resolve(…)).href` los tres especificadores de
  `the test helpers isolate a developer's global git config` y
  `an env override on (emulated) Windows reaches no shell and prints no DEP0190`, e importar
  `pathToFileURL` de `node:url`; el barrido pasa y las dos pruebas conservan sus aserciones
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR1, CR2, CR4
- [ ] Comprobar en el CI de Windows que las dos pruebas pasan y que el log no contiene
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`
  - **Target:** `test/usage-collector.test.mjs`
  - **Verify:** verify: manual — en los logs de `verify (node 24 / windows-latest)` y `verify (node 26 / windows-latest)`, ambas pruebas con `✔`, ninguna bajo `failing tests` y cero apariciones de `ERR_UNSUPPORTED_ESM_URL_SCHEME`; si aflora otro fallo dentro de ellas, anotarlo en el Log y parar
  - **Criteria:** CR3
- [ ] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-12T21:28:37Z** `[version]` 0.18.0-dev
