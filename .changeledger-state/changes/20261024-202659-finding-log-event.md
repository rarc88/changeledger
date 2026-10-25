---
id: "20261024-202659"
title: "Un hallazgo fuera de la frontera se registra como evento del Log: finding, list --pending findings y su promoción a change"
type: change
status: in-review
created: 2026-10-24T20:26:59Z
depends_on: []
branch: change/20261024-202659
related_to:
  - "20261020-130304"
  - "20260614-165720"
  - "20260716-131649"
  - "20261023-181753"
parent: "20261023-181733"
owner: raruiz-hiberuscom
---

## Request

El plan v1.0 (§3.3, §6.2) mide que 751 de los 1.648 changes de los tres repos
registran un residuo o algo fuera de alcance como prosa suelta en una entrada
`[note]` del Log, dentro de un change que hoy está cerrado y archivado. En
este ledger son entre 93 y 105 de 371 changes (25-28 %), contados sobre las
líneas `[note]` que dicen follow-up, residual, pendiente, fuera de alcance,
seguimiento o finding. No hay campo estructurado, ningún comando los lista y
`changeledger list --pending` sólo conoce `graduation` y `archive`. Hoy el
agente que tropieza con algo fuera de la frontera tiene dos caminos: meterlo en
el change activo, que entonces no termina, o proponer un change entero con
draft, aprobación y ciclo. Falta el del medio, y el contrato del handoff lo
pide sin mecanismo: «propose type, title and reason to the human, batching
related proposals».

Este hijo construye ese mecanismo. Va antes que el recorte del contrato
(§13.3, §13.4) porque la frase del triaje que sustituye a la propuesta en
prosa tiene que nombrar un comando que exista.

### Objective

Un hallazgo fuera de la frontera del change activo se registra en el Log del
change donde se encontró, se lista desde todo el ledger y lo promueve a change
el humano cuando lo decide, no el agente cuando tropieza. Terminado significa
que:

- `finding` es el décimo tipo de evento del Log, definido en
  `LOG_EVENT_DEFINITIONS` (`src/lifecycle.mjs`) con tres formas de payload —
  abierto `<texto>`, promovido `<n> promoted #<id>` y descartado `<n> dropped:
  <razón>`— y declarado en `LOG_EVENT_PRODUCERS` (`bin/changeledger.mjs`), de
  modo que `log --help` lo imprime con sus escritores y `check` rechaza una
  forma inválida con el mensaje `invalid typed event` que ya existe;
- `changeledger finding <id> "<texto>"` escribe un hallazgo abierto;
  `changeledger finding <id> <n> promote <nuevo-id>` y `changeledger finding
  <id> <n> drop "<razón>"` lo resuelven; `n` es el ordinal del hallazgo dentro
  del change, derivado de su posición en el Log; `promote` exige que
  `<nuevo-id>` exista en el ledger y `changeledger log` sigue escribiendo
  sólo `[note]`;
- `changeledger list --pending findings` lista los hallazgos abiertos de todo
  el ledger, archivados incluidos, con change de origen, ordinal y texto, en
  texto y en `--json`; abierto es registrado y ni promovido ni descartado;
- ningún gate lee los hallazgos: un hallazgo abierto no bloquea `done`, el
  archivo ni la release del change que lo registra, y `analyze` no lo cuenta
  como transición ni cierra tramo con él;
- la promoción no crea nada: el nuevo change nace por el flujo autorizado de
  siempre, con objetivo y frontera, y el Log del origen enlaza al promovido;
- el contrato nombra el mecanismo donde hoy manda proponer en prosa —la
  viñeta «fuera del objetivo» del triaje de handoff— y `list --pending
  findings` en la lista de descubrimiento y la fila «asks what is pending» del
  core, reescribiendo esas frases y no añadiendo otras: cada captura afectada
  pesa igual o menos en tokens que hoy (§7).

### Frontier

**Entra.** `src/lifecycle.mjs` (`LOG_EVENT_DEFINITIONS`, `LOG_EVENT_TYPES`,
`parseLogEvent`, `serializeLogEvent`); `bin/changeledger.mjs`
(`LOG_EVENT_PRODUCERS`, el comando `finding` y su ayuda, la opción `--pending`
de `list` y la ayuda de `log`); `src/commands/agent.mjs` (`list` y su
validación de `--pending`, una mutación de hallazgo junto a `logMutation`) y
el ayudante que enumera hallazgos abiertos sobre todos los changes, donde hoy
viven `isPendingGraduation` y `selectArchivableGraduated`; `src/check.mjs`
sólo si la validación del payload necesita más que la función `parse` de la
definición; `templates/contract/core.md` (la fila «asks what is pending» de la
tabla de intención y la lista «Operational discovery») y
`templates/contract/handoff.md` (la viñeta «Outside the approved objective»);
`README.md` donde documenta `list --pending`; y los tests de cada superficie:
`test/lifecycle.test.mjs`, `test/agent.test.mjs`, `test/cli-bin.test.mjs`,
`test/check.test.mjs`, `test/contract.test.mjs` (la prueba de que `log --help`
y las definiciones coinciden) y `test/context.test.mjs` sólo donde pinen las
frases reescritas.

**Queda fuera.** El viewer: el Log se renderiza como Markdown y los hallazgos
se leen ahí; una vista de pendientes como la de graduación es otro change si
se quiere. `analyze` y `metrics`. `apply`, que sigue escribiendo `status`,
`owner` y `note`. La creación automática de drafts desde un hallazgo.
Convertir retroactivamente las `[note]` que hoy describen residuos. El resto
del recorte del contrato y las cápsulas (§13.3, §13.4), la prohibición de
referencias fuera de `.changeledger/` (§6.3) y las specs, que reconcilia la
épica.

**Pre-autorizado.** Reescribir las tres frases del contrato nombradas arriba
dentro de los techos vigentes, sin subir ninguno; retirar un test que pine la
redacción anterior de esas frases, nombrándolo en el Log; enmendar la
Specification en `in-progress` cuando el código desmienta lo previsto,
registrándolo en el Log. Si cambia el objetivo o la frontera, se vuelve al
humano.

### Decisiones de forma que el plan deja abiertas

1. **Un comando `finding`, no una opción de `log`.** La ayuda de `log` ya
   dice que `<message...>` no lleva nombres de evento y que `log` es sólo para
   notas humanas; un escritor por evento mantiene honesto el mapa de
   productores que `log --help` verifica contra las definiciones.
2. **La resolución vive en el Log y no en el frontmatter.** El plan exige
   «sin almacenamiento nuevo, sin fichero nuevo, sin estado nuevo»; promover o
   descartar es una línea más del mismo tipo de evento, y `list --pending
   findings` calcula lo abierto leyendo el Log. El ordinal se deriva de la
   posición y no se escribe en el evento abierto, igual que el Log no numera
   sus transiciones.
3. **`--pending findings` incluye archivados sin pedir `--all`.** Es la única
   consulta de `list` que lo hace, porque los hallazgos viven en changes
   cerrados: excluirlos devolvería una lista vacía justo para los 93 changes
   que motivan el mecanismo.
4. **Nada bloquea.** Un hallazgo no es un `[!]` ni una dependencia; si
   bloqueara el archivo o la release, volvería a ser ceremonia y se dejaría
   de usar, que es lo que pasó con las `[note]`.
5. **El viewer queda fuera.** Muestra el Log entero y por tanto los hallazgos;
   una vista propia añade superficie a un plan que la quita.

### Investigation

Mapa medido en `dev` (`3e1f23de`) por una investigación delegada de sólo
lectura.

**Gramática.** `LOG_EVENT` en `src/lifecycle.mjs` reconoce `- **<instante>**
\`[tipo]\` payload`; `LOG_EVENT_DEFINITIONS` declara nueve tipos (`status`,
`review`, `validation`, `owner`, `branch`, `graduation`, `archive`, `note`,
`version`), cada uno con `form`, `canonicalPayload`, `transition` y `parse`;
`parseLogEvent` devuelve `null` ante tipo desconocido o payload que `parse`
rechaza, y `serializeLogEvent` lanza `invalid <tipo> Log event`. `note` es
`<texto no vacío>`, `transition: false`, y recorta un `[note] ` inicial.

**Escritores.** `LOG_EVENT_PRODUCERS` en `bin/changeledger.mjs` asigna cada
tipo a sus comandos; `logEventGrammarHelp()` lanza `Log help producer map does
not match executable definitions (missing: …; stale: …)` si los dos mapas
difieren, así que un tipo nuevo necesita entrada en ambos. `agent.mjs`
`logMutation` añade un `note` con `appendLogEvent` y no toma instantánea de
uso; `apply` escribe `status`, `owner` y `note`.

**Errores hoy.** `changeledger check` sobre `[finding] x` o sobre un payload
malformado de un tipo válido devuelve el mismo `Log line N: invalid typed
event; valid types: …; expected: - **YYYY-MM-DDTHH:MM:SSZ** \`[type]\`
payload`; `changeledger log <id> "[finding] x"` escribe `` `[note]` [finding]
x ``.

**Lectores.** `check.mjs` lee `branch`, `graduation`, `review` y el replay de
`status`/`review`/`validation`; `metrics.mjs` los tres de transición;
`writer.mjs` `version`; `agent.mjs` `graduation`. `usage-analysis.mjs` lee
`version` y los bordes de veredicto fallido; `unrecordedTransitions` filtra
`status`, `review` y `validation`; los tramos los cierran las instantáneas de
uso, nunca las notas. Un evento sin transición que ningún comando con
instantánea escribe no toca la atribución.

**`list --pending`.** `agent.mjs` `list` rechaza `--pending findings` con
`Invalid --pending "findings". Valid: graduation, archive`; las filas son por
change (id, título, tipo, estado, owner, rama, archivado, padre, progreso) y
los archivados se ocultan salvo `--all`/`--archived`. En `bin` la opción es
`--pending <kind>` con la ayuda `filter pending work (graduation|archive)` y
la salida de texto es `status #id title`. Un listado de hallazgos necesita
una fila propia (origen, ordinal, texto). El viewer sólo tiene la vista
`pending_graduation` y renderiza el Log como Markdown (`stageBlock` en
`view-parts.js`).

**Changes relacionados.** `20261020-130304` hizo que `log --help` se genere
desde `LOG_EVENT_DEFINITIONS` y verifique el mapa de productores;
`20260614-165720` creó `list --pending graduation`; `20260716-131649`
centralizó las consultas en `list`.

### Proposal

#### Solución elegida

`finding` entra en `LOG_EVENT_DEFINITIONS` con tres brazos de payload y
`transition: false`, y en `LOG_EVENT_PRODUCERS` con el comando `finding` como
único escritor. El comando `finding <id> "<texto>"` añade la línea abierta;
`finding <id> <n> promote <nuevo-id>` comprueba que el ordinal existe y está
abierto y que `<nuevo-id>` es un change del ledger, y añade la línea
promovida; `finding <id> <n> drop "<razón>"` añade la descartada. Un ayudante
en `agent.mjs` recorre todos los changes, archivados incluidos, y devuelve los
abiertos; `list --pending findings` lo usa y emite filas `#<origen> F<n>
<texto>` en texto y objetos `{ id, n, text, at }` en `--json`. El contrato
cambia tres frases: la viñeta del handoff pasa de «propose type, title and
reason to the human» a registrar el hallazgo con `changeledger finding`, la
fila «asks what is pending» y la lista de descubrimiento del core nombran
`--pending findings`.

#### Alternativas descartadas

- **Una lista `findings:` en el frontmatter.** Estado nuevo que `check`
  tendría que validar y el viewer editar; el plan lo excluye.
- **Un directorio `findings/`.** Fichero nuevo, y separa el hallazgo del
  change donde se encontró, que es su único contexto.
- **Un prefijo en `[note]`.** No es parseable: `check` no distingue una nota
  de un hallazgo y `list` tendría que adivinar por texto, que es lo que hoy
  no funciona.
- **Bloquear el archivo hasta resolver los hallazgos.** Ceremonia: obliga a
  decidir sobre cada residuo para cerrar un change que ya está entregado.
- **`new --from-finding` que cree el draft.** Crearía un artefacto sin
  autorización humana explícita, contra el invariante del core.

#### Escenarios

- **El día después.** En `in-progress`, el agente encuentra un defecto fuera
  de la frontera; escribe `changeledger finding <id> "…"` y sigue con su
  tarea. Días después el humano corre `changeledger list --pending findings`,
  elige uno, autoriza el draft; el agente lo crea con objetivo y frontera y
  ejecuta `changeledger finding <origen> <n> promote <nuevo-id>`.
- **Un hallazgo que ya no aplica.** El humano lo descarta con `drop` y una
  razón; deja de listarse y el Log conserva por qué.
- **Un ordinal inexistente o ya resuelto.** `promote` y `drop` fallan con un
  mensaje que nombra el ordinal y el estado del hallazgo; nada se escribe.

## Specification

Escrita en `in-progress` con el código delante (`dev` en `3e1f23de`). La
gramática de los eventos vive en `LOG_EVENT_DEFINITIONS` (`src/lifecycle.mjs`),
el mapa de escritores en `LOG_EVENT_PRODUCERS` (`bin/changeledger.mjs`), las
mutaciones del Log en `src/commands/agent.mjs` (`logMutation`, `log`) y las
consultas pendientes en `list` del mismo fichero. Los mensajes de error de
abajo son literales.

### CR1 — finding es el décimo tipo de evento con tres formas de payload
- **Given** `LOG_EVENT_DEFINITIONS` en `src/lifecycle.mjs`
- **When** `parseLogEvent` lee ``- **2026-10-25T10:00:00Z** `[finding]` el ejemplo de ayuda cita un id``, ``- **2026-10-25T10:00:00Z** `[finding]` 2 promoted #20260101-000000`` y ``- **2026-10-25T10:00:00Z** `[finding]` 1 dropped: ya no aplica``
- **Then** devuelve `{ at, type: 'finding', outcome: 'open', text: 'el ejemplo de ayuda cita un id' }`, `{ at, type: 'finding', outcome: 'promoted', n: 2, target: '20260101-000000' }` y `{ at, type: 'finding', outcome: 'dropped', n: 1, reason: 'ya no aplica' }`
- **And** `LOG_EVENT_TYPES` tiene diez entradas y la última es `finding`; `LOG_EVENT_DEFINITIONS.finding.transition` es `false`; su `form` es `<text> | <n> promoted #<id> | <n> dropped: <reason>`
- **And** un payload vacío, `0 promoted #20260101-000000`, `2 promoted #x` y `1 dropped:` (sin razón) devuelven `null`
- **And** `serializeLogEvent` reproduce las tres líneas desde esos objetos y lanza `invalid finding Log event` ante `{ type: 'finding', outcome: 'open', text: '' }`

### CR2 — log --help imprime finding con su único escritor
- **Given** `LOG_EVENT_PRODUCERS.finding` es `['changeledger finding']`
- **When** `changeledger log --help`
- **Then** la salida contiene el bloque `  finding`, `    Payload: <text>`, `    Or: <n> promoted #<id>`, `    Or: <n> dropped: <reason>`, `    Written by:` y `      changeledger finding`
- **And** el test `20261020-130304 CR6` de `test/contract.test.mjs` pasa sin editarlo, porque itera las definiciones

### CR3 — check rechaza una forma inválida con el mensaje que ya existe
- **Given** un change vivo cuyo Log lleva ``- **2026-10-25T10:00:00Z** `[finding]` 2 promoted #abc``
- **When** `changeledger check`
- **Then** falla con ``Log line <n>: invalid typed event; valid types: status, review, validation, owner, branch, graduation, archive, note, version, finding; expected: - **YYYY-MM-DDTHH:MM:SSZ** `[type]` payload``

### CR4 — finding <id> "<texto>" escribe un hallazgo abierto en cualquier change
- **Given** un repo con el change `X` en `in-progress` y otro `A` archivado, en disposición inactiva y en disposición activada
- **When** `changeledger finding X "el ejemplo de ayuda cita un id"` y `changeledger finding A "la vista de pendientes no existe"`
- **Then** el Log de cada uno termina en ``- **<instante>** `[finding]` <texto>``, precedido del sello `[version]` si el Log no lo tenía; stdout dice `finding F1 recorded on #X`; el frontmatter no cambia y no se escribe ninguna instantánea de uso
- **And** en el repo activado el commit de la ref de estado se llama `finding: X`
- **And** `changeledger log X "[finding] x"` sigue escribiendo `` `[note]` [finding] x ``

### CR5 — un texto vacío o que se lee como resolución se rechaza
- **Given** el change `X`
- **When** `changeledger finding X ""`, `changeledger finding X "2 promoted #20260101-000000"` y `changeledger finding X "1 dropped: x"`
- **Then** fallan con `finding text must not be empty` y, los dos últimos, con `finding text "<texto>" reads as a resolution; resolve a finding with changeledger finding <id> <n> promote|drop`, y el Log no cambia

### CR6 — promote enlaza un hallazgo abierto a un change existente
- **Given** `X` con `F1` y `F2` abiertos y un change `Y` del ledger
- **When** `changeledger finding X 2 promote Y`
- **Then** el Log de `X` gana ``- **<instante>** `[finding]` 2 promoted #Y`` y stdout dice `finding F2 on #X → promoted to #Y`
- **And** `changeledger finding X 3 promote Y` falla con `change #X has no finding F3`; repetir `changeledger finding X 2 promote Y` falla con `finding F2 of #X is already promoted to #Y`; `changeledger finding X 1 promote Z` con `Z` inexistente falla con el mensaje de `resolveChangeInRepo` (`No change with id "Z" …`); `changeledger finding X 1 promote X` falla con `finding F1 cannot be promoted to its own change #X`; `changeledger finding X abc promote Y` falla con `finding ordinal must be a positive integer (got "abc")`; en todos los fallos el Log no cambia

### CR7 — drop cierra un hallazgo con razón
- **Given** `X` con `F1` abierto
- **When** `changeledger finding X 1 drop "ya no aplica"`
- **Then** el Log gana ``- **<instante>** `[finding]` 1 dropped: ya no aplica`` y stdout dice `finding F1 on #X → dropped`
- **And** `changeledger finding X 1 drop ""` falla con `drop requires a reason`; repetir el `drop` falla con `finding F1 of #X is already dropped`; `changeledger finding X 1 promote Y` tras el `drop` falla con ese mismo mensaje

### CR8 — list --pending findings saca los abiertos de todo el ledger
- **Given** los changes `A` (archivado; `F1` abierto, `F2` promovido), `B` (`done`; `F1` descartado), `C` (`in-progress`, owner `Roberto Ruiz`; `F1` abierto) y `D` sin hallazgos
- **When** `changeledger list --pending findings`
- **Then** imprime exactamente dos líneas, `#A F1  <texto>` y `#C F1  <texto>`, ordenadas por id y ordinal, sin pedir `--all`
- **And** `--json` imprime `[{ "id": "A", "n": 1, "text": "<texto>", "at": "<instante>" }, { "id": "C", … }]`
- **And** `--owner "Roberto Ruiz"` deja sólo `C`; `--archived` deja sólo `A`; `--all` imprime las dos; `--status in-progress` deja sólo `C`
- **And** la función `list({ pending: 'findings' })` de `src/commands/agent.mjs` devuelve esas mismas filas y no filas de change

### CR9 — el valor inválido de --pending nombra los tres
- **Given** cualquier repo
- **When** `changeledger list --pending release`
- **Then** falla con `Invalid --pending "release". Valid: graduation, archive, findings`
- **And** `changeledger list --help` describe la opción como `filter pending work (graduation|archive|findings)` y sus ejemplos incluyen `changeledger list --pending findings`

### CR10 — un hallazgo abierto no bloquea el archivo ni la entrega
- **Given** `X` en `done`, graduado con `--skip` y con `F1` abierto, y `W` en `in-progress` con `F1` abierto cuya rama no toca nada fuera del ledger
- **When** `changeledger archive X` y `changeledger status W done`
- **Then** `X` queda `archived: true` y `W` pasa a `done`; ningún mensaje menciona el hallazgo

### CR11 — analyze no cuenta el hallazgo
- **Given** un change con registros de uso y un Log con un hallazgo abierto y otro promovido
- **When** `analyze` calcula los tramos, el rework y las transiciones sin registro de ese change
- **Then** el resultado es idéntico, en profundidad, al del mismo change con las dos líneas `[finding]` quitadas

### CR12 — el contrato nombra el mecanismo sin pesar más
- **Given** `templates/contract/core.md` y `templates/contract/handoff.md`
- **When** se componen `changeledger context`, `context implement` y `context review`
- **Then** la fila «asks what is pending» del core y la lista «Operational discovery» nombran `--pending findings`; la viñeta «Outside the approved objective» del handoff manda registrar el hallazgo con `changeledger finding <id>` y deja de pedir proponer tipo, título y razón ni crear el draft; ninguna frase del contrato pide proponer «type, title and reason»
- **And** los tokens medidos por `test/budget-support.mjs` de las tres capturas no superan los de `dev` en `3e1f23de` (core 2.687, implement 2.484, review 1.106) y los techos `base.core`, `base.implement` y `base.review` de `budgets.yml` bajan al valor medido redondeado a la decena superior, con `PINNED_CEILINGS` en `test/context.test.mjs` actualizado

### CR13 — el README documenta el comando y la consulta
- **Given** `README.md`
- **When** se lee la referencia de comandos
- **Then** la línea de `list` dice `[--pending graduation|archive|findings]` y hay una entrada `changeledger finding <id> "<text>" | <n> promote <id> | <n> drop "<reason>"` con una frase que dice qué es un hallazgo

### CR14 — el día después
- **Given** un repo inactivo recién creado con `changeledger init`
- **When** se crean `X` e `Y` con `new`, se registra `changeledger finding X "falta la vista"`, se lista `--pending findings`, se promueve con `changeledger finding X 1 promote Y` y se lista de nuevo
- **Then** la primera lista muestra `#X F1  falta la vista`, la segunda está vacía, `changeledger show X --json` devuelve en su Log las dos líneas `[finding]` y `changeledger check` termina sin errores

## Plan

- [x] Gramática de `finding` en `LOG_EVENT_DEFINITIONS`: parse de las tres formas, `transition: false`, serialización
  - **Target:** `src/lifecycle.mjs`, `test/lifecycle.test.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-25T13:33:34Z`
- [x] Escritor en `LOG_EVENT_PRODUCERS` y mensaje de `check` con el décimo tipo
  - **Target:** `bin/changeledger.mjs`, `test/cli-bin.test.mjs`, `test/check.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/check.test.mjs test/contract.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-10-25T13:33:35Z`
- [x] Mutaciones `recordFinding` y `resolveFinding` junto a `logMutation`, con sus rechazos, y el comando `finding` en la CLI
  - **Target:** `src/commands/agent.mjs`, `bin/changeledger.mjs`, `test/agent.test.mjs`, `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR4, CR5, CR6, CR7
  - **Resolved:** `2026-10-25T13:33:35Z`
- [x] `openFindings` sobre todos los changes y `list --pending findings` con sus filas, filtros, ayuda y error
  - **Target:** `src/commands/agent.mjs`, `bin/changeledger.mjs`, `test/agent.test.mjs`, `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR8, CR9
  - **Resolved:** `2026-10-25T13:33:36Z`
- [x] Nada bloquea y `analyze` no cuenta: tests de archivo, entrega directa y análisis con hallazgos
  - **Target:** `test/agent.test.mjs`, `test/usage-analysis.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs test/usage-analysis.test.mjs`
  - **Criteria:** CR10, CR11
  - **Resolved:** `2026-10-25T13:33:37Z`
- [x] Las tres frases del contrato, medidas, y los techos bajados a lo medido
  - **Target:** `templates/contract/core.md`, `templates/contract/handoff.md`, `templates/contract/budgets.yml`, `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs test/contract.test.mjs`
  - **Criteria:** CR12
  - **Resolved:** `2026-10-25T13:33:38Z`
- [x] README: `finding` y `--pending findings`
  - **Target:** `README.md`, `test/contract.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR13
  - **Resolved:** `2026-10-25T13:33:38Z`
- [x] El día después, de punta a punta por la CLI
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR14
  - **Resolved:** `2026-10-25T13:33:39Z`
- [x] Suite completa, lint y `check` antes de pedir la revisión
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-25T13:33:55Z`

## Log
- **2026-10-24T20:26:59Z** `[version]` 0.19.0
- **2026-10-25T13:06:50Z** `[status]` draft → approved (human via conversation)
- **2026-10-25T13:06:55Z** `[status]` approved → in-progress
- **2026-10-25T13:06:55Z** `[branch]` set: change/20261024-202659 (auto)
- **2026-10-25T13:10:54Z** `[note]` Specification y Plan escritos en in-progress con el código delante (dev 3e1f23de). Decisiones no fijadas por el Request: la forma de la CLI es un solo comando finding <id> con la cola <texto...> o <n> promote|drop …, distinguida por si las dos primeras palabras son un entero y promote|drop; la lista de --pending findings devuelve filas de hallazgo (id, n, text, at), no de change; --archived restringe a orígenes archivados y --all equivale a no pasar nada; los techos de core, implement y review bajan a lo medido redondeado a la decena (pre-autorizado). El documento del change vive en la ref de estado, así que no hay commit de baseline en la rama: cada edit es un commit de esa ref.
- **2026-10-25T13:33:40Z** `[note]` Implementación delegada entregada (rojo→verde por criterio, mutantes en CR1/CR6/CR8, pnpm verify 2193/2193). Pins reapuntados, no retirados: context.test 213942 CR1-CR4 y 124835 CR2/CR3 (fila y viñetas de --pending), lifecycle.test 134716 CR1/CR2 (diez tipos), cli-bin.test 131649 CR3/CR4/CR6/CR8-CR10 (dominio de --pending). Medido con budget-support sobre repo recién iniciado: core 2681→2678, implement 2478→2471, review 1100→1093 tokens; techos a 2680/2480/1100. La frase del handoff «Create the draft only after explicit authorization» cae: su obligación vive en el invariante del core «No artifact without explicit human authorization». Residuales: apply no escribe hallazgos; sin vista en el viewer; CR11 sin mutante de fuente (usage-analysis.mjs fuera de la frontera).
- **2026-10-25T13:33:56Z** `[status]` in-progress → in-review
- **2026-10-25T13:34:39Z** `[note]` Mandato de revisión: auditoría completa del rango 3e1f23de..e059ebb3 (dos commits) contra CR1–CR14, con las decisiones no especificadas y las frases cuantificadas del informe del implementador como puntos de escrutinio.
