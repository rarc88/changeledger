---
id: "20260711-103803"
title: Delimitadores explícitos en el bloque bootstrap
type: feature
status: done
created: 2026-07-11T10:38:03Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

El bloque bootstrap que ChangeLedger inserta en el `AGENTS.md` de cada repo
debe distinguirse claramente del resto del archivo, con delimitadores explícitos
como los que ya usan los contextos (`BEGIN`/`END`). En repos consumidores el
`AGENTS.md` lleva 150-250 líneas de contenido propio alrededor del bloque, y
hoy el bloque solo abre con `<!-- changeledger -->` sin marcador de cierre.

## Investigation

- `ionic-app` (164 líneas) y `backend-laravel` (242 líneas) rodean el bloque
  con estándares de ingeniería propios; el límite del bloque solo se distingue
  por ser un blockquote.
- Sin marcador de cierre, `register` no puede reemplazar el bloque de forma
  robusta ni detectar si un repo tiene un bootstrap desactualizado respecto a
  la versión instalada.
- Los comentarios HTML son el delimitador natural en Markdown: visibles para
  agentes que leen el texto crudo, invisibles en el render de GitHub.

## Proposal

- Envolver el bloque con `<!-- CHANGELEDGER BOOTSTRAP BEGIN v<n> -->` y
  `<!-- CHANGELEDGER BOOTSTRAP END -->`, donde `<n>` es la versión del formato
  del bootstrap (independiente de la versión del paquete).
- `register`: si no hay bloque, lo inserta completo con delimitadores; si
  encuentra BEGIN/END, reemplaza solo el interior (idempotente, contenido
  externo intacto); si encuentra el marcador legacy `<!-- changeledger -->` sin
  cierre, migra el bloque antiguo (marcador + blockquote contiguo) al formato
  nuevo.
- `register` compara la versión del marcador con la actual y actualiza el
  bloque cuando está desactualizado, informándolo en su salida.

Alternativas descartadas:

- Delimitadores visibles tipo `=====` como los contextos: ensucian el render de
  GitHub/viewers para humanos; los contextos son salida de terminal, el
  bootstrap vive en un Markdown renderizado.
- Mantener solo el marcador de apertura: impide el reemplazo delimitado y la
  detección de desactualización.

## Specification

### CR1 — Inserción con delimitadores
- **Given** un repo con `AGENTS.md` sin bloque bootstrap
- **When** se ejecuta `changeledger register`
- **Then** el archivo contiene el bloque completo entre `<!-- CHANGELEDGER BOOTSTRAP BEGIN v<n> -->` y `<!-- CHANGELEDGER BOOTSTRAP END -->`

### CR2 — Reemplazo idempotente
- **Given** un `AGENTS.md` con contenido propio antes y después de un bloque BEGIN/END existente
- **When** se ejecuta `changeledger register` dos veces
- **Then** el contenido fuera de los delimitadores queda byte a byte intacto
- **And** la segunda ejecución no produce ningún cambio en el archivo

### CR3 — Migración del marcador legacy
- **Given** un `AGENTS.md` con el bloque antiguo `<!-- changeledger -->` seguido de su blockquote
- **When** se ejecuta `changeledger register`
- **Then** el bloque antiguo completo queda sustituido por el formato BEGIN/END sin duplicarse

### CR4 — Detección de bootstrap desactualizado
- **Given** un `AGENTS.md` con un bloque BEGIN de versión anterior a la actual
- **When** se ejecuta `changeledger register`
- **Then** el bloque se actualiza a la versión vigente
- **And** la salida informa que el bootstrap estaba desactualizado

## Plan

- [x] Definir los delimitadores versionados junto al texto de referencia en `src/contract.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-11T11:06:31Z`
- [x] Implementar inserción, reemplazo delimitado y migración legacy en `src/commands/register.mjs`
  - **Verify:** `node --test test/register.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-11T11:06:31Z`
- [x] Añadir la comparación de versión y el aviso de desactualización en `src/commands/register.mjs`
  - **Verify:** `node --test test/register.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-07-11T11:06:31Z`
- [x] Alinear `src/commands/init.mjs` con el formato delimitado
  - **Verify:** `pnpm test`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-11T11:06:31Z`
- [x] Regenerar el bloque de `AGENTS.md` de este repo con `changeledger register`
  - **Support:**
  - **Resolved:** `2026-07-11T11:06:32Z`
- [x] Ejecutar `pnpm verify` completo tras la implementación
  - **Support:**
  - **Resolved:** `2026-07-11T11:06:32Z`

## Log
- **2026-07-11T10:47:29Z** `[status]` draft → approved
- **2026-07-11T10:53:36Z** `[status]` approved → in-progress
- **2026-07-11T10:53:36Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T11:06:32Z** `[note]` Integrada implementación delegada (1944632, b765b26): applyBootstrap con insert/replace idempotente/migración legacy, BOOTSTRAP_VERSION=1, aviso de desactualización en register; AGENTS.md regenerado solo en el bloque delimitado; tests legacy de contract/cli actualizados al nuevo marcador. pnpm verify verde.
- **2026-07-11T11:16:22Z** `[status]` in-progress → in-review
- **2026-07-11T11:21:13Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-11T11:37:36Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T15:45:50Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-11T21:54:25Z** `[archive]` archived
