---
id: "20260723-170612"
title: Rechazar modos Git no regulares en el árbol de estado
type: bug
status: in-validation
created: 2026-07-23T17:06:12Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260722-203027", "20260721-193104", "20260722-163405"]
release_impact: patch
---

## Request

La doble auditoría del 2026-07-23 confirmó experimentalmente que el validador del servidor acepta entradas del árbol de estado con modos Git no regulares: un update cuyo change tenía modo `120000` (symlink) pasó `validateStateUpdate` con `ok: true`. El path de creación de la migración sí los rechaza (`regularBlob` en `src/state-migration.mjs`), dejando una asimetría de hardening entre crear y validar.

## Investigation

Causa raíz: los parsers del lado de validación descartan el modo.

- `logRawEntries` (`src/state-validation.mjs`, ~línea 323) parsea `:mode mode oldoid newoid status` pero no restringe el modo del lado nuevo.
- El loader del árbol (`treeEntries`/`parseTreeEntries` en `src/git-batch.mjs` y sus consumidores en `src/ledger-store.mjs`) filtra por `entry.type === 'blob'` sin comprobar `entry.mode`, de modo que un symlink (tipo blob, modo `120000`) entra como documento normal.
- Contraste: `regularBlob` (`src/state-migration.mjs`, ~línea 205) rechaza todo lo que no sea `100644`/`100755` con `migration source <name> contains unsupported Git entry <mode> <type> at <path>`.

Hoy es inerte — el árbol de estado nunca se hace checkout y el contenido se lee como blob sin dereferenciar el symlink; recovery reescribe `100644` — pero la superficie aceptada por el hook difiere de la que la migración puede producir, y cualquier consumidor futuro que materialice el árbol heredaría el riesgo.

Cambios relacionados (contexto): [20260722-203027] introdujo el path incremental que parsea los modos; [20260721-193104] definió el validador remoto; [20260722-163405] estableció el hardening equivalente del lado de migración.

Decisión: rechazar en ambos paths de lectura del estado (incremental y full/baseline) cualquier entrada con modo distinto de `100644`/`100755`, con un mensaje consistente con el de la migración.

## Specification

### CR1 — El path incremental rechaza modos no regulares
- **Given** un update del state ref cuyo commit añade `.changeledger-state/changes/x.md` con modo `120000`
- **When** se ejecuta `validateStateUpdate` sobre ese update
- **Then** el update es rechazado con un error que nombra el modo `120000` y la ruta `.changeledger-state/changes/x.md`
- **And** el receipt refleja el fallo (fail-closed), sin `ok: true`

### CR2 — El path full rechaza modos no regulares
- **Given** un tree de baseline que contiene un spec con modo `120000`
- **When** se carga el snapshot completo con `loadStateSnapshotAt`
- **Then** la carga falla con un error que nombra el modo y la ruta, en lugar de aceptar el symlink como documento

### CR3 — Los modos regulares siguen aceptados
- **Given** un update válido cuyos blobs usan modos `100644` y `100755`
- **When** se ejecuta la validación incremental y la carga full
- **Then** ambos paths aceptan el contenido exactamente igual que antes del cambio

## Plan

- [x] Añadir la comprobación de modo regular compartida en `src/git-batch.mjs` y aplicarla al path incremental de `src/state-validation.mjs`, escribiendo primero el test rojo del update con symlink en `test/state-validation.test.mjs`; verify: `node --test test/state-validation.test.mjs` (CR1)
  - **Resolved:** `2026-07-23T17:55:31Z`
- [x] Aplicar la misma comprobación al loader full de `src/ledger-store.mjs`, con test rojo previo de carga con symlink y regresión de modos regulares en `test/ledger-store.test.mjs`; verify: `node --test test/ledger-store.test.mjs` (CR2, CR3)
  - **Resolved:** `2026-07-23T17:55:31Z`
- [x] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T17:57:14Z`

## Log
- **2026-07-23T17:41:39Z** `[status]` draft → approved (human via conversation)
- **2026-07-23T17:41:39Z** `[status]` approved → in-progress
- **2026-07-23T17:41:39Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T17:41:59Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T17:55:31Z** `[note]` Implementación delegada: guard exportado assertRegularBlobEntry + gitEntryType en git-batch (composable para el rework de 202100); aplicado en logRawEntries (incremental) y por entrada en loadStateTree tras el catch que enmascaraba diagnósticos (por eso ledger-store.mjs se tocó mínimamente). 73/73 en tests de validación y store.
- **2026-07-23T17:57:15Z** `[status]` in-progress → in-review
- **2026-07-23T18:01:12Z** `[review]` in-review → in-validation (delegated subagent, clean context)
