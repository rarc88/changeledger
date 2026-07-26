---
id: "20260726-124834"
title: Bootstrap con captura acotada y verificable
type: feature
status: approved
created: 2026-07-26T12:48:34Z
depends_on: ["20260726-130727"]
related_to: ["20260726-124835"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El bloque de bootstrap actual (`REFERENCE` en `src/contract.mjs`) instruye al
agente con una regla negativa imposible de verificar: *"no pipes, filters,
summaries, previews or voluntary output limits"*. En la práctica se incumple
todo el tiempo — cualquier arnés que trunque o resuma stdout ya viola la regla
sin que el agente lo note. La única señal de integridad
(`CHANGELEDGER CONTEXT END`) se describe en prosa dentro del mismo bloque que
desaparece precisamente cuando la salida se trunca: un agente que nunca llega a
leer la línea END nunca se entera de que necesitaba comprobarla.

Se pide sustituir esa regla negativa por una mecánica acotada y verificable:
un comando exacto con un límite de líneas conocido, más una condición de
validez positiva (comprobar la última línea) en lugar de una lista de
prohibiciones.

Diseño decidido por el humano (no rediseñar, documentar), en el alcance de
este change (superficie CONTRACT — el texto de bootstrap y su versión):

- Nuevo texto de `REFERENCE` con el comando exacto
  `changeledger context 2>&1 | head -200` y la condición positiva "la captura
  es válida solo si la última línea contiene `CHANGELEDGER CONTEXT END`".
- `BOOTSTRAP_VERSION` pasa de 3 a 4 en `src/contract.mjs`.

El nuevo texto de `REFERENCE` menciona el campo `lines:<N>` de la línea
`BEGIN` como mecanismo de reintento cuando la salida supera las 200 líneas.
Ese campo ya existe: lo publica el change `20260726-130727` (dependencia de
este, que aterriza primero). Este documento no reimplementa ni vuelve a
especificar cómo se calcula o se compone ese campo, ni el endurecimiento
EPIPE del CLI — ambos viven íntegramente en `20260726-130727`.

Fuera de alcance explícito:

- Publicar o calcular `lines:<N>` en la línea `BEGIN`, la composición de
  `beginDelimiter`/`composeResult`, o el endurecimiento EPIPE del CLI — lo
  posee el change `20260726-130727` (dependencia de este).
- Eliminar el flag `--have` o cualquier mención a `rev:` en el nuevo texto de
  bootstrap — lo posee el change `20260726-124833` (dependencia transitiva,
  vía `20260726-130727`).
- Reescribir `templates/contract/core.md` — lo posee el change
  `20260726-124835` (relacionado, sin orden de ejecución).

## Investigation

**Bloque actual (`src/contract.mjs`):**

```
> [!IMPORTANT]
> Attempt to run **ChangeLedger** with `changeledger context` immediately after
> reading this file — before planning, investigating, or acting. If it succeeds,
> retain complete stdout through the `CHANGELEDGER CONTEXT END` line and follow that
> complete context: no pipes, filters, summaries, previews or voluntary output limits.
> If the tool exposes an output budget, reserve enough for the whole response. A
> missing END means the output was truncated: stop and re-run with a larger capture.
>
> If the command is unavailable, continue normally without ChangeLedger. If it
> starts but fails, report the error to the human and wait for them to decide how
> to continue; do not treat a failing command as absent.
>
> After a compaction, verify a retained capture with `changeledger context
> [mode] --have <rev>` (the BEGIN line's `rev:`). If the context or its revision was lost,
> load it completely again; a mismatch still returns the complete output.
```

`BOOTSTRAP_VERSION = 3` (`src/contract.mjs:42`). `bootstrapBlock()` envuelve
`REFERENCE` entre `<!-- CHANGELEDGER BOOTSTRAP BEGIN v${version} -->` y
`<!-- CHANGELEDGER BOOTSTRAP END -->` (`BEGIN_ALL_RE`, `END_MARKER`,
`src/contract.mjs:44-46`). El `AGENTS.md` de este propio repo lleva hoy
`BEGIN v3` (`AGENTS.md:6`).

**Tamaños reales medidos** (`node bin/changeledger.mjs context ... | wc -l`):
core = 137 líneas, `spec` = 299, `implement` = 198. Los presupuestos en
`templates/contract/budgets.yml` confirman que solo el contexto **core**
(`hard.lines: 140`) cabe siempre bajo el límite fijo de 200 líneas del comando
documentado; `spec` tiene `hard.lines: 310` — puede superar 200. Por eso el
texto de bootstrap fija `head -200` solo como comando por defecto (contexto
core) y remite al campo `lines:` de la línea BEGIN —publicado por el change
`20260726-130727`— para los casos en que la salida supera ese límite.

**Retiro de versión — hecho verificado en el propio código y en el historial
git, no supuesto:** el comentario en `src/contract.mjs:39-42` dice que
`BOOTSTRAP_VERSION` se sube "cuando el bloque delimitado cambia de forma que
debe detectarse y re-registrarse en repos consumidores". La instrucción
original de este change asumía que ese re-registro necesita añadir un hash a
`LEGACY_CONTRACT_HASHES`. Se verificó que **eso es incorrecto para el
mecanismo de versiones `BEGIN vN`**: `LEGACY_CONTRACT_HASHES` solo lo usa
`removeLegacyContract` para el artefacto pre-delimitadores
`.changeledger/AGENTS.md` (símlink de una era anterior), un mecanismo
completamente distinto. El retiro de un bloque `BEGIN vN` ya es genérico y
automático vía `applyBootstrap`/`replaceDelimited`: `hasEquivalentReference`
devuelve `false` para cualquier `version !== BOOTSTRAP_VERSION`
(`src/contract.mjs:130`), y `replaceDelimited` marca `status: 'updated'`
siempre que `version < BOOTSTRAP_VERSION`
(`src/contract.mjs:160-163`), sin comparar contenido ni hash. Se confirmó
además en `git log -p -- src/contract.mjs` que los saltos previos 1→2 y 2→3
(`8f9d1...`, commits `4662bf8f`/`48db87b5`) **no** añadieron ninguna entrada a
`LEGACY_CONTRACT_HASHES`. Por lo tanto, subir `BOOTSTRAP_VERSION` a 4 basta:
`checkContract`/`changeledger register` detectan y actualizan cualquier
`BEGIN v3` existente sin cambios adicionales en el conjunto de hashes.
Documentado aquí para que la Especificación no reintroduzca ese requisito
inexistente.

**Changes relacionados** (clasificados vía `changeledger search` y lectura
directa, ninguno reutilizable para este alcance):

- `20260726-130727` (*Publicar el tamaño exacto del contexto en la línea
  BEGIN*, `feature`, `draft`) — publica el campo `lines:<N>` que el nuevo
  texto de bootstrap de este change referencia, y endurece el CLI frente a
  EPIPE; es prerrequisito de ejecución (`depends_on`) de este change.
- `20260726-124833` (*Eliminar el flag --have del contexto*, `refactor`,
  `draft`) — dependencia transitiva vía `20260726-130727`; el texto nuevo de
  bootstrap no reintroduce `--have`/`rev:`.
- `20260726-124835` (*Reescribir el contexto core para enrutar por
  intención*, `feature`, `draft`) — toca `templates/contract/core.md`, no el
  bloque de bootstrap en sí; relación informativa (`related_to`), sin orden de
  ejecución.

## Proposal

Reemplazar `REFERENCE` en `src/contract.mjs` por el siguiente texto (decidido,
adaptado solo donde un hecho verificado lo exigía — ninguno lo exigió):

```
> [!IMPORTANT]
> **ChangeLedger governs this repo.** Before planning, investigating, answering
> or editing anything, run exactly this — it is mandatory, not optional:
>
> `changeledger context 2>&1 | head -200`
>
> - The capture is valid **only if its last line contains
>   `CHANGELEDGER CONTEXT END`**. Nothing before that line is actionable.
> - The core context is bounded and fits within these 200 lines. The `BEGIN`
>   line reports the exact `lines:` count of the full output; if `END` is
>   missing, re-run with `head -<lines + 2>` and read that capture instead.
> - Command not installed (`command not found`) → ChangeLedger is absent:
>   continue the task normally and never emulate it.
> - Command present but failing (any other error or non-zero exit) → stop,
>   report the captured error to the human, and wait for their decision.
> - Run this again as the first action of the first response after any context
>   compaction.
```

Alternativas descartadas:

- **Mantener la regla negativa y solo reforzar la prosa de END.** Descartada:
  no resuelve el problema de fondo — una regla negativa sigue sin ser
  verificable mecánicamente, y la prosa de END sigue viviendo dentro del
  bloque que desaparece al truncarse.
- **Registrar el hash del bloque v3 saliente en `LEGACY_CONTRACT_HASHES`**
  (tal como sugería el encargo original). Descartada tras verificar el
  mecanismo real: el retiro de versiones `BEGIN vN` ya es genérico vía
  comparación numérica de versión (`replaceDelimited`); añadir un hash sería
  código muerto que ningún camino ejecuta. Documentado en Investigation.

Escenarios cubiertos por la especificación: contexto core (comando fijo
`head -200` y condición de validez positiva), distinción comando ausente vs.
comando presente que falla, reintento tras compactación sin `--have`/`rev:`, y
retiro de versión (`BOOTSTRAP_VERSION` 3 → 4) sin registro de hash.

## Specification

### CR1 — El bloque de bootstrap publica el comando acotado exacto

- **Given** un repo recién inicializado (`changeledger init`) o
  re-registrado (`changeledger register`)
- **When** se lee el bloque entre `<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->`
  y `<!-- CHANGELEDGER BOOTSTRAP END -->` en `AGENTS.md`
- **Then** el bloque contiene literalmente el comando
  `` `changeledger context 2>&1 | head -200` ``
- **And** el bloque contiene literalmente la frase
  "run exactly this — it is mandatory, not optional"

### CR2 — Condición de validez positiva sustituye la regla negativa

- **Given** el mismo bloque de bootstrap
- **When** se busca la condición de validez de la captura
- **Then** contiene literalmente "valid **only if its last line contains
  `CHANGELEDGER CONTEXT END`**"
- **And** ya **no** contiene la frase "no pipes, filters, summaries, previews
  or voluntary output limits"

### CR3 — Distinción comando ausente vs. comando presente que falla se preserva

- **Given** el mismo bloque de bootstrap
- **When** se busca la rama de "command not installed"
- **Then** contiene literalmente "Command not installed (`command not
  found`) → ChangeLedger is absent: continue the task normally and never
  emulate it"
- **And** contiene por separado, para el caso de fallo, literalmente
  "Command present but failing (any other error or non-zero exit) → stop,
  report the captured error to the human, and wait for their decision"

### CR4 — Reintento tras compactación, sin `--have` ni `rev:`

- **Given** el mismo bloque de bootstrap
- **When** se busca la instrucción de reintento tras una compactación de
  contexto
- **Then** contiene literalmente "Run this again as the first action of the
  first response after any context compaction"
- **And** el bloque completo no contiene ninguna de las cadenas `--have` ni
  `rev:`

### CR5 — Un bloque `BEGIN v3` se detecta como obsoleto sin registrar hash

- **Given** un `AGENTS.md` de fixture cuyo bloque de bootstrap es
  exactamente `bootstrapBlock(3)` (el `REFERENCE` v3 anterior a este change)
- **When** se llama a `checkContract(repoRoot)` con
  `BOOTSTRAP_VERSION = 4` y sin añadir ninguna entrada nueva a
  `LEGACY_CONTRACT_HASHES`
- **Then** `checkContract` devuelve un error que contiene literalmente
  "has an outdated ChangeLedger reference — run \`changeledger register\`"
- **And** tras ejecutar `changeledger register` sobre ese repo, el bloque
  queda reemplazado byte a byte por `bootstrapBlock(4)` (marcador
  `<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->`)

### CR6 — El `AGENTS.md` de este propio repo queda en v4

- **Given** este repo (spec-ledger) tras implementar este change y ejecutar
  `changeledger register`
- **When** se lee `AGENTS.md` en la raíz del repo
- **Then** contiene el marcador `<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->`
- **And** `changeledger check` no reporta ningún error de referencia de
  contrato para `AGENTS.md`

## Plan

- [ ] Actualizar `REFERENCE` y subir `BOOTSTRAP_VERSION` de 3 a 4 en `src/contract.mjs` con el texto decidido; actualizar en `test/contract.test.mjs` las fixtures que aún esperan la prosa retirada ("no pipes, filters...", "After a compaction...--have <rev>`", líneas 74-86); verify: `node --test test/contract.test.mjs` (CR1, CR2, CR3, CR4)
- [ ] En `test/contract.test.mjs`, añadir una fixture con `bootstrapBlock(3)` literal y verificar que `checkContract` (`src/contract.mjs`) la marca obsoleta y que `changeledger register` la reemplaza por `bootstrapBlock(4)` sin tocar `LEGACY_CONTRACT_HASHES`; verify: `node --test test/contract.test.mjs` (CR5)
- [ ] Ejecutar `changeledger register` (`bin/changeledger.mjs`) sobre este propio repo para regenerar `AGENTS.md` con el bloque v4; verify: `node bin/changeledger.mjs check` (CR6)
- [ ] Ejecutar la suite completa tras la implementación; verify: `pnpm verify` (support)

## Log

- **2026-07-26T13:00:00Z** `[note]` Redactada la especificación completa
  (Request, Investigation, Proposal, Specification, Plan) a partir del diseño
  decidido por el humano. Investigation corrige una asunción del encargo: el
  retiro de `BOOTSTRAP_VERSION` no requiere registrar un hash en
  `LEGACY_CONTRACT_HASHES` — ese mecanismo es exclusivo del artefacto legacy
  pre-delimitadores; el retiro de bloques `BEGIN vN` ya es genérico por
  comparación numérica de versión, verificado en código y en
  `git log -p -- src/contract.mjs` (saltos 1→2 y 2→3 no tocaron el conjunto de
  hashes).
- **2026-07-26T14:00:00Z** `[note]` Documento narrowed: se extrajo la
  superficie CLI OUTPUT (`lines:<N>` en la línea BEGIN para core/modo/
  change-id, la composición en `composeResult`/`beginDelimiter`, el
  endurecimiento EPIPE y sus CRs de verificación) al change nuevo
  `20260726-130727`, que ahora es dependencia de este. Este documento
  conserva únicamente la superficie CONTRACT: el texto de `REFERENCE`, el
  salto de `BOOTSTRAP_VERSION` y el retiro del bloque v3. Ninguna sustancia se
  perdió: cada CR y tarea removidos aquí reaparecen sin cambios de fondo en
  `20260726-130727`.
- **2026-07-26T14:05:40Z** `[status]` draft → approved
