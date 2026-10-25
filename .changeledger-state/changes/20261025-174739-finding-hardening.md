---
id: "20261025-174739"
title: "Un hallazgo mal formado se rechaza: sede única del id, check contra resoluciones huérfanas o duplicadas y resolución con el verbo delante"
type: change
status: in-progress
created: 2026-10-25T17:47:39Z
depends_on: []
branch: change/20261025-174739
related_to:
  - "20261024-202659"
  - "20261024-202718"
owner: raruiz-hiberuscom
---

## Request

El hijo `20261024-202659` dejó tres hallazgos abiertos sobre el propio
mecanismo que construyó, todos fuera de su frontera y todos pequeños: la forma
del id de change vive en dos sedes, `check` acepta resoluciones de hallazgo
que no apuntan a nada o apuntan dos veces, y la CLI lee como resolución un
texto sin comillas cuya segunda palabra es `promote` o `drop`. Este change los
cierra juntos porque comparten superficie —la gramática de `finding`, su
lectura y su comando— y una sola revisión los cubre.

### Objective

Un hallazgo mal formado se rechaza donde se escribe y donde se valida, y la
forma del id tiene una sede. Terminado significa que:

- la expresión del id de change (`YYYYMMDD-HHMMSS`) se declara una vez y la
  leen tanto `check` (`ID_FORM`) como la gramática de `finding`
  (`CHANGE_ID` en `src/lifecycle.mjs`), sin copia;
- `changeledger check` reporta como error, con número de línea, una
  resolución `[finding] <n> promoted|dropped` cuyo ordinal no corresponde a
  ningún hallazgo abierto registrado antes en ese Log —huérfana— o cuyo
  hallazgo ya estaba resuelto —duplicada—, y `list --pending findings` y
  `finding` siguen leyendo el Log con la misma regla que `check` aplica: una
  sola función de lectura compartida;
- la CLI distingue sin ambigüedad el texto de la resolución: un texto sin
  comillas como `3 drop tables` nunca descarta un hallazgo; la forma exacta la
  fija la decisión 1 y la aprueba el humano con este objetivo;
- los documentos archivados y descartados siguen congelados para `check`:
  la regla nueva sólo juzga documentos vivos, como el resto de errores;
- la ayuda de `finding`, `log --help` y el README dicen la forma nueva;
- tres hallazgos de código abiertos en otros changes, añadidos por decisión
  del humano el 2026-10-25, quedan cerrados: `hooks/no-ledger-refs.sh` exime
  `test/helpers/` y un fixture del ledger que necesita un id o un `CRn` se
  construye allí con un helper, no inline (`CONTRIBUTING.md` lo dice);
  `unrecordedTransitions` en `src/usage-analysis.mjs` deja de contar la línea
  `[validation] accepted (merged <sha>)` como transición sin registro, y
  `docs/usage-capture.md` lo refleja; y `listProjects` en `src/registry.mjs`
  devuelve los proyectos en un orden que no depende de la forma de la clave,
  para que el test del registro deje de fallar cuando `project_id` sale todo
  dígitos.

### Frontier

**Entra.** `hooks/no-ledger-refs.sh` y su test, `CONTRIBUTING.md`, `src/usage-analysis.mjs` (`unrecordedTransitions`) con `docs/usage-capture.md` y `test/usage-analysis.test.mjs`, `src/registry.mjs` (`listProjects`) con `test/registry.test.mjs`; `src/lifecycle.mjs` (la definición `finding`, `CHANGE_ID`), la
sede única del id (donde `check.mjs` y `lifecycle.mjs` puedan importarla sin
ciclo, por ejemplo `src/change.mjs` o `src/paths.mjs`), `src/check.mjs`
(`ID_FORM` y la validación del Log en `checkLifecycleSequence` o una función
hermana), `src/commands/agent.mjs` (`findingsInLog`, `recordFindingMutation`,
`resolveFindingMutation`, `openFindings`), `bin/changeledger.mjs` (el comando
`finding` y su ayuda), `README.md` y los tests de cada superficie:
`test/lifecycle.test.mjs`, `test/check.test.mjs`, `test/agent.test.mjs`,
`test/cli-bin.test.mjs`, `test/contract.test.mjs` donde pine la ayuda.

**Queda fuera.** El viewer; `apply`; convertir hallazgos históricos; el
resto de `analyze` y del hook; cualquier otro tipo de evento del Log.

**Pre-autorizado.** Mover `findingsInLog` a la sede que `check` y `agent`
compartan; reescribir los tests de `20261024-202659` que pinan la forma
antigua de la CLI, nombrándolos en el Log; enmendar la Specification en
`in-progress` cuando el código desmienta lo previsto, registrándolo. Si cambia
el objetivo o la frontera, se vuelve al humano.

### Decisiones de forma que el humano aprueba con el objetivo

1. **La resolución va con el verbo delante.** `changeledger finding <id>
   promote <n> <nuevo-id>` y `changeledger finding <id> drop <n> "<razón>"`;
   todo lo demás es el texto de un hallazgo nuevo. Un texto cuya primera
   palabra es `promote` o `drop` y cuya segunda no es un ordinal se registra
   como texto; si la segunda sí es un ordinal, se rechaza con un mensaje que
   nombra la ambigüedad y pide entrecomillar con otra primera palabra. Lee
   como una frase («promueve el 2 a X»), y la ambigüedad queda reducida a
   textos que empiezan por un verbo reservado seguido de un número, que el
   mensaje resuelve. Alternativa descartada: mantener `<n> promote|drop` y
   rechazar todo texto cuya segunda palabra sea un verbo, que convierte
   «3 drop tables» en un error en vez de en un hallazgo.
2. **Huérfanas y duplicadas son errores de `check`, no avisos.** Una
   resolución que no apunta a nada es un documento que miente sobre su
   estado; el error nombra línea, ordinal y causa:
   `Log line <n>: finding F<k> resolved but never recorded` y
   `Log line <n>: finding F<k> already resolved at line <m>`.
3. **`finding` y `list` no cambian de lectura: `check` adopta la suya.** La
   función que hoy numera y resuelve hallazgos en `agent.mjs` pasa a una sede
   que `check.mjs` importe; `check` recorre el Log con ella y reporta lo que
   la lectura descarta.

### Investigation

Leído en `dev` (`2f481a54`). `ID_FORM` (`src/check.mjs`) y `CHANGE_ID`
(`src/lifecycle.mjs`) son la misma expresión `^\d{8}-\d{6}$`; la primera la
usan el id del frontmatter, `parent` y el enlace de hijos; la segunda, el
brazo `promoted` de `finding`. `findingsInLog` (`src/commands/agent.mjs`)
numera los `open` por orden y acepta la primera resolución de cada ordinal,
ignorando en silencio una resolución sin hallazgo o posterior a otra;
`check` sólo exige que cada línea del Log parsee (`invalid typed event`) y
replay de `status`/`review`/`validation` en `checkLifecycleSequence`, así que
una línea `[finding] 9 dropped: x` sin F9 pasa. La CLI (`bin/changeledger.mjs`,
comando `finding`) despacha una resolución cuando `parts.length >= 2` y
`parts[1]` es `promote` o `drop`, y valida el ordinal después; `changeledger
finding X 3 drop tables` sin comillas descarta F3. Las pruebas que pinan esta
forma están en `test/agent.test.mjs` y `test/cli-bin.test.mjs` bajo los
criterios CR6, CR7 y CR14 de `20261024-202659`, y la ayuda en `README.md` y en
`test/contract.test.mjs`. Los documentos archivados y descartados los salta
`check` por `frozenReason`.

### Proposal

#### Solución elegida

Una constante exportada con la forma del id en una sede sin dependencias
(`src/change.mjs` ya es leída por `check.mjs` y `lifecycle.mjs` no la importa:
se comprueba el grafo antes de elegir; si hay ciclo, `src/paths.mjs`).
`findingsInLog` sale de `agent.mjs` a `src/lifecycle.mjs`, junto a la
gramática, y devuelve además las resoluciones descartadas con su línea y
causa; `agent.mjs` y `check.mjs` la importan. `check` añade una pasada del Log
que reporta cada descarte como error en documentos vivos. La CLI pasa al verbo
delante con el rechazo de la ambigüedad; los tests de la forma antigua se
reescriben; la ayuda y el README dicen la forma nueva.

#### Alternativas descartadas

- **Dejar las huérfanas como aviso.** Un aviso no bloquea y el documento
  sigue mintiendo sobre lo pendiente.
- **Numerar los hallazgos en el propio evento abierto.** Rompe «sin estado
  nuevo» y obliga a `check` a verificar la numeración.
- **Subcomandos `finding record|promote|drop`.** Tres comandos para una
  cosa; el verbo delante dentro del mismo comando basta.

#### Escenarios

- **El día después.** `changeledger finding X "falta la vista"`,
  `changeledger finding X promote 1 Y`, `changeledger finding X drop 2 "ya
  no aplica"`; `check` verde; un `[finding] 9 dropped: x` escrito a mano en
  un documento vivo sale como error con su línea.
- **Un texto que empieza por el verbo.** `changeledger finding X drop the
  cache` se registra como texto; `changeledger finding X drop 2 cache`
  (sin razón entrecomillada) descarta F2 con razón «cache», que es lo que
  dice la frase.

## Specification

Escrita en `in-progress` con el código delante (`dev` en `54e6d3df`). Sedes:
`parseFindingPayload`, `CHANGE_ID` y `LOG_EVENT_DEFINITIONS` en
`src/lifecycle.mjs`; `ID_FORM` y `checkLifecycleSequence` en `src/check.mjs`;
`findingsInLog`, `recordFindingMutation`, `resolveFindingMutation` y
`openFindings` en `src/commands/agent.mjs`; el comando `finding` en
`bin/changeledger.mjs`; `hooks/no-ledger-refs.sh`; `unrecordedTransitions`
en `src/usage-analysis.mjs`; `listProjects` en `src/registry.mjs`. Los
mensajes son literales. Ninguna línea añadida fuera de `.changeledger/` lleva
un id de change ni un criterio con dígitos: los tests que los necesitan los
construyen con el helper de CR4.

### CR1 — La forma del id tiene una sede
- **Given** `src/lifecycle.mjs` exporta `CHANGE_ID_FORM` (la expresión `^\d{8}-\d{6}$`)
- **When** se buscan `ID_FORM` y `CHANGE_ID` en `src/`
- **Then** no existen: `src/check.mjs` importa `CHANGE_ID_FORM` para el id del frontmatter, `parent` y el enlace de hijos, y `parseFindingPayload` la usa para el brazo `promoted`
- **And** los mensajes de `check` sobre la forma del id no cambian (`id not in YYYYMMDD-HHMMSS form: <id>`)

### CR2 — check rechaza una resolución huérfana o duplicada en un documento vivo
- **Given** `findingsInLog(logBody)` vive en `src/lifecycle.mjs`, exportada, y devuelve además las resoluciones que descarta, con el índice de su línea y la causa; `src/commands/agent.mjs` la importa
- **When** `changeledger check` lee un change vivo cuyo Log lleva `[finding] 9 dropped: x` sin `F9` registrado antes, y otro cuyo Log lleva dos resoluciones de `F1`
- **Then** reporta `Log line <n>: finding F9 resolved but never recorded` y `Log line <n>: finding F1 already resolved at line <m>`, con `<n>` y `<m>` como números de línea del documento, y sale 1
- **And** un documento archivado o descartado con las mismas líneas no produce error, como el resto de diagnósticos congelados por `frozenReason`
- **And** `list --pending findings` y `finding <id> promote|drop` siguen ignorando esas líneas, porque leen con la misma función

### CR3 — La resolución va con el verbo delante
- **Given** el comando `finding` de `bin/changeledger.mjs`
- **When** `changeledger finding X promote 2 Y`, `changeledger finding X drop 1 "ya no aplica"` y `changeledger finding X "3 drop tables"` (y la misma frase sin comillas)
- **Then** los dos primeros resuelven `F2` y `F1` con las líneas `[finding] 2 promoted #Y` y `[finding] 1 dropped: ya no aplica` y la salida `finding F2 on #X → promoted to #Y` / `finding F1 on #X → dropped`; los dos últimos registran un hallazgo abierto con el texto `3 drop tables`
- **And** `changeledger finding X promote 2` falla con `promote requires the id of the change it becomes`; `changeledger finding X drop 1` falla con `drop requires a reason`; `changeledger finding X promote abc Y` registra el texto `promote abc Y` como hallazgo abierto, porque la segunda palabra no es un ordinal; `changeledger finding X promote 0 Y` falla con `finding ordinal must be a positive integer (got "0")`
- **And** la ayuda de `finding` describe las tres formas con el verbo delante y la regla de desambiguación; `README.md` las dice; los mensajes de `resolveFindingMutation` sobre ordinales inexistentes o ya resueltos no cambian; los tests de `20261024-202659` que pinaban `<n> promote|drop` se reescriben y se nombran en el Log

### CR4 — Los fixtures del ledger viven en test/helpers, exentos del hook
- **Given** `hooks/no-ledger-refs.sh` exime las rutas bajo `test/helpers/` además de `.changeledger/`, `.changeledger-state/` y `templates/contract/spec.md`
- **When** se añade en un repo de pruebas una línea con un id en `test/helpers/fixtures.mjs` y otra en `test/x.test.mjs`
- **Then** la primera sale 0 y la segunda sale 1 nombrando fichero, línea y coincidencia
- **And** existe `test/helpers/ledger-fixtures.mjs` con `criterion(n)` → `CR<n>` y `changeId(date, time)` → `<date>-<time>`, y `test/no-ledger-refs.test.mjs` los usa en vez de su helper local; `CONTRIBUTING.md` dice que un fixture del ledger que necesita un id o un criterio se construye con esos helpers y que `test/helpers/` está exento

### CR5 — El sello de aceptación no cuenta como transición sin registro
- **Given** un change con registros de uso y un Log con `[validation] accepted (merged abc1234)` sin registro en ese instante
- **When** `analyze` calcula la pista `gap`
- **Then** no cuenta esa línea: `unrecordedTransitions` descarta los eventos `validation` con `outcome === 'accepted'`, y una transición `[status]` sin registro en el mismo Log sí cuenta
- **And** `docs/usage-capture.md` dice que el sello de aceptación no cuenta en `gap`, en lugar de que cuenta

### CR6 — listProjects devuelve un orden que no depende de la forma de la clave
- **Given** un registro con las entradas `locked` (nombre `locked-cache`) y `1717083302` (nombre `changeledger-proj-x`), escritas en ese orden
- **When** `listProjects()`
- **Then** devuelve las entradas ordenadas por nombre mostrado y, a igual nombre, por id, con `changeledger-proj-x` antes que `locked-cache`, y el orden es el mismo con la clave numérica escrita primero o después
- **And** el test «an unprobeable path keeps its cached name and the listing completes» de `test/registry.test.mjs` espera ese orden y deja de depender del orden de inserción; `resolveProjects` del viewer, si ordena por su cuenta, no cambia

### CR7 — El día después
- **Given** un repo inactivo recién iniciado con los changes `X` e `Y`
- **When** `changeledger finding X "falta la vista"`, `changeledger finding X promote 1 Y`, `changeledger finding X "otra cosa"`, `changeledger finding X drop 2 "no aplica"`, `changeledger check`, y después se añade a mano `[finding] 7 dropped: nada` al Log de `X` y se repite `check`
- **Then** `list --pending findings` queda vacío tras las resoluciones, el primer `check` es verde y el segundo falla con `finding F7 resolved but never recorded` y su línea

## Plan

- [x] `CHANGE_ID_FORM` exportada en `src/lifecycle.mjs` y usada por `check.mjs`
  - **Target:** `src/lifecycle.mjs`, `src/check.mjs`, `test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs test/lifecycle.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-25T19:49:31Z`
- [x] `findingsInLog` en `src/lifecycle.mjs` con las resoluciones descartadas; `check` las reporta en documentos vivos
  - **Target:** `src/lifecycle.mjs`, `src/check.mjs`, `src/commands/agent.mjs`, `test/lifecycle.test.mjs`, `test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs test/lifecycle.test.mjs test/agent.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-25T19:49:32Z`
- [x] Verbo delante en el comando `finding`, ayuda, README y tests reescritos
  - **Target:** `bin/changeledger.mjs`, `src/commands/agent.mjs`, `README.md`, `test/cli-bin.test.mjs`, `test/agent.test.mjs`, `test/contract.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/agent.test.mjs test/contract.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-25T19:49:32Z`
- [x] Exención de `test/helpers/` en el hook, helper de fixtures y CONTRIBUTING
  - **Target:** `hooks/no-ledger-refs.sh`, `test/helpers/ledger-fixtures.mjs`, `test/no-ledger-refs.test.mjs`, `CONTRIBUTING.md`, `test/contract.test.mjs`
  - **Verify:** `node --test test/no-ledger-refs.test.mjs test/contract.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-25T19:49:33Z`
- [x] `unrecordedTransitions` sin el sello de aceptación, y el doc
  - **Target:** `src/usage-analysis.mjs`, `test/usage-analysis.test.mjs`, `docs/usage-capture.md`
  - **Verify:** `node --test test/usage-analysis.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-25T19:49:34Z`
- [ ] Orden estable en `listProjects`
  - **Target:** `src/registry.mjs`, `test/registry.test.mjs`
  - **Verify:** `node --test test/registry.test.mjs test/view.test.mjs`
  - **Criteria:** CR6
- [ ] El día después por la CLI
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR7
- [ ] Hook sobre la rama, suite completa y `check`
  - **Support:**
  - **Verify:** `sh hooks/no-ledger-refs.sh origin/dev...HEAD && pnpm verify`

## Log
- **2026-10-25T17:47:39Z** `[version]` 0.19.0
- **2026-10-25T19:30:55Z** `[note]` Frontera ampliada antes de aprobar, por decisión del humano (2026-10-25): entran la exención de test/helpers/ en el hook con la convención de fixtures, la corrección de unrecordedTransitions para el sello de aceptación y el orden estable de listProjects; los tres hallazgos se promueven a este change.
- **2026-10-25T19:30:57Z** `[status]` draft → approved (human via conversation)
- **2026-10-25T19:31:02Z** `[status]` approved → in-progress
- **2026-10-25T19:31:02Z** `[branch]` set: change/20261025-174739 (auto)
- **2026-10-25T19:32:42Z** `[note]` Specification y Plan escritos en in-progress con el código delante (dev 54e6d3df). Decisiones no fijadas por el Request: la sede del id es src/lifecycle.mjs (check.mjs ya lo importa y lifecycle no importa check); findingsInLog devuelve también las resoluciones descartadas con línea y causa; listProjects ordena por nombre y después por id; un texto cuyo primer palabra es promote|drop y cuya segunda es un ordinal es una resolución, en cualquier otro caso es texto; los helpers de fixtures son criterion(n) y changeId(date, time) en test/helpers/ledger-fixtures.mjs.
