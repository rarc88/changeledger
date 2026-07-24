---
id: "20260723-235910"
title: Rechazar activation que no apunta a un commit
type: bug
status: done
created: 2026-07-23T23:59:10Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193103", "20260721-193106", "20260723-202646"]
release_impact: patch
---

## Request

El segundo review limpio de `20260723-202646` construyó una
`refs/changeledger/activation` existente que apuntaba a un blob. El lifecycle
intentó resolverla directamente como `<ref>^{commit}`, confundió el status 1
con ref ausente y permitió que deactivate devolviera éxito idempotente dejando
la activation intacta. Una activation existente pero no-commit es estado
inválido, nunca ausencia.

## Investigation

`resolveRefOrNull` mezcla dos preguntas: si el nombre existe y si su objeto pela
a commit. `rev-parse --verify --quiet <ref>^{commit}` devuelve status 1 tanto
cuando la ref falta como cuando existe pero no puede convertirse a commit. Al
reducir ambos casos a `null`, install/deactivate pueden tomar caminos diseñados
solo para ausencia real. La carga ordinaria ya falla más tarde al intentar leer
la authority desde el objeto, pero el lifecycle necesita la misma semántica
antes de declarar idempotencia o ejecutar CAS.

## Specification

### CR1 — Activation no-commit falla explícitamente
- **Given** `refs/changeledger/activation` existe y apunta a un blob, tree o tag que no pela a commit
- **When** install o deactivate inspecciona la activación
- **Then** falla con `state activation ref refs/changeledger/activation must point to a commit`
- **And** nunca trata la activation como ausente ni devuelve éxito idempotente

### CR2 — El rechazo conserva todo el estado
- **Given** activation no-commit y cualquier combinación de confirmed, observed y pending
- **When** install o deactivate rechaza la operación
- **Then** ninguna ref cambia y el receipt conserva `written: false`
- **And** no se crea ni elimina ningún objeto o branch

### CR3 — Ausencia real conserva idempotencia
- **Given** activation, confirmed, observed y pending realmente ausentes y un integration ref completo y resoluble
- **When** se repite deactivate
- **Then** devuelve éxito idempotente con `written: false`

## Plan

- [x] Añadir fixtures SHA-1/SHA-256 con activation a blob y comprobar install/deactivate y refs before/after; verify: `node --test test/state-migration.test.mjs` (support)
  - **Resolved:** `2026-07-24T00:38:07Z`
- [x] Separar existencia y tipo de objeto en `src/state-migration.mjs` antes de install/deactivate; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-24T00:39:17Z`
- [x] Ejecutar `pnpm verify` tras la corrección (support)
  - **Resolved:** `2026-07-24T00:41:01Z`

## Log

- **2026-07-23T23:59:10Z** `[note]` Draft creado al dividir 20260723-202646 después de su segundo rechazo; esta frontera posee solo la clasificación de activation existente no-commit y la preservación del lifecycle.
- **2026-07-24T00:01:35Z** `[status]` draft → approved (human via conversation)
- **2026-07-24T00:35:31Z** `[status]` approved → in-progress
- **2026-07-24T00:35:31Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-24T00:41:01Z** `[note]` Implementación: la activación se resuelve en dos etapas, separando ausencia del nombre y peel a commit; blob/tree/tag no-commit fallan antes del lifecycle. Regresiones SHA-1/SHA-256 verifican install/deactivate, receipt written:false, refs y objetos intactos. Suites focalizadas 101/101 y pnpm verify 1.078/1.078; 241 changes válidos.
- **2026-07-24T00:41:01Z** `[status]` in-progress → in-review
- **2026-07-24T00:51:05Z** `[review]` in-review → in-progress (retry): Una activation en tag peelable valida el commit pero deactivate usa el commit pelado como OID esperado del CAS; Git conserva el OID directo del tag y la desactivación falla como falsa concurrencia. Conservar OID directo y commit pelado por separado y cubrir el lifecycle.
- **2026-07-24T00:54:05Z** `[note]` Corrección del retry: el resolver conserva por separado el OID directo de activation y el commit pelado; install compara el commit pero reporta el OID real, y deactivate valida con el commit y ejecuta CAS con el OID directo. Regresión lifecycle de tag peelable añadida. Focales 102/102 y pnpm verify 1.079/1.079; 241 changes válidos.
- **2026-07-24T00:54:05Z** `[status]` in-progress → in-review
- **2026-07-24T09:26:47Z** `[review]` in-review → in-progress (retry): La ruta CLI enmascara el error contractual: stateFailureReceipt llama repoProvenance, que intenta leer authority desde la activation blob y lanza antes de emitir el receipt written:false. El receipt de fallo debe conservar el error lifecycle original y degradar provenance de forma segura.
- **2026-07-24T09:31:54Z** `[note]` Segunda corrección de review: stateFailureReceipt conserva el error principal si repoProvenance falla por activation inválida, atribuye el repository_path sin interpretar authority y mantiene project_id:null. Regresiones CLI install/deactivate en SHA-1/SHA-256 comprueban JSON, written:false y refs/objetos intactos. Focales 102/102 y pnpm verify 1.079/1.079; 241 changes válidos.
- **2026-07-24T09:31:54Z** `[status]` in-progress → in-review
- **2026-07-24T09:39:53Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:46:00Z** `[validation]` in-validation → done (human accepted)
