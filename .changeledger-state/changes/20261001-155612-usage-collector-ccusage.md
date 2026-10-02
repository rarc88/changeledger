---
id: "20261001-155612"
title: Registrar el consumo de tokens y su coste en cada transición con ccusage
type: feature
status: in-progress
created: 2026-10-01T15:56:12Z
depends_on: []
branch: feature/20261001-155612
related_to: ["20261001-155216", "20260711-155721", "20260808-151640"]
owner: rarc88
release_impact: minor
---

## Request

Se quiere saber cuántos tokens consume cada change, en qué etapa y con qué
proveedor y modelo, para analizar si ChangeLedger ahorra o consume tokens y para
encontrar cuellos de botella. El agente no conoce su propio consumo, así que el
dato no puede salir de él: debe obtenerlo un componente mantenido por terceros
que lea los logs de los harness, para que ChangeLedger no dé soporte a cada
harness ni mantenga tablas de precios. La herramienta elegida es `ccusage`, y el
disparador son los propios comandos de ChangeLedger, sin hooks por harness.

El coste se congela en el momento de la captura, porque el precio de un modelo
cambia con el tiempo; se usan los precios de la API aunque el humano trabaje con
suscripción. Los harness cuyas sesiones no indican el proyecto quedan fuera, con
aviso. La captura es opcional, nunca bloquea una transición y funciona igual con
la ref de estado y en el layout legacy. Cada clon la activa con la configuración
de git, no con `config.yml`, porque mide la máquina local. Los registros se
guardan localmente en el directorio común de git, fuera del ledger.

Quedan fuera de este change: el analizador y cualquier vista de los datos, la
sincronización de los registros entre máquinas o su paso a la ref de estado
(ampliaría `global-state-scope` y sería un change propio), el desglose por rol
de orquestador o subagente más allá del modelo, otros colectores distintos de
`ccusage`, la activación desde el viewer o desde `config.yml` y la versión de ChangeLedger
de cada registro, que se obtiene cruzando su instante con las líneas `[version]`
del change `20261001-155216`.

## Investigation

No existe ningún registro de tokens, proveedor, modelo ni coste. Las métricas
actuales (change `20260711-155721`, `src/metrics.mjs`) sólo derivan tiempos y
reintentos del Log.

`ccusage` 20.0.26 (MIT, binarios nativos para Linux, macOS y Windows en x64 y
arm64) se ejecutó contra esta máquina. Hechos medidos:

- `ccusage claude session --json --offline` sale con código 0 y escribe JSON
  puro con las claves `sessions` y `totals`. Cada sesión trae `sessionId`,
  `projectPath`, `firstActivity`, `lastActivity`, `inputTokens`,
  `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `totalCost`,
  `modelsUsed` y `modelBreakdowns` (`modelName`, `inputTokens`, `outputTokens`,
  `cacheCreationTokens`, `cacheReadTokens`, `cost`). Los totales son
  acumulados por sesión e incluyen a sus subagentes: esta conversación aparece
  con `claude-opus-5-5` y el `claude-sonnet-5-5` del subagente.
- `totals.unpricedModels` lista los modelos sin precio en la tabla offline; aquí
  `["claude-sonnet-5-5"]`, cuyo coste no se suma.
- `ccusage session --json` (todas las fuentes) trae `agent` por sesión, pero ni
  `projectPath` ni `sessionId`, y no acepta `--project`
  (`Unknown session option '--project'`). El filtrado por proyecto sólo es
  posible por fuente.
- Fuentes de `ccusage --help`: `claude codex opencode amp droid codebuff hermes
  pi goose kilo copilot gemini antigravity kimi qwen openclaw grok zcode`. Sin
  datos, `codex|opencode|gemini session --json --offline` salen con código 0 y
  `sessions: []`; Codex nombra su coste `costUSD`. No se pudo comprobar si las
  fuentes distintas de `claude` traen `projectPath`.
- Cada llamada tardó 0,12–0,14 s con 75 sesiones. `ccusage` no está en el PATH;
  `npx`/`pnpm dlx` lo ejecutan sin tocar `package.json`.
- `projectPath` es el nombre del directorio de Claude Code: la ruta con cada
  carácter no alfanumérico sustituido por `-` (observado `/`, `.` y `_`). Es
  ambiguo por prefijo: `-home-rarc88-repositories-nexo` y
  `-home-rarc88-repositories-nexo-data-brain-sandbox` coexisten en esta máquina,
  así que la comparación debe ser de igualdad. Un worktree de git del mismo repo
  tiene otra ruta y otro `projectPath`.

ChangeLedger no tiene un punto único de transición: `status`, `approve`,
`review`, `validation`, `reopen` y `discard` viven en `src/commands/agent.mjs`;
el viewer los reutiliza desde `changeStatusImpl` (`src/viewer/domain.mjs`);
`apply` aplica eventos `status` con `statusMutation` y escribe todo en un
`writeLedgerFiles`; la creación es `newChangeFrom`/scaffold en
`src/commands/new.mjs`. Sólo `status` y `apply` tienen hoy un canal de avisos; los
demás devuelven sólo el archivo. Los procesos se lanzan con `execFileSync` en
`src/git.mjs`, sin `timeout`; los tests inyectan dependencias y no simulan
`child_process`.

Almacenamiento: el árbol de la ref de estado es exclusivo (`statePathIsValid` en
`src/state-store.mjs` sólo acepta manifest, config, changes, specs y releases) y
`global-state-scope` prohíbe ampliarlo sin un change propio. El humano eligió
guardar en `<git-common-dir>/changeledger/usage/`: existe en ambos layouts, es
común a todos los worktrees de un repo, git nunca lo versiona y ningún comando
del ledger (`check`, `cutover`, `import`, `sync`, `commit`) lo lee.

Activación: en un repo activado la configuración efectiva es la de la ref de
estado, y hoy sólo cambia con `config migrate` o con la lista cerrada de claves
que edita el viewer; editar `.changeledger/config.yml` en el worktree no tiene
efecto. Una clave en `config.yml` no podría activarse aquí sin ampliar esas
rutas. El humano eligió (2026-10-02) la configuración de git:
`git config --get changeledger.usage.collector` resuelve los ámbitos local,
global y de sistema, no se versiona, y los worktrees comparten la configuración
local del repo. Encaja con que los registros vivan en el directorio común de git
y con que `ccusage` lea los logs de la máquina.

Interfaces externas: la salida JSON de `ccusage` se considera estable sólo para
la versión fijada 20.0.26 y se verifica con fixtures capturadas de su salida
real; la codificación de `projectPath` no está documentada y no es estable, y
una discrepancia sólo produce cero sesiones con aviso; los precios online de
LiteLLM dependen de la red y no son estables, por lo que tienen respaldo offline.

## Proposal

El valor `ccusage` en `git config changeledger.usage.collector` activa la captura
en ese clon. Con él, tras
escribir con éxito cada evento de transición (`[status]`, `[review]`,
`[validation]`) y tras crear un change, ChangeLedger toma una foto del consumo
acumulado de las sesiones de este repo y la guarda en un archivo JSON propio.
El consumo de un tramo es la diferencia entre dos fotos consecutivas; ese
cálculo pertenece al analizador futuro.

La foto se compone así, siempre con `npx --yes ccusage@20.0.26` y un límite de
10 s por llamada:

1. `session --json --offline --no-cost` sin fuente, para saber qué fuentes
   (`agent`) tienen sesiones en la máquina.
2. Por cada una, `<fuente> session --json`, con precios online; si falla, se
   repite con `--offline` y se avisa.
3. Se conservan las sesiones cuyo `projectPath` es igual a la codificación de la
   raíz del repo o de alguno de sus worktrees (`git worktree list --porcelain`).
   Las fuentes con sesiones sin `projectPath` se registran como excluidas.
4. Un modelo listado en `unpricedModels` se registra con coste `null`, nunca `0`.

El registro (`schema: 1`) vive en
`<git-common-dir>/changeledger/usage/<id>/<instante>-<n>.json`, donde
`<instante>` es el del evento en forma `YYYYMMDDTHHMMSSZ` y `<n>` empieza en 1
y crece si el nombre existe:

```json
{
  "schema": 1,
  "change": "<id>",
  "at": "<instante ISO del evento>",
  "event": "created | status | review | validation",
  "from": "<estado o null>",
  "to": "<estado>",
  "collector": { "name": "ccusage", "version": "20.0.26", "pricing": "online | offline" },
  "sessions": [
    {
      "source": "claude",
      "session_id": "<sessionId>",
      "project_path": "<projectPath>",
      "first_activity": "<ISO>",
      "last_activity": "<ISO>",
      "models": [
        {
          "model": "<modelName>",
          "input_tokens": 0,
          "output_tokens": 0,
          "cache_read_tokens": 0,
          "cache_write_tokens": 0,
          "cost_usd": 0.0
        }
      ]
    }
  ],
  "excluded": [{ "source": "<fuente>", "sessions": 0 }],
  "error": null
}
```

Cualquier fallo (`npx` ausente, límite de tiempo, código distinto de cero en
ambos intentos, JSON inválido) deja un registro con `error` y `sessions: []`, de
modo que el hueco sea visible, y un aviso; la transición ya escrita no cambia ni
su código de salida. Los avisos van a stderr con el prefijo `usage: `.

Limitación aceptada: `ccusage` recalcula el coste acumulado de una sesión con
los precios vigentes en cada foto. Si un precio cambia durante la vida de una
sesión, la diferencia de coste entre dos fotos mezcla tablas; ambas fotos
conservan sus valores, así que el analizador puede detectarlo.

Alternativas descartadas: hooks por harness (soporte que mantener por cada
uno); leer las transcripciones propias de cada harness (formatos y precios que
mantener); el autorreporte del agente (no conoce su consumo); una foto global
sin filtrar por proyecto (mezcla otros repos activos); guardar en el documento
(entra en cada contexto) o en la ref de estado (amplía `global-state-scope`).

## Specification

### CR1 — Sin la clave no cambia nada
- **Given** un repo donde `git config --get changeledger.usage.collector` no devuelve valor y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** no se lanza ningún proceso `npx` ni `ccusage`, no existe `<git-common-dir>/changeledger/usage/` y la salida es la de hoy

### CR2 — Un colector desconocido es un error de configuración
- **Given** un repo con `git config changeledger.usage.collector other`
- **When** se ejecuta `changeledger check`
- **Then** termina con código distinto de cero y muestra `git config "changeledger.usage.collector" must be "ccusage"`
- **And** con el valor `ccusage` ese error no aparece
- **And** una clave `usage` en `config.yml`, sin el valor en git config, no activa la captura ni es validada

### CR3 — Una transición deja una foto completa
- **Given** `changeledger.usage.collector=ccusage` en git config, un `ccusage` simulado cuya salida de `claude session --json` es la fixture capturada con una sesión cuyo `projectPath` codifica la raíz del repo y dos modelos, y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** existe exactamente un archivo `<git-common-dir>/changeledger/usage/<id>/<instante>-1.json` cuyo `at` es el instante de la línea `[status]` `approved → in-progress`, con `schema: 1`, `event: "status"`, `from: "approved"`, `to: "in-progress"`, `collector` `{ "name": "ccusage", "version": "20.0.26", "pricing": "online" }`, `excluded: []`, `error: null`
- **And** su única sesión tiene `source: "claude"` y, por modelo, los tokens y el coste de `modelBreakdowns` con los nombres del registro, y el comando termina con código cero

### CR4 — Toda transición y la creación fotografían; el resto de comandos no
- **Given** `changeledger.usage.collector=ccusage` en git config, el `ccusage` simulado de CR3, un repo inactivo y uno activado
- **When** se ejecutan `changeledger new`, `approve`, `status`, `review`, `validation`, `reopen` y `discard`, una transición desde el viewer y un evento `status` de `changeledger apply`, y después `log`, `task`, `owner`, `branch`, `archive`, `graduate`, `edit` y `fix`
- **Then** cada uno del primer grupo deja exactamente un registro por evento de transición escrito, con `event: "created"` y `from: null` para `new`
- **And** ningún comando del segundo grupo deja un registro

### CR5 — Sólo cuentan las sesiones de este repo y de sus worktrees
- **Given** el `ccusage` simulado devuelve sesiones con `projectPath` igual a la codificación de la raíz, igual a la de un worktree del repo, igual a la de la raíz con el sufijo `-foo` y la de otro repo
- **When** se toma una foto
- **Then** el registro contiene sólo las dos primeras, siendo la codificación la ruta con cada carácter no alfanumérico sustituido por `-`
- **And** si ninguna sesión coincide, `sessions` es `[]` y stderr muestra `usage: no sessions matched this repository`

### CR6 — Las fuentes sin projectPath quedan fuera con aviso
- **Given** el listado sin fuente devuelve sesiones de `claude` y `gemini`, y `gemini session --json` devuelve dos sesiones sin `projectPath`
- **When** se toma una foto
- **Then** el registro contiene `excluded: [{ "source": "gemini", "sessions": 2 }]` y ninguna sesión de `gemini`
- **And** stderr muestra `usage: excluded gemini (2 sessions without projectPath)`

### CR7 — El coste se congela con respaldo offline y nunca inventa un cero
- **Given** el `ccusage` simulado sale con código distinto de cero sin `--offline` y con la fixture con `--offline`, y `totals.unpricedModels` contiene `claude-sonnet-5-5`
- **When** se toma una foto
- **Then** el registro tiene `collector.pricing: "offline"` y el modelo `claude-sonnet-5-5` tiene `cost_usd: null`
- **And** stderr muestra `usage: online pricing unavailable; used ccusage offline prices`

### CR8 — Un fallo del colector nunca bloquea la transición
- **Given** `changeledger.usage.collector=ccusage` en git config y, en cuatro casos, un `npx` ausente, un `ccusage` que supera los 10 s, uno que sale con código distinto de cero en ambos intentos y uno que escribe JSON inválido
- **When** se ejecuta `changeledger status <id> in-progress` en cada caso
- **Then** el comando termina con código cero y el Log contiene la transición
- **And** queda un registro con `sessions: []` y `error` no nulo, y stderr muestra una línea que empieza por `usage: snapshot failed: `

### CR9 — Los registros viven fuera del ledger en ambos layouts
- **Given** `changeledger.usage.collector=ccusage` en git config, un repo inactivo y uno activado con un worktree adicional
- **When** se ejecuta una transición desde la raíz y otra desde el worktree
- **Then** ambos registros están bajo el mismo `<git-common-dir>/changeledger/usage/` que devuelve `git rev-parse --git-common-dir`
- **And** `git status --porcelain` no los muestra, ningún commit de la ref de estado contiene una ruta `usage` y `changeledger check` termina con código cero

### CR10 — El primer uso real en este repo
- **Given** este repo con `git config changeledger.usage.collector ccusage`, el `ccusage` 20.0.26 real y un change de prueba
- **When** el humano lo crea, lo aprueba y lo lleva a `in-progress` desde una sesión de Claude Code abierta en el repo
- **Then** `<git-common-dir>/changeledger/usage/<id>/` contiene tres registros sin `error`, con la sesión actual en cada uno
- **And** los tokens de esa sesión no decrecen entre registros consecutivos, de modo que cada diferencia es el consumo del tramo

## Plan

- [x] Capturar fixtures reales de `ccusage` 20.0.26 y escribir pruebas fallidas del colector
  - **Target:** `test/usage-collector.test.mjs, test/fixtures/ccusage/`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR3, CR5, CR6, CR7, CR8
  - **Resolved:** `2026-10-01T17:21:50Z`
- [x] Implementar el colector: llamadas con límite, respaldo offline, filtro por proyecto y worktrees, mapeo y registro
  - **Target:** `src/usage-collector.mjs`
  - **Verify:** `node --test test/usage-collector.test.mjs`
  - **Criteria:** CR3, CR5, CR6, CR7, CR8
  - **Resolved:** `2026-10-01T17:21:51Z`
- [x] Probar y validar la clave `usage.collector`
  - **Target:** `src/config.mjs, src/check.mjs, test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-01T17:21:51Z`
- [x] Probar y conectar la foto tras cada transición y la creación, con canal de avisos, en ambos layouts
  - **Target:** `src/commands/agent.mjs, src/commands/new.mjs, src/commands/apply.mjs, src/viewer/domain.mjs, bin/changeledger.mjs, test/agent.test.mjs, test/apply.test.mjs, test/view.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs test/apply.test.mjs test/view.test.mjs`
  - **Criteria:** CR1, CR4, CR8, CR9
  - **Resolved:** `2026-10-01T17:21:52Z`
- [x] Documentar la clave en la plantilla de configuración y en la documentación
  - **Target:** `templates/config.yml, docs/`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Support:**
  - **Resolved:** `2026-10-01T17:21:52Z`
- [ ] Recorrer el primer uso real con `ccusage` 20.0.26 en este repo
  - **Target:** `src/usage-collector.mjs`
  - **Verify:** verify: manual — crear, aprobar e iniciar un change de prueba desde Claude Code y revisar los tres registros
  - **Criteria:** CR10
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-01T17:21:52Z`
- [x] Mover la activación a `git config changeledger.usage.collector`, retirar la clave de `config.yml` y su plantilla, y actualizar pruebas y documentación
  - **Target:** `src/config.mjs, src/check.mjs, src/usage-collector.mjs, templates/config.yml, docs/usage-capture.md, test/`
  - **Verify:** `node --test test/check.test.mjs test/usage-collector.test.mjs test/agent.test.mjs test/apply.test.mjs test/view.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR8, CR9
  - **Resolved:** `2026-10-02T13:21:14Z`
- [ ] Repetir el gate completo tras el cambio de activación
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-01T16:09:47Z** `[status]` draft → approved (human via conversation)
- **2026-10-01T16:56:41Z** `[status]` approved → in-progress
- **2026-10-01T16:56:41Z** `[branch]` set: feature/20261001-155612 (auto)
- **2026-10-01T17:21:53Z** `[note]` Implementación delegada (subagente, top tier), tareas 1-5 y 7. Hechos que difieren de la Investigation: el listado sin fuente nombra su arreglo session, no sessions, y en modo offline un modelo sin precio llega con cost 0 y missingPricing: true; ambos se tratan como sin precio. Decisiones no especificadas: (1) apply con target new también fotografía created; un dry-run o un apply neto vacío no; (2) una recolección por escritura, un registro por evento; (3) los avisos van por usage.warn a stderr, no a los arreglos de avisos de status o apply, y los del viewer al stderr del servidor; (4) un ledger fuera de git no escribe registro y avisa usage: snapshot failed: not a git repository, no usage record written; (5) una clave inválida en la transición omite la foto con usage: snapshot skipped: <error de config>; (6) usage: {} y collector: null cuentan como ausentes; (7) un registro de fallo lleva collector.pricing: null; (8) si alguna fuente cae a offline, pricing es offline y el aviso sale una vez; (9) se rechazan nombres de fuente fuera de /^[a-z][a-z0-9-]*$/; (10) la costura de tests CHANGELEDGER_USAGE_COMMAND (arreglo JSON) sustituye el prefijo npx; (11) --from usa el created del documento; (12) docs/usage-capture.md en inglés. Residuos: al vencer el límite sólo se mata npx y un ccusage hijo puede sobrevivir un momento; la ruta de Windows (shell: true para npx) no está probada; la suite tarda unos 11 s más por la prueba CLI real de 10 s. Smoke real con ccusage 20.0.26 sobre este repo: 2 llamadas de unos 0,75 s, pricing online, 3 sesiones del repo, sin error. Gate: pnpm verify en verde con 1564/1564 tests.
- **2026-10-02T13:11:07Z** `[note]` Enmienda autorizada por el humano (2026-10-02): en un repo activado no hay ruta soportada para activar una clave nueva de config.yml (sólo config migrate y la lista cerrada del viewer), así que la activación pasa a git config changeledger.usage.collector, local a cada clon. Cambian Request, Investigation, Proposal, CR1, CR2 y los Given de CR3, CR4, CR8, CR9 y CR10; se añaden las tareas 8 y 9. El humano autorizó también que el orquestador ejecute CR10: crear y aprobar en su nombre un change de prueba y descartarlo al terminar.
