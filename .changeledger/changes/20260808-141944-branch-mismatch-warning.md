---
id: "20260808-141944"
title: Avisar la discrepancia entre el checkout y la rama registrada
type: feature
status: done
created: 2026-08-08T14:19:44Z
depends_on: []
reviewed: true
related_to: ["20260805-052741", "20260726-124836"]
owner: rarc88
---

## Request

El campo `branch` (`20260805-052741`) se autoasigna una sola vez, al entrar en
`in-progress`, y nunca se reescribe. Si el trabajo continúa después en otra
rama — algo legítimo y frecuente en la práctica — el campo queda mintiendo y
**nada lo detecta**: existe `changeledger branch <id> <name>` para corregirlo,
pero depende de que alguien se acuerde. Es el criterio de enforceability: una
regla que puede incumplirse sin que nadie se dé cuenta necesita un guard.

Se pide que las transiciones agent-owned comparen la rama real del checkout
con la registrada en el frontmatter y, si difieren, lo reporten como aviso —
sin bloquear la transición y sin reescribir nada. La mudanza de rama es
legítima; lo que no es admisible es que sea invisible.

## Investigation

- `status()` en `src/commands/agent.mjs` ya recibe `checkoutBranch` como
  parámetro inyectable (patrón idéntico a `ownerHandle`), pero solo lo
  resuelve dentro del bloque de autoasignación: al entrar en `in-progress` y
  únicamente si `!fm.branch`. En el resto de transiciones
  (`in-review`, `in-validation`, `blocked`, `in-progress` con `branch` ya
  fijado) la rama actual no se consulta, así que hoy no hay ningún punto donde
  la discrepancia pueda observarse.
- `checkoutBranch(cwd)` en `src/git.mjs` es tolerante por diseño: devuelve
  `''` en detached HEAD, en rama unborn o si el subproceso git falla. Un aviso
  solo tiene sentido cuando **ambos** valores son no vacíos: con `''` no hay
  hecho que comparar y el silencio es lo correcto.
- `status()` devuelve la ruta del archivo (`return file`) y el bin imprime
  `#<id> → <status>` por stdout tras la llamada (`bin/changeledger.mjs`,
  action del comando `status`). No existe hoy ningún canal de avisos en esa
  vía: para que el aviso sea testeable de forma determinista y visible en la
  CLI hace falta que `status()` lo devuelva como dato y que el bin lo emita.
- La vía de corrección ya existe y no se toca: `changeledger branch <id>
  <name>` fija el valor y deja evento `[branch]` en el Log; el historial de
  mudanzas corregidas ya queda auditado (`20260805-052741`, CR4/CR5).
- Precedentes clasificados: `20260805-052741` es el origen del campo y de la
  decisión explícita de no reescribir en cada mutación (su alternativa
  descartada «reescribir `branch` en cada mutación» sigue vigente: este change
  no la reabre — avisar no es reescribir). `20260726-124836` es el modelo
  `owner` que el campo replica; `owner` no tiene guard equivalente porque un
  owner desactualizado se nota en la conversación, mientras que una rama
  desactualizada no la nota nadie. Ambos van en `related_to`: no bloquean —
  el campo ya está integrado en `dev`.
- El enlace durable doc→código no es este campo sino los markers `[#<id>]` de
  los commits (`changeledger check --commits`); el campo `branch` es el puntero
  vivo durante la vida activa del change. Este guard protege exactamente esa
  ventana, que es donde el puntero tiene valor.

## Proposal

Detección de discrepancia como dato retornado, emisión por stderr en el bin.

- `status()` en `src/commands/agent.mjs`: en **toda** transición, si
  `fm.branch` es no vacío, resolver `checkoutBranch(path.dirname(file))`; si
  el resultado es no vacío y distinto de `fm.branch`, añadir un aviso. La
  firma de retorno pasa de `file` a `{ file, warnings }` — corte limpio, se
  adaptan los call sites del bin; sin shim de compatibilidad.
- El texto del aviso nombra los dos hechos y la vía de corrección:
  `change #<id> records branch "<registrada>" but this checkout is on
  "<actual>" — if the work moved, run: changeledger branch <id> <actual>`.
- `bin/changeledger.mjs`: el action de `status` imprime cada aviso por
  **stderr** y mantiene el resultado por stdout, para no romper consumo
  automatizado de la salida.
- La sección «Log y branch» de `.changeledger/specs/lifecycle.md` gana una
  línea: la discrepancia entre checkout y campo se reporta como aviso en las
  transiciones, nunca bloquea ni reescribe.

### Alternativas descartadas

- **Reescribir `branch` automáticamente al detectar la mudanza.** Ya
  descartada en `20260805-052741` y sigue siendo válida: escritura silenciosa
  de frontmatter que nadie pidió, y la primera transición desde una rama
  equivocada (un checkout accidental) corrompería el dato bueno.
- **Bloquear la transición.** Excesivo: mover el trabajo de rama es legítimo;
  el defecto es la invisibilidad, no la mudanza.
- **Avisar solo al entrar en `in-progress`.** Detecta la mudanza tarde o
  nunca: la ventana típica es continuar en otra rama un change que ya está
  `in-progress`, y su siguiente transición es `in-review`.
- **Registrar el aviso como evento de Log.** El Log es del change y la
  discrepancia es del checkout que ejecuta el comando: registrarla mutaría el
  documento por una condición ambiental y repetiría el evento en cada
  transición hasta la corrección.

## Specification

### CR1 — La discrepancia en una transición produce un aviso sin bloquear
- **Given** un change `in-progress` con `branch: feature/x` en frontmatter y
  `checkoutBranch` inyectada devolviendo `'feature/y'`
- **When** se ejecuta `status(id, 'in-review', cwd, { checkoutBranch: fake })`
- **Then** el change queda en `in-review`
- **And** el retorno incluye `warnings` con exactamente un elemento que
  contiene `feature/x`, `feature/y` y la cadena `changeledger branch`

### CR2 — Sin discrepancia no hay aviso
- **Given** un change `in-progress` con `branch: feature/x` y `checkoutBranch`
  inyectada devolviendo `'feature/x'`
- **When** se ejecuta la transición a `in-review`
- **Then** el retorno incluye `warnings` como lista vacía

### CR3 — Un checkout irresoluble no produce aviso ni fallo
- **Given** un change `in-progress` con `branch: feature/x` y `checkoutBranch`
  inyectada devolviendo `''`
- **When** se ejecuta la transición a `in-review`
- **Then** la transición se completa sin lanzar excepción
- **And** `warnings` es lista vacía

### CR4 — Sin campo `branch` no hay comparación
- **Given** un change `approved` sin clave `branch` en frontmatter y
  `checkoutBranch` inyectada devolviendo `'feature/y'`
- **When** se ejecuta la transición a `in-progress`
- **Then** el frontmatter gana `branch: feature/y` por la autoasignación ya
  existente (`20260805-052741`)
- **And** `warnings` es lista vacía

### CR5 — El aviso no muta el documento
- **Given** el escenario de CR1
- **When** la transición termina
- **Then** el frontmatter conserva `branch: feature/x`
- **And** el Log gana únicamente el evento `[status]` de la transición, sin
  ningún evento `[branch]` nuevo

### CR6 — El bin emite el aviso por stderr y el resultado por stdout
- **Given** un repositorio de prueba con un change `in-progress` cuyo
  frontmatter registra `branch: feature/x` y un checkout real en una rama con
  otro nombre
- **When** se ejecuta `node bin/changeledger.mjs status <id> in-review`
- **Then** stdout contiene `#<id> → in-review`
- **And** stderr contiene `feature/x` y `changeledger branch`
- **And** el código de salida es `0`

## Plan

- [x] Test primero y detección en `status()`: retorno `{ file, warnings }`,
      comparación en toda transición con guard de valores vacíos
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-08-08T14:47:56Z`
- [x] Adaptar los call sites de `status()` en el bin y emitir avisos por
      stderr
  - **Target:** `bin/changeledger.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-08T14:47:56Z`
- [x] Añadir la línea del aviso a la sección «Log y branch» de la spec de
      lifecycle
  - **Target:** `.changeledger/specs/lifecycle.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Support:**
  - **Resolved:** `2026-08-08T14:47:56Z`
- [x] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-08-08T14:48:40Z`

## Log

- **2026-08-08T14:19:44Z** `[note]` Draft creado a partir de la conversación:
  el campo `branch` se autoasigna una vez y puede quedar mintiendo en silencio
  si el trabajo se muda de rama (happy path señalado por Roberto). Se descartó
  registrar SHAs de commit en el Log — huevo-y-gallina con commits que
  contienen su propio documento, y el rebase los pudre; los markers `[#id]` ya
  dan el enlace durable post-integración. El guard elegido: aviso no
  bloqueante en toda transición agent-owned, modelo owner + detección de
  discrepancia, con corrección por el comando explícito ya existente.
- **2026-08-08T14:35:56Z** `[status]` draft → approved (human via conversation)
- **2026-08-08T14:36:36Z** `[status]` approved → in-progress
- **2026-08-08T14:48:41Z** `[note]` Implementación delegada completa con TDD (evidencia red-green por CR). Ajuste adicional dentro del propósito: la frase preexistente de lifecycle.md que negaba la detección de un checkout distinto quedaba contradicha por el aviso nuevo; se reescribió para que la sección no se contradiga.
- **2026-08-08T14:48:41Z** `[status]` in-progress → in-review
- **2026-08-08T14:49:42Z** `[note]` Review mandate: auditoría completa del diff del change (baseline docs(change):approve..HEAD, un commit de implementación) contra CR1-CR6 y el Plan, incluyendo la edición del orquestador en lifecycle.md, que se somete al mismo estándar que el resto del diff.
- **2026-08-08T14:54:32Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-08T15:09:39Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-08T15:09:56Z** `[graduation]` spec: `lifecycle.md`
