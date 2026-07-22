---
id: "20260722-202058"
title: Impedir la desaparición silenciosa de verdad en updates de estado
type: bug
status: draft
created: 2026-07-22T20:20:58Z
depends_on: []
related_to: ["20260721-193106", "20260721-193104", "20260721-193101"]
release_impact: minor
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
   paths) pero nada compara colecciones entre el snapshot anterior y el nuevo.
   Un update que borra `changes/<id>.md` del árbol pasa todas las reglas; el
   receipt reporta `content_validation=verified`.
2. **Cliente** (`src/ledger-store.mjs:264`): mismo esquema de validación al leer
   `confirmed`; un `confirmed` local manipulado con un snapshot forjado que
   borra un change se sirve con exit 0 (`list` simplemente omite el change);
   solo `sync` se niega a publicarlo por ancestría.

Recalcular un hash del árbol no basta: un escritor autorizado también podría
recalcularlo. La protección tiene que ser una **política semántica** sobre la
transición entre snapshots: changes/specs/releases no pueden desaparecer de un
snapshot a otro — solo transicionar por el ciclo de vida (p. ej. archivado),
que conserva el documento. La honestidad del receipt es parte del fix:
`content_validation` valida el contrato del snapshot, no autentica al actor.

## Specification

### CR1 — Un update no puede hacer desaparecer verdad
- **Given** protección de estado activa y un update fast-forward cuyo snapshot
  nuevo omite un change, spec o release presente en el snapshot anterior sin
  transición de ciclo de vida que lo conserve (p. ej. archivado)
- **When** el hook valida el update
- **Then** rechaza nombrando commit, colección e identidad desaparecida
- **And** un update que archiva o transiciona legítimamente sigue aceptándose

### CR2 — La lectura local aplica la misma política
- **Given** un `confirmed` local cuyo snapshot omite documentos presentes en su
  padre sin transición que los conserve
- **When** el cliente valida la revisión (lectura o pre-publicación)
- **Then** falla cerrado nombrando lo desaparecido en lugar de servir el
  snapshot como verdad

### CR3 — El receipt no sobrevende
- **Given** cualquier validación con resultado `content_validation`
- **When** se emite el receipt o la documentación lo describe
- **Then** su semántica declarada es «contrato del snapshot validado», sin
  implicar autenticación del actor ni integridad histórica más allá de la
  política de CR1

## Plan

- [ ] Añadir tests fallidos de borrado de change/spec/release en un update fast-forward (rechazo nombrando identidad) y de archivado legítimo aceptado, e implementar la comparación de colecciones entre snapshot padre y nuevo en la validación de `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR1)
- [ ] Añadir test fallido del `confirmed` forjado servido en lectura y aplicar la misma política en la validación de revisión de `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs` (CR2)
- [ ] Ajustar receipts y documentación para la semántica declarada de `content_validation` en `src/state-capabilities.mjs` y `README.md`; verify: `node --test test/state-capabilities.test.mjs` (CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:20:58Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (THR-1a/THR-8-A, confirmadas por ambos auditores). La dirección es política semántica de no-desaparición entre snapshots, no un recomputo de hash que un escritor autorizado podría regenerar; incluye honestidad del receipt.
