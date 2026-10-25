---
id: "20261024-202659"
title: "Un hallazgo fuera de la frontera se registra como evento del Log: finding, list --pending findings y su promoción a change"
type: change
status: approved
created: 2026-10-24T20:26:59Z
depends_on: []
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

## Plan

## Log
- **2026-10-24T20:26:59Z** `[version]` 0.19.0
- **2026-10-25T13:06:50Z** `[status]` draft → approved (human via conversation)
