---
id: "20260726-124833"
title: Eliminar el flag --have del contexto
type: refactor
status: in-progress
created: 2026-07-26T12:48:33Z
depends_on: []
related_to: ["20260726-124834", "20260726-124835"]
owner: raruiz-hiberuscom
---

## Request

Eliminar por completo la opción `--have <rev>` de `changeledger context`, sin
shim de compatibilidad hacia atrás. Debe desaparecer del CLI (`bin/changeledger.mjs`),
de `src/commands/context.mjs` (rama `options.have`, helper `unchangedBody()` y el
sufijo ` — unchanged` pasado a `beginDelimiter`), del párrafo correspondiente en
`templates/contract/core.md` y del párrafo final del bloque `REFERENCE` exportado
por `src/contract.mjs`, junto con los tests que hoy afirman ese comportamiento.

## Proposal

**Eliminación limpia, sin capa de compatibilidad.** `--have` existe para evitar
recargar el contexto core cuando ya está en el contexto activo del agente. Ese
objetivo ya se cumple con coste cero de código gracias a la regla del contrato
core (`templates/contract/core.md`, "Read complete context before acting"):
mientras el core completo siga disponible en la conversación activa, un nuevo
mensaje humano por sí solo no dispara una recarga. El único momento en que
`--have` aportaría valor es justo después de una compactación de contexto —y
ese es precisamente el momento en que el `rev` retenido se ha perdido junto con
el resto de la captura. Su caso útil es, por tanto, vacío: el flag solo aporta
superficie de CLI, prosa de contrato y sus propios tests, sin beneficio real.

_Alternativa descartada:_ mantener `--have` como no-op o marcarlo `deprecated`
en vez de retirarlo. Se descarta porque el repo prohíbe residuo de
compatibilidad hacia atrás para código que puede simplemente cambiarse
(`AGENTS.md`/CLAUDE rules), y un flag "aceptado pero ignorado" seguiría
apareciendo en `--help`, seguiría necesitando prosa de contrato explicándolo y
dejaría al agente preguntándose si aún hace algo.

**Consecuencia investigada — `rev:` y `contentRev()` quedan muertos.** Se
verificó el uso real de `contentRev` (exportado en `src/framing.mjs`) y del
segmento `rev:<hash>` de la línea BEGIN:

- `contentRev` tiene un único punto de llamada real en todo el repo:
  `src/commands/context.mjs:153` (`const rev = contentRev(body.join('\n\n'))`),
  dentro de `composeResult`. Ningún otro comando (`agent-context.mjs`,
  `agent-prompt.mjs`) lo importa ni lo usa; ambos construyen su línea BEGIN con
  `beginSentinel` sin ningún segmento de revisión.
- El valor `rev` resultante solo se consume en tres sitios, los tres dentro de
  `src/commands/context.mjs`: el `beginDelimiter(mode, changeId, rev)` de la
  salida normal (línea 154), la comparación `options.have === result.rev` de
  `buildContext` (línea 210) y el `beginDelimiter(..., ' — unchanged')` +
  `unchangedBody(result.rev)` de la rama `--have` (líneas 212-213). Ningún otro
  módulo del repo (viewer, agent-context, agent-prompt, README) lee o parsea el
  segmento `rev:` de la línea BEGIN.
- Con `--have` eliminado, esos tres puntos de consumo desaparecen con él: el
  segmento `rev:` de la línea BEGIN y la función `contentRev()` no tienen
  ningún consumidor restante. Son código muerto y deben eliminarse en este
  mismo change, no dejarse "por si acaso" — el repo prohíbe dejar residuo así.

## Specification

### CR1 — `--have` deja de ser una opción reconocida por el CLI
- **Given** un repo ChangeLedger inicializado con `changeledger init`
- **When** se ejecuta `changeledger context --have deadbeefcafe`
- **Then** el proceso termina con código de salida `1` y stderr contiene exactamente `error: unknown option '--have'`
- **And** `changeledger context --help` ya no lista ninguna opción `--have` ni el ejemplo `changeledger context --have 0123456789ab`

### CR2 — La línea BEGIN de `context` ya no lleva segmento `rev:`
- **Given** un repo ChangeLedger inicializado con `changeledger init`
- **When** se ejecuta `changeledger context` (o `changeledger context <modo>`, o `changeledger context <id>`)
- **Then** la primera línea de stdout es exactamente `===== CHANGELEDGER CONTEXT BEGIN — mode: <mode> — v<version> =====` (con `— change: #<id>` añadido solo en modo por change id), sin ningún segmento ` — rev:...`
- **And** ninguna línea de la salida completa contiene la subcadena `rev:`

### CR3 — `contentRev` deja de existir como export de `src/framing.mjs`
- **Given** el módulo `src/framing.mjs`
- **When** se ejecuta `node -e "import('./src/framing.mjs').then(m => console.log(Object.keys(m)))"`
- **Then** la salida es exactamente `[ 'VERSION', 'beginSentinel', 'endSentinel' ]`, sin `contentRev`

### CR4 — El contrato core ya no menciona `rev:`/`--have`/recaptura tras compactación
- **Given** el archivo `templates/contract/core.md`
- **When** se ejecuta `grep -c -- '--have' templates/contract/core.md`
- **Then** el resultado es `0`
- **And** `grep -c 'rev:<hash>' templates/contract/core.md` también da `0`

### CR5 — El bootstrap instalado por `register`/`init` ya no menciona `--have`
- **Given** un repo nuevo tras `changeledger init`
- **When** se lee el bloque administrado de `AGENTS.md`
- **Then** `grep -c -- '--have' AGENTS.md` da `0`
- **And** el bloque ya no contiene el párrafo que empieza por "After a compaction, verify a retained capture"

## Plan

- [x] Quitar la opción `--have <rev>`, su texto de ayuda (párrafo "Each BEGIN line carries..." y el ejemplo `--have 0123456789ab`) y el paso de `options.have` a `context()` en `bin/changeledger.mjs`; en `test/cli-bin.test.mjs` sustituir el test `160444` (que ejercitaba `--have`) por una prueba de que `--have` es una opción desconocida; verify: `node --test test/cli-bin.test.mjs` (CR1)
  - **Resolved:** `2026-07-27T01:09:58Z`
- [x] En `src/commands/context.mjs`: quitar la rama `options.have` de `buildContext`, el helper `unchangedBody()`, el parámetro `rev` y el sufijo ` — unchanged` de `beginDelimiter`, y el cálculo de `rev` en `composeResult`; en `src/framing.mjs` quitar el export `contentRev`; en `test/context.test.mjs` quitar los tests `103759 CR1-CR4` (rev estable, rev cambia con la política, `--have` coincide, `--have` no coincide) y añadir una prueba de que la línea BEGIN no lleva `rev:`; en `test/framing.test.mjs` quitar los tests `CR1`/`CR2` de `contentRev`; verify: `node --test test/context.test.mjs test/framing.test.mjs` (CR2, CR3)
  - **Resolved:** `2026-07-27T01:09:58Z`
- [x] Borrar el párrafo "Every BEGIN line carries `rev:<hash>`..." (líneas 19-22 actuales) de `templates/contract/core.md`; verify: `node --test test/context.test.mjs` y `grep -c -- '--have' templates/contract/core.md` devuelve `0` (CR4)
  - **Resolved:** `2026-07-27T01:09:58Z`
- [x] Borrar el párrafo final sobre `--have` del bloque `REFERENCE` exportado en `src/contract.mjs`; actualizar en `test/register.test.mjs` y `test/contract.test.mjs` los fixtures/aserciones que citan `> [mode] --have <rev>\`` o el párrafo "After a compaction, verify a retained capture"; verify: `node --test test/register.test.mjs test/contract.test.mjs` (CR5)
  - **Resolved:** `2026-07-27T01:09:58Z`
- [x] Ejecutar la puerta de calidad completa tras el resto de tareas; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T01:09:58Z`

## Log

- **2026-07-26T12:48:33Z** `[note]` Creado en draft: eliminar `--have` de `changeledger context` sin shim. `--have` solo aporta valor tras una compactación, momento en el que el `rev` retenido ya se ha perdido; su caso útil es vacío. Investigación confirma que `contentRev()` (`src/framing.mjs`) tiene un único punto de llamada (`src/commands/context.mjs:153`) y que el segmento `rev:` de la línea BEGIN solo se consume en ese mismo archivo (líneas 154, 210, 212-213) para servir a `--have`; sin `--have`, ambos quedan sin consumidor y se retiran como código muerto en este mismo change.
- **2026-07-26T14:05:37Z** `[status]` draft → approved
- **2026-07-27T00:58:40Z** `[status]` approved → in-progress
- **2026-07-27T01:10:12Z** `[note]` Eliminado --have sin shim: opción y ayuda del CLI, rama options.have/unchangedBody/parámetros rev y extra de beginDelimiter en context.mjs, export contentRev en framing.mjs, párrafo rev:/--have en core.md (pin de fragmento actualizado con la regla clasificada como RETIRADA) y párrafo final del REFERENCE en contract.mjs. AGENTS.md re-sincronizado con changeledger register; BOOTSTRAP_VERSION se deja en 3 porque checkContract ya detecta el cambio de contenido a igual versión (verificado: reportó 'outdated' antes de register) y el salto 3→4 lo posee #20260726-124834. composeResult pasa a devolver el texto compuesto: mode/changeId/rev eran campos sin consumidor. Fixture prettierBootstrap de test/contract.test.mjs y test/register.test.mjs reapuntada a otra continuación perezosa del bloque; el fixture v2 histórico de register.test.mjs conserva --have a propósito. core 138→133 líneas / 8451→8119 bytes; spec 301 líneas / 13543→13522 bytes. Pendiente fuera de propiedad: README.md:155 y .changeledger/specs/contract-discovery.md siguen documentando --have/rev:. pnpm verify 785/785, changeledger check limpio.
- **2026-07-27T01:11:52Z** `[note]` El orquestador borro tambien la frase de README.md:155 que documentaba 'A retained revision is checked with --have <rev> after compaction'. Ningun CR la cubre —el Request enumera CLI, context.mjs, core.md y el bloque REFERENCE, no el README— pero dejarla publicaria documentacion de un flag que ahora sale con error. Conviene escrutinio del revisor sobre esta edicion fuera de criterios
