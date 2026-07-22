---
id: "20260722-202058"
title: Impedir la desaparición silenciosa de verdad en updates de estado
type: bug
status: in-validation
created: 2026-07-22T20:20:58Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260721-193104", "20260721-193101"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (filas THR-1a/THR-8-A)
encontró y el auditor principal confirmó de forma independiente que el estado
evolutivo no tiene protección de contenido: el validador remoto acepta un
commit fast-forward, schema-válido, que elimina por completo un change; el
`inventory_digest` solo ancla el inventario del baseline de migración, no el
snapshot actual. Además `content_validation=verified` sugiere una garantía de
integridad que no existe. Alto según los gates del audit: la expectativa de
«verdad protegida» queda incumplida frente a un escritor autorizado o un
`confirmed` local manipulado.

## Investigation

Dos superficies, misma causa:

1. **Servidor** (`src/state-validation.mjs` vía `validateServerStateRevision`):
   cada snapshot nuevo se valida como cerrado (schema, digest string, ancestría,
   paths) pero nada compara colecciones entre snapshots consecutivos. Un update
   que borra `changes/<id>.md` del árbol pasa todas las reglas; el receipt
   reporta `content_validation=verified`.
2. **Cliente** (`src/ledger-store.mjs:264`): mismo esquema de validación al leer
   `confirmed`; un `confirmed` local manipulado con un snapshot forjado que
   borra un change se sirve con exit 0 (`list` simplemente omite el change);
   solo `sync` se niega a publicarlo por ancestría.

Recalcular un hash del árbol no basta: un escritor autorizado también podría
recalcularlo. La protección tiene que ser una **política semántica** sobre la
transición entre snapshots. Ninguna operación legítima del ciclo de vida hace
desaparecer un documento: `archive` marca `archived: true` en el frontmatter y
lo conserva, `discard` conserva el change en estado `discarded`. Por tanto la
política es estricta y sin excepciones: un documento presente en el snapshot
padre debe existir en el snapshot hijo.

Identidad por colección: un change se identifica por su `id` de frontmatter, un
spec por su nombre de archivo bajo `specs/`, un release por su versión
(archivo bajo `releases/`). En commits con múltiples padres, la política se
evalúa contra **cada** padre del rango validado, no solo contra el primero.

La honestidad del receipt es parte del fix: `content_validation` valida el
contrato del snapshot, no autentica al actor ni garantiza integridad histórica
más allá de esta política.

## Specification

### CR1 — Un update no puede hacer desaparecer verdad
- **Given** protección de estado activa y un update cuyo snapshot nuevo omite
  una identidad presente en cualquiera de sus padres (change por `id`, spec por
  nombre, release por versión)
- **When** el hook valida el update
- **Then** rechaza nombrando commit, colección e identidad desaparecida
- **And** los updates que conservan todas las identidades (incluidos archivados
  y descartados, que mantienen su documento) siguen aceptándose

### CR2 — La lectura local aplica la misma política
- **Given** un `confirmed` local cuyo snapshot omite identidades presentes en su
  padre
- **When** el cliente valida la revisión (lectura o pre-publicación)
- **Then** falla cerrado nombrando lo desaparecido en lugar de servir el
  snapshot como verdad

### CR3 — El receipt no sobrevende
- **Given** cualquier validación con resultado `content_validation`
- **When** se emite el receipt o la documentación lo describe
- **Then** su semántica declarada es «contrato del snapshot validado, incluida
  la no-desaparición de identidades», sin implicar autenticación del actor

## Plan

- [x] Añadir tests fallidos de borrado de change/spec/release en un update (rechazo nombrando colección e identidad, evaluado contra cada padre) y de archivado/descartado aceptados, e implementar la comparación de identidades entre snapshots consecutivos en `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR1)
  - **Resolved:** `2026-07-22T22:55:00Z`
- [x] Añadir test fallido del `confirmed` forjado servido en lectura y aplicar la misma política en la validación de revisión de `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs` (CR2)
  - **Resolved:** `2026-07-22T23:05:00Z`
- [x] Ajustar receipts y documentación para la semántica declarada de `content_validation` en `src/state-capabilities.mjs` y `README.md`; verify: `node --test test/state-capabilities.test.mjs` (CR3)
  - **Resolved:** `2026-07-22T23:10:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T23:15:00Z`

## Log

- **2026-07-22T20:20:58Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (THR-1a/THR-8-A, confirmadas por ambos auditores). La dirección es política semántica de no-desaparición entre snapshots, no un recomputo de hash que un escritor autorizado podría regenerar; incluye honestidad del receipt.
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: identidad exacta por colección (id/nombre/versión), comparación contra cada padre del rango, política estricta sin excepción de archivado (verificado en código: `archive` y `discard` conservan el documento), release_impact corregido a patch.
- **2026-07-22T21:45:37Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T21:45:38Z** `[status]` approved → in-progress
- **2026-07-22T21:45:38Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T23:15:00Z** `[note]` CR1: `validateStateRef` (`src/state-validation.mjs`) compara, para cada commit nuevo del rango, sus identidades (`changes` por id, `specs`/`releases` por nombre) contra las de **cada** uno de sus padres (`git rev-list --parents`, no solo el primero) usando un caché de snapshots por OID; rechaza nombrando colección e identidad si algo desaparece. Un commit merge cuya resolución oculta un borrado ya inexistente en un padre pero presente en el otro se detecta (test dedicado con un conflicto real de dos ramas). Archivar/descartar solo cambia campos del frontmatter, nunca hace desaparecer el documento — verificado, sigue aceptándose. CR2: `loadStateSnapshot` (`src/ledger-store.mjs`) aplica la misma comparación contra el padre git de la revisión leída (confirmed o pending) antes de servirla; un `confirmed` local forjado que borra un change ahora falla cerrado en lugar de servirse con exit 0. Los helpers `snapshotIdentities`/`assertNoDisappearance` viven en `ledger-store.mjs` (nivel más bajo) y `state-validation.mjs` los importa, evitando un ciclo de imports. CR3: evidencia de `content_validation=verified` en `src/state-capabilities.mjs` aclara explícitamente "not an actor authentication"; README documenta la garantía de continuidad de identidad y su límite. Rojo confirmado en los 6 tests nuevos antes del fix; verde después: 141/141 en la suite ampliada (`state-validation`/`ledger-store`/`state-receive`/`state-store`/`state-command`/`ledger-mutations`/`state-capabilities`). Gate completo: 934/934 tests, lint y 234 changes válidos.
- **2026-07-22T22:07:21Z** `[status]` in-progress → in-review
- **2026-07-22T23:20:00Z** `[note]` Reviewer de contexto limpio devolvió `RETRY`: el test de merge original no distinguía "solo primer padre" de "todos los padres" — el identidad borrada faltaba en ambos padres, así que una implementación con el bug original (solo primer padre) también habría pasado el test. Corregido: la nueva identidad (`20260722-000001`) existe **solo** en la rama side (mainline nunca la tuvo), así que comparar solo contra el primer padre no encuentra nada que desaparezca; solo comparar contra el segundo padre lo revela. Verificado empíricamente mutando temporalmente el código a `.slice(0, 1)` en `commitParentsOrRoot` — el test nuevo falla como se espera, confirmando que sí prueba la propiedad multi-padre; restaurado el código correcto. Gate re-ejecutado: 141/141 en la suite ampliada.
- **2026-07-22T22:22:33Z** `[review]` in-review → in-progress (retry): Merge test did not distinguish first-parent-only from all-parents checking; corrected and re-verified
- **2026-07-22T22:22:39Z** `[status]` in-progress → in-review
- **2026-07-22T22:31:28Z** `[review]` in-review → in-validation (delegated subagent, clean context)
