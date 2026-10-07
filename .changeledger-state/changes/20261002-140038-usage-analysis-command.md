---
id: "20261002-140038"
title: Analizar el consumo de los changes con changeledger analyze
type: feature
status: in-progress
created: 2026-10-02T14:00:38Z
depends_on: ["20261002-133728", "20261001-155216"]
branch: feature/20261002-140038
related_to: ["20261001-155612", "20260711-155721", "20261002-140242", "20261002-155917"]
owner: rarc88
release_impact: minor
---

## Request

Los registros de consumo existen para analizarlos: saber cuántos tokens y cuánto
coste lleva cada change y en qué etapa, con qué modelos y con qué versión de
ChangeLedger, para detectar cuellos de botella y comprobar si la herramienta
ahorra o consume. Un agente al que el humano pide ese análisis no debe leer los
registros en bruto: son acumulados por sesión, hay que restarlos y cruzarlos con
los Logs, y hacerlo a mano gasta muchos tokens y es propenso a errores. Se pide
un comando determinista, `changeledger analyze`, que entregue cifras agregadas
en texto y en JSON, sobre un módulo de análisis puro que después reutilizará el
panel del viewer.

Quedan fuera de este change: el panel del viewer (change propio), cualquier
umbral configurable, la estimación de lo que habría costado el trabajo sin
ChangeLedger y el desglose por rol de orquestador o subagente, que los registros
no distinguen más allá del modelo.

Tras la revisión (2026-10-07) el humano autoriza ampliar este change con tres
piezas: un aviso cuando un tramo absorbe transiciones que no dejaron registro
(hoy el tramo `approved` de este change se llevó unos 43,5 M tokens de cinco
días de otro trabajo con el colector apagado); reparar el panel de métricas del
viewer, que no carga desde `20261001-155216`; y decir a los agentes en el
contrato que usen `changeledger analyze` en vez de leer los registros.

## Investigation

Los registros (`schema: 1`, de `20261001-155612`, más `recorded_by` de
`20261002-133728`) son fotos acumuladas: por sesión y modelo traen
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` y
`cost_usd` (`null` si el modelo no tiene precio), junto con `change`, `at`,
`event`, `from` y `to` de la transición que disparó la foto. `20261002-133728`
los carga con el resto del ledger en ambos layouts. Una sesión aparece en fotos
de varios changes si sigue abierta, así que el consumo de un tramo sólo se
obtiene restando la foto anterior del mismo registrador, sea del change que
sea. La versión de ChangeLedger de cada momento sale de las líneas `[version]`
del Log (`20261001-155216`).

Precedente de módulo compartido: `src/metrics.mjs` (change `20260711-155721`) es
puro, sin IO ni reloj, importa sólo `src/lifecycle.mjs`, y el viewer lo descarga
del propio CLI a través de `SHARED_MODULES` en `src/viewer/server/router.mjs`
para recalcular sobre el conjunto filtrado. El CLI usa `commander`, cuyas
opciones con valores cerrados rechazan uno desconocido con su propio error.

Desde `20261001-155216`, `src/lifecycle.mjs` importa `isValidCliVersion` de
`src/version-guard.mjs`, que importa `src/config.mjs` y con él `node:fs`.
`SHARED_MODULES` sólo sirve `metrics.mjs` y `lifecycle.mjs`: con
`changeledger view . 4077`, `/shared/metrics.mjs` y `/shared/lifecycle.mjs`
responden 200 y `/shared/version-guard.mjs` 404, así que el navegador no puede
cargar el grafo de `metrics.mjs` y el panel de métricas falla.

El colector filtra las sesiones por los worktrees que existen en cada foto, así
que una sesión puede faltar en un registro y volver en el siguiente. Un registro
con `error` no trae sesiones. Un lote de `apply` con dos transiciones del mismo
change deja dos registros con el mismo `at`.

Interfaces externas: ninguna; el comando lee sólo el ledger.

## Proposal

Un módulo puro, `src/usage-analysis.mjs`, con la misma disciplina que
`src/metrics.mjs`, y un comando `changeledger analyze [id] [--by <clave>]
[--json]` que carga el ledger y lo imprime.

**Atribución.** Por cada `recorded_by`, los registros se ordenan por `at`. El
consumo de un registro es la diferencia, sesión a sesión y modelo a modelo,
contra los últimos valores que ese registrador vio de cada sesión, sea en el
registro anterior o en uno más antiguo y del change que sea; una sesión que el
registrador nunca vio cuenta entera. Así, una sesión que falta en una foto y
vuelve después no se cuenta dos veces. Los registros con `error` no traen datos:
no son base ni cierran tramo, y el consumo de su hueco cae en el siguiente
registro con datos del mismo registrador. Dos registros del mismo registrador
con el mismo `at` se ordenan por la cadena de sus transiciones (`created`
primero; el `to` de uno es el `from` del siguiente). Ese consumo se atribuye al
change del registro y al **tramo** que la transición cierra:

- `event: "created"` cierra `pre-draft`: la conversación previa a crear el
  change.
- Cualquier otra transición cierra el tramo de su estado de origen (`from`):
  `draft`, `approved`, `in-progress`, `in-review`, `in-validation`, `blocked`,
  `done`.
- Un tramo `in-progress` cerrado después de un `[review]` o un `[validation]`
  fallido del mismo change (el que vuelve a `in-progress` o el que pasa por
  `blocked`) se llama `rework`.

El primer registro de cada registrador no tiene base y no se atribuye. Una
sesión cuyos tokens bajan entre dos registros cuenta 0 en ese tramo. Ambos casos
generan un aviso. La versión de un tramo es la del último `[version]` del Log de
su change en o antes del `at` del registro que lo cierra, o `unknown`.

**Cifras.** Los tokens se suman por tipo, y su total es la suma de los cuatro.
El coste suma sólo diferencias de `cost_usd` comparables: las de un modelo con
precio en los dos extremos cuyo coste no baja. Los tokens de un modelo sin
precio, o cuyo precio aparece, desaparece o baja entre dos registros, se suman
aparte en `unpriced_tokens`, nunca como coste 0. Un change sin ningún tramo
atribuido — porque sus registros tienen todos `error` o porque su único
registro con datos es la base de su registrador — no está medido: no tiene fila
en la tabla, suma en `unmeasured` y, con `<id>`, sus cifras son `null`.

**Salida.**

- Sin argumentos: una tabla con una fila por change medido (id, título, total de
  tokens, coste y porcentaje de `rework`), seguida de los avisos.
- Con `<id>`: los tramos de ese change, con tokens, coste, modelos y versión.
- `--by segment|model|version|type|recorder`: agrega todos los changes medidos
  por esa clave.
- `--json`: el mismo contenido como
  `{ "schema": 1, "changes": [...], "groups": [...], "hints": [...] }`, con
  `groups` vacío sin `--by`.

**Avisos.** Son hechos sin umbrales, cada uno en una línea:

- `rework: <id> spent <pct>% of its tokens after a failed review or validation`,
  siempre que el rework tenga tokens; un porcentaje que redondea a 0 se escribe
  `<0.1`
- `unpriced: <modelo> has <n> tokens without a comparable price`
- `anomaly: session <sesión> decreased between <at1> and <at2>; counted as 0`
- `baseline: first record of <registrador> at <at> is not attributed`
- `unmeasured: <n> change(s) have no usage records`
- `failed: <n> record(s) of <id> have no data`
- `gap: <n> transition(s) between <at1> and <at2> have no usage record; their
  consumption is in <id> <tramo>`, cuando entre el registro base de un
  registrador y el que cierra el tramo hay transiciones del Log (`[status]`,
  `[review]`, `[validation]` o la creación) de cualquier change sin ningún
  registro en su mismo `change` y `at`

**Viewer.** Los módulos que sirve `SHARED_MODULES` dejan de arrastrar IO: la
validación de versiones que usa `src/lifecycle.mjs` pasa a un módulo puro
servido también al navegador, de modo que cada import relativo de un módulo
compartido es a su vez compartido y ninguno importa `node:*`. El panel de
`changeledger analyze` en el viewer sigue siendo del change `20261002-140242`.

**Contrato y documentación.** «Operational discovery» de
`templates/contract/core.md` nombra `changeledger analyze` como la consulta del
consumo, dentro de su presupuesto; `docs/usage-capture.md` y `README.md`
describen el comando y la resta contra los últimos valores vistos.

Alternativas descartadas: umbrales configurables, que serían opinión antes que
dato; atribuir por ventanas de tiempo del Log, que es ambiguo cuando hay varios
changes activos (cada registro ya nombra su change y su transición); y calcular
en el viewer sin módulo común, que duplicaría la lógica.

## Specification

### CR1 — El consumo se atribuye al tramo que cierra cada transición
- **Given** un registrador `ana` con registros del change `A` cuya sesión `s1` acumula 100, 300, 350 y 1000 tokens totales en `created`, `draft → approved`, `approved → in-progress` e `in-progress → in-review`
- **When** se ejecuta `changeledger analyze A --json`
- **Then** los tramos de `A` son `draft` 200, `approved` 50 e `in-progress` 650 tokens totales
- **And** `hints` contiene `baseline: first record of ana at <at del primer registro> is not attributed`

### CR2 — La conversación previa a crear un change es su tramo pre-draft
- **Given** el escenario de CR1 seguido de un registro `created` del change `B` en el que `s1` acumula 1200
- **When** se ejecuta `changeledger analyze B --json`
- **Then** `B` tiene un tramo `pre-draft` de 200 tokens totales y `A` no cambia

### CR3 — El trabajo tras una revisión o validación fallida es rework
- **Given** un change cuyo Log tiene `[review] in-review → in-progress (retry)` y registros que cierran después un tramo `in-progress` de 300 tokens, sobre 1000 tokens totales del change
- **When** se ejecuta `changeledger analyze --json`
- **Then** ese tramo se llama `rework` y no `in-progress`
- **And** `hints` contiene `rework: <id> spent 30% of its tokens after a failed review or validation`
- **And** tras `[review] in-review → blocked` y `[status] blocked → in-progress`, el tramo `in-progress` cerrado después también se llama `rework`
- **And** con un tramo `rework` de 4 tokens sobre 100004, `hints` contiene `rework: <id> spent <0.1% of its tokens after a failed review or validation`

### CR4 — Cada registrador se resta contra sí mismo
- **Given** registros de `ana` y de `luis` del mismo change, ambos con una sesión llamada `s1` y acumulados distintos
- **When** se ejecuta `changeledger analyze <id> --json`
- **Then** cada diferencia se calcula sólo contra el registro anterior del mismo registrador, y los tramos suman las diferencias de ambos

### CR5 — El coste nunca inventa un cero
- **Given** un tramo con un modelo de `cost_usd` 1.5 de diferencia y otro modelo con `cost_usd: null` y 400 tokens de diferencia
- **When** se ejecuta `changeledger analyze <id> --json`
- **Then** el tramo tiene `cost_usd` 1.5 y `unpriced_tokens` 400
- **And** `hints` contiene `unpriced: <modelo> has 400 tokens without a comparable price`
- **And** un modelo cuyo `cost_usd` acumulado baja, o cuyo precio aparece o desaparece entre dos registros, lleva sus tokens del tramo a `unpriced_tokens` con el mismo aviso

### CR6 — Una sesión que decrece cuenta cero y se avisa
- **Given** una sesión `s9` con 500 tokens en un registro y 450 en el siguiente del mismo registrador
- **When** se ejecuta `changeledger analyze --json`
- **Then** el tramo recibe 0 tokens de `s9` y `hints` contiene `anomaly: session s9 decreased between <at1> and <at2>; counted as 0`

### CR7 — Cada tramo lleva la versión de ChangeLedger de su momento
- **Given** un change cuyo Log tiene `[version] 0.18.0` antes de su primer registro y `[version] 0.18.0 → 0.18.1` antes de su tercer registro, y otro change sin líneas `[version]`
- **When** se ejecuta `changeledger analyze --by version --json`
- **Then** los tramos cerrados por el segundo registro van a `0.18.0`, los cerrados por el tercero y siguientes a `0.18.1`, y los del otro change a `unknown`

### CR8 — Las vistas del comando y sus errores
- **Given** un ledger con registros de dos changes
- **When** se ejecutan `changeledger analyze`, `changeledger analyze <id>`, `changeledger analyze --by model`, `changeledger analyze --json` y `changeledger analyze --by foo`
- **Then** los cuatro primeros terminan con código cero: la tabla tiene una fila por change medido, la vista de `<id>` lista sus tramos, `--by model` agrupa por modelo y `--json` produce un objeto con `schema: 1` y las claves `changes`, `groups` y `hints`
- **And** `--by foo` termina con código distinto de cero con el error de valores permitidos de commander, que nombra `segment, model, version, type, recorder`, y `changeledger analyze <id inexistente>` termina con código distinto de cero

### CR9 — Sin registros no hay error
- **Given** un ledger con tres changes y ningún registro de consumo
- **When** se ejecuta `changeledger analyze`
- **Then** termina con código cero, imprime `no usage records` y el aviso `unmeasured: 3 change(s) have no usage records`

### CR10 — El análisis es puro y determinista
- **Given** el módulo `src/usage-analysis.mjs`
- **When** se analiza dos veces la misma entrada, en distinto orden de registros
- **Then** ambas salidas son idénticas
- **And** el módulo no importa `node:fs`, `node:child_process`, `node:path` ni `node:os`, ni directa ni transitivamente, y se puede importar sin efectos

### CR11 — El primer uso real
- **Given** este repo con registros reales en el ledger de este change desde `approved → in-progress` hasta su entrada en `in-review`, y los del change de prueba `20261002-155917` desde `created` (el colector estuvo apagado cuando se creó este change)
- **When** un agente ejecuta `changeledger analyze --json` y `changeledger analyze <id>`
- **Then** obtiene los tramos de ese change con tokens, coste y versión sin leer ningún archivo de registro
- **And** el tramo `approved` de este change lleva el aviso `gap` por las transiciones de otros changes que no dejaron registro mientras el colector estaba apagado

### CR12 — Una sesión que falta en un registro se resta contra sus últimos valores
- **Given** un registrador cuya sesión `s2` acumula 50 tokens en un registro, falta en el siguiente y acumula 80 en el tercero
- **When** se ejecuta `changeledger analyze <id> --json`
- **Then** el tramo que cierra el tercer registro recibe 30 tokens de `s2`, no 80

### CR13 — Un registro sin datos se avisa y nunca cuenta como cero
- **Given** un change `A` cuyo registro `created` tiene `error` y otro change `C` cuyos dos registros tienen `error`, entre registros con datos del mismo registrador
- **When** se ejecuta `changeledger analyze --json`
- **Then** el registro con `error` no es base ni cierra tramo, y su consumo cae en el siguiente registro con datos del registrador
- **And** `hints` contiene `failed: 1 record(s) of A have no data` y `failed: 2 record(s) of C have no data`
- **And** `C` no aparece en `changes` ni en la tabla, y cuenta en `unmeasured`
- **And** un change cuyo único registro con datos es la base de su registrador tampoco aparece y cuenta en `unmeasured`, y `analyze <id>` de cualquiera de los dos muestra cifras `null` sin afirmar que no tiene registros

### CR14 — Un tramo que absorbe transiciones sin registro se avisa
- **Given** dos registros consecutivos de un registrador y, entre sus `at`, dos transiciones del Log de otro change sin registro
- **When** se ejecuta `changeledger analyze --json`
- **Then** `hints` contiene `gap: 2 transition(s) between <at1> and <at2> have no usage record; their consumption is in <id> <tramo>`
- **And** sin transiciones intermedias sin registro no hay aviso `gap`

### CR15 — Dos transiciones del mismo change en el mismo instante siguen su cadena
- **Given** un change con registros `draft → approved` y `approved → in-progress` del mismo registrador y el mismo `at`, con nombres de archivo en cualquier orden de sufijo
- **When** se ejecuta `changeledger analyze <id> --json`
- **Then** el consumo entre el registro anterior y ese instante va al tramo `draft`, y el tramo `approved` recibe 0, sea cual sea el sufijo

### CR16 — El viewer carga los módulos compartidos
- **Given** el viewer en marcha con `changeledger view .`
- **When** se pide `/shared/<módulo>` de cada módulo de `SHARED_MODULES` y de cada import relativo que contienen, recursivamente
- **Then** todos responden 200 y ninguno importa `node:*`

### CR17 — El contrato y la documentación nombran `analyze`
- **Given** `changeledger context`, `docs/usage-capture.md` y `README.md`
- **When** un agente busca cómo consultar el consumo
- **Then** «Operational discovery» del contexto core nombra `changeledger analyze` como la consulta del consumo, y la documentación describe el comando sin remitir a un analizador futuro
- **And** `changeledger context` sigue dentro de su presupuesto de `templates/contract/budgets.yml`

## Plan

- [x] Escribir pruebas fallidas del módulo: atribución, pre-draft, rework, registradores, coste, anomalías, versión y determinismo
  - **Target:** `test/usage-analysis.test.mjs`
  - **Verify:** `node --test test/usage-analysis.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR10
  - **Resolved:** `2026-10-07T11:23:16Z`
- [x] Implementar el módulo puro de análisis
  - **Target:** `src/usage-analysis.mjs`
  - **Verify:** `node --test test/usage-analysis.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR10
  - **Resolved:** `2026-10-07T11:23:16Z`
- [x] Probar e implementar el comando `analyze` con texto, JSON y agrupaciones
  - **Target:** `src/commands/analyze.mjs, bin/changeledger.mjs, test/analyze.test.mjs`
  - **Verify:** `node --test test/analyze.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR8, CR9
  - **Resolved:** `2026-10-07T11:23:17Z`
- [x] Recorrer el primer uso real sobre registros de este repo
  - **Target:** `src/commands/analyze.mjs`
  - **Verify:** verify: manual — `changeledger analyze --json` y `changeledger analyze <id>` sobre registros reales
  - **Criteria:** CR11
  - **Resolved:** `2026-10-07T11:23:32Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-07T11:23:17Z`
- [x] Probar y corregir la atribución tras la revisión: base por últimos valores, registros con error, avisos gap, failed, unpriced y rework, y empate en el mismo instante
  - **Target:** `src/usage-analysis.mjs, src/commands/analyze.mjs, test/usage-analysis.test.mjs, test/analyze.test.mjs`
  - **Verify:** `node --test test/usage-analysis.test.mjs test/analyze.test.mjs`
  - **Criteria:** CR3, CR5, CR10, CR12, CR13, CR14, CR15
  - **Resolved:** `2026-10-07T12:15:10Z`
- [x] Probar y reparar la carga de módulos compartidos del viewer
  - **Target:** `src/lifecycle.mjs, src/version-guard.mjs, src/viewer/server/router.mjs, test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/lifecycle.test.mjs`
  - **Criteria:** CR10, CR16
  - **Resolved:** `2026-10-07T12:12:08Z`
- [x] Nombrar `analyze` en el contrato y la documentación
  - **Target:** `templates/contract/core.md, docs/usage-capture.md, README.md`
  - **Verify:** `pnpm test`
  - **Criteria:** CR17
  - **Resolved:** `2026-10-07T12:15:11Z`
- [x] Recorrer de nuevo el primer uso real con los avisos nuevos
  - **Target:** `src/commands/analyze.mjs`
  - **Verify:** verify: manual — `changeledger analyze --json` y `changeledger analyze 20261002-140038` sobre registros reales
  - **Criteria:** CR11
  - **Resolved:** `2026-10-07T12:15:11Z`
- [x] Ejecutar el gate completo tras la ampliación
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-07T12:16:19Z`

## Log
- **2026-10-02T15:24:42Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T11:08:15Z** `[version]` 0.18.0-dev
- **2026-10-07T11:08:15Z** `[status]` approved → in-progress
- **2026-10-07T11:08:15Z** `[branch]` set: feature/20261002-140038 (auto)
- **2026-10-07T11:23:18Z** `[note]` Implementación delegada (subagente, top tier), tareas 1, 2, 3 y 5; pnpm verify en verde con 1722/1722 tests y repetido por el orquestador. Decisiones no especificadas: los registros con error se saltan sin aviso y no son base, pero cuentan como medidos; una sesión ausente que vuelve se resta contra sus últimos valores vistos; decrece = cualquier campo de token de un modelo ya visto baja, y entonces toda la sesión cuenta 0 y sus valores pasan a ser la base; el coste de una pieza sólo se conoce si ambos extremos tienen precio y no baja, si no sus tokens van a unpriced_tokens; rework = tramo in-progress cerrado en o después del primer fallo de review o validation, por tiempo; orden total por (at, change, nombre, JSON) y en un mismo instante el diff va al change de id menor; recorded_by nulo → unknown, from nulo → tramo unknown; con id, avisos acotados a ese change y sin unmeasured; grupos ordenados por tokens desc. Residuos: lifecycle.mjs importa version-guard.mjs → config.mjs → node:fs desde b97b083 (20261001-155216) y SHARED_MODULES no sirve version-guard.mjs, así que el panel de métricas del viewer no puede cargar /shared/metrics.mjs (deducido del código, sin ejecutar), lo que también afecta a 20261002-140242; README no documenta analyze; sin test CLI de analyze en el layout activado; fuga de /tmp de la suite existente sigue abierta.
- **2026-10-07T11:23:33Z** `[note]` CR11 recorrido por el orquestador sobre registros reales del ledger, sin leer ningún archivo de registro: analyze --json devuelve schema 1 con changes, groups y hints; 20261002-155917 (created → approved → in-progress → discarded) da tramos draft 0, approved 0 e in-progress 2112309 tokens y $0.52, todos 0.18.0-dev; 20261002-140038 da un tramo approved de 43568878 tokens y $13.99 en 0.18.0-dev; analyze --by model agrupa claude-opus-5-5 y claude-sonnet-5-5. Ningún change llega aún con registros de created a in-review: el colector estuvo desactivado en este clon del 2026-10-02 al 2026-10-07 y se reactivó antes de iniciar este change, así que su tramo in-progress se comprueba tras la transición a in-review. Hallazgo: el tramo approved absorbe todo el consumo del hueco sin colector (incluido el trabajo de otros changes en esos días), porque la diferencia se calcula contra el último registro del mismo registrador; analyze no lo avisa.
- **2026-10-07T11:23:33Z** `[status]` in-progress → in-review
- **2026-10-07T11:23:45Z** `[note]` CR11 tras la transición a in-review: analyze 20261002-140038 lista el tramo in-progress con 9479096 tokens, $3.65, claude-opus-5-5 y 0.18.0-dev, cerrado en 2026-10-07T11:23:33Z.
- **2026-10-07T11:24:05Z** `[note]` Mandato del review: la superficie que el change gobierna — el rango dev..HEAD (a46f5eb) contra CR1-CR11 y el Plan, con las decisiones no especificadas del Log como puntos de escrutinio. Fuera del mandato: la pureza transitiva de lifecycle.mjs para el viewer (anterior, de 20261001-155216) y la fuga de /tmp de la suite.
- **2026-10-07T11:31:05Z** `[review]` in-review → blocked: F1: el código resta cada sesión contra sus últimos valores vistos y no contra el registro anterior del registrador, como dice la Proposal (una sesión que desaparece y vuelve con 50→80 cuenta 30, la Proposal manda 80); F2: los registros con error se saltan sin aviso, su consumo cae en el tramo siguiente y un change con sólo errores aparece medido con 0 tokens y $0.00, y la lista de avisos de la Proposal es cerrada. Ambos requieren decisión humana. Corregibles después en el alcance: F3 dos transiciones del mismo change en el mismo instante se desempatan por el sufijo aleatorio; F4 el aviso unpriced es falso cuando un modelo con precio se reprecia o pierde su precio; F5 el redondeo de rework_pct oculta el aviso rework; F6 docs/usage-capture.md aún remite a un analizador futuro y describe mal la resta.
- **2026-10-07T12:00:18Z** `[note]` Decisiones del humano tras el review fail --block (2026-10-07): F1, la resta contra los últimos valores vistos de cada sesión es la regla y la Proposal se corrige; F2, aviso nuevo failed y un change con sólo registros con error cuenta como no medido. Además autoriza ampliar el change con el aviso gap, la reparación de la carga de módulos compartidos del viewer (comprobada: /shared/version-guard.mjs responde 404) y nombrar analyze en el contrato. F3, F4, F5 y F6 se corrigen en el alcance. CR11 se reformula: este change no tiene registro created porque el colector estaba apagado al crearlo.
- **2026-10-07T12:00:19Z** `[status]` blocked → in-progress
- **2026-10-07T12:12:08Z** `[note]` Tarea 7 (subagente, tier medio): los helpers SemVer puros pasan a src/cli-version.mjs, sin imports; version-guard.mjs los reexporta y lifecycle.mjs los importa de ahí; SHARED_MODULES sirve cli-version.mjs y se exporta para que el test de CR16 recorra el conjunto real. Red: /shared/version-guard.mjs must be served (404 !== 200). Mutantes: quitar cli-version de SHARED_MODULES, volver a importar version-guard desde lifecycle, node:fs en cli-version e import de un módulo no compartido; los cuatro fallan. El orquestador cargó /shared/metrics.mjs en el navegador del preview: el import resuelve y exporta computeMetrics. Observación fuera de alcance: el viewer global sin proyectos registrados lanza Cannot read properties of null (reading 'changes') al abrir Metrics.
- **2026-10-07T12:15:11Z** `[note]` Tareas 6 y 8 (subagente, top tier). Red→green de CR3 (<0.1), CR5 (without a comparable price, precio que aparece, desaparece o baja), CR10 (orden de contenido, nombre de archivo y pureza transitiva), CR12, CR13 (failed, cambio sólo con errores no medido y, con id, cifras null con no usage data o no usage records), CR14 (gap, extremos estrictos) y CR15 (cadena de transiciones). Mutantes: gap apagado, failed apagado, cadena apagada, <0.1 apagado, umbral de rework devuelto a rework_pct > 0, cambio sólo con errores contado como medido, gap con extremo inclusivo, base reiniciada al registro anterior, creación no contada como transición y cifras null desactivadas; todos fallan. El 'created primero' de la cadena es equivalente al orden por contenido y no tiene mutante propio. core.md gana un punto en Operational discovery (229 líneas, 3069 tokens, dentro de 400/4000); docs/usage-capture.md gana Analyzing records; README nombra analyze. Decisiones no especificadas: una transición cuenta como registrada si existe cualquier registro con su change y at, también con error; con id, failed se limita a ese change; records en JSON cuenta también los registros con error; rework_pct en JSON sigue siendo número y <0.1 sólo aparece en texto y avisos; orden de avisos rework, unpriced, anomaly, baseline, unmeasured, failed, gap. Residuos: un change cuyo único registro con datos es la base de un registrador aparece medido con 0 tokens y $0.00 y su vista dice no usage records; el trabajo tras review fail --block y blocked → in-progress no se llama rework porque la Proposal sólo nombra review y validation hacia in-progress.
- **2026-10-07T12:15:12Z** `[note]` CR11 recorrido de nuevo por el orquestador sobre registros reales: analyze 20261002-140038 lista approved 43568878 tokens $13.99, in-progress 9479096 $3.65, in-review 3330901 $1.31 y blocked 1411826 $0.63, todos 0.18.0-dev, con el aviso gap: 14 transition(s) between 2026-10-02T16:00:09Z and 2026-10-07T11:08:15Z have no usage record; their consumption is in 20261002-140038 approved (el subagente recontó los 14 aparte: la creación de 20261002-161641 y 13 transiciones de 20261002-133728).
- **2026-10-07T12:16:20Z** `[status]` in-progress → in-review
- **2026-10-07T12:16:24Z** `[note]` Mandato del segundo review (ronda 2 del change): la superficie que el change gobierna — dev..HEAD (a46f5eb, 011033a, 93c9d4f, 5602ddd) contra CR1-CR17 y el Plan, con el foco en que F1-F6 queden resueltos según las decisiones del humano y en las decisiones no especificadas y residuos del Log como puntos de escrutinio. Fuera del mandato: la fuga de /tmp de la suite y el error del viewer global sin proyectos.
- **2026-10-07T12:25:16Z** `[review]` in-review → in-progress (retry): Ronda 2: F1-F6 resueltos y CR1-CR17 pasan, pero D1 docs/usage-capture.md y el comentario de usage-analysis.mjs definen rework como el tramo cerrado tras cualquier review o validation fallida, y el ledger real lo desmiente (fail --block → blocked → in-progress sale como in-progress); D2 analyze <id> imprime no usage records para un change cuyo único registro es la base, y la vista sin id lo imprime cuando todos los registros fallaron; D3 el comentario dice que check reporta un registro mal formado, pero check no valida at y uno sin at se descarta en silencio; D4 el test de determinismo dice cubrir todos los escenarios y omite anomaly, CR12, <0.1, precio que aparece o desaparece y el change sólo con errores; D4b el doc afirma que el consumo de las transiciones de gap está dentro del tramo, falso si las hizo otro registrador.
- **2026-10-07T12:27:47Z** `[note]` Decisiones del humano tras el review fail --retry de la ronda 2 (2026-10-07): el trabajo tras una review o validation fallida que pasa por blocked también es rework; un change cuyo único registro con datos es la base de su registrador no está medido; autoriza la tercera ronda con un revisor nuevo, limitada a confirmar D1-D4b y estas dos decisiones.
- **2026-10-07T12:33:56Z** `[note]` Corrección de la ronda 2 (subagente corrector, sin commitear): D1 rework = tramo in-progress cerrado en o después del primer [review] in-review → in-progress|blocked o [validation] in-validation → in-progress del change (el lifecycle no tiene in-validation → blocked), y el ledger real pasa a dar rework 17%; D2 medido = al menos un tramo atribuido, de modo que un change sólo con la base o sólo con errores no tiene fila, cuenta en unmeasured y con id da cifras null; las vistas vacías dicen no usage data cuando hay registros y no usage records sólo cuando no hay ninguno; los avisos baseline, anomaly y failed cubren todos los changes sin id; D3 el comentario dice que check no reporta un at ausente; D4 everything() incluye anomaly, CR12, <0.1, precio que aparece y desaparece, un change sólo base y uno sólo con errores, y el comentario dice que no cubre el caso sin gap de CR14; D4b el doc separa el consumo del registrador del tramo del de otros registradores. Red→green con literales y mutantes MD1a, MD1b, MD2a, MD2b, MD2c. Gate: pnpm verify en verde con 1742/1742. Residuos: el texto del aviso unmeasured, fijado por la Proposal, sigue diciendo have no usage records para changes que tienen registros sin tramo atribuido; registros con at no string se descartan sin aviso y check no los reporta.
- **2026-10-07T12:33:56Z** `[status]` in-progress → in-review
- **2026-10-07T12:34:01Z** `[note]` Mandato de la ronda 3 (autorizada por el humano, revisor nuevo): confirmación del diff sin commitear frente a HEAD 5602ddd, limitada a que D1, D2, D3, D4 y D4b queden cerrados, a las dos decisiones del humano (rework tras blocked y change sólo con base no medido) y a cualquier regresión que introduzca; la prosa anterior que no cambió y el texto del aviso unmeasured fijado por la Proposal quedan como seguimientos, no como motivo de fallo.
- **2026-10-07T12:39:02Z** `[review]` in-review → in-progress (retry): Ronda 3: D1, D2, D3, D4b y las dos decisiones del humano cerrados, sin regresiones; D4 sigue abierto: el comentario reescrito de test/usage-analysis.test.mjs (~890) dice cubrir CR1-CR7 y CR12-CR15 salvo el caso sin gap de CR14, pero la mezcla everything() no tiene líneas [version] (CR7, --by version da sólo unknown) ni un review in-review → blocked → in-progress (la cláusula de CR3 que añade la corrección).
