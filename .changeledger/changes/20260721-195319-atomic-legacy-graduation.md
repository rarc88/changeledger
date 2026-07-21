---
id: "20260721-195319"
title: Evitar graduaciones legacy parcialmente aplicadas
type: bug
status: done
created: 2026-07-21T19:53:19Z
depends_on: []
owner: Roberto Ruiz
related_to: ["20260613-205854"]
release_impact: patch
---

## Request

En el almacenamiento legacy, `graduate --into` actualiza dos archivos: la spec
durable y el change que registra la graduación. Si la actualización del change
falla después de escribir la spec, el repositorio queda parcialmente aplicado y
`check` encuentra enlaces inconsistentes. Un error capturable debe restaurar la
spec original y dejar el change intacto.

## Investigation

`src/commands/graduate.mjs` ejecuta `writeFileAtomic(specFile, updatedSpec)`
dentro del callback de `mutateFileAtomic(changeFile, ...)`. El helper de change
solo escribe su resultado después de que el callback retorna. Por tanto, un
fallo posterior al write de la spec —lock, validación final, temp file o rename
del change— propaga la excepción pero no revierte el primer archivo.

El prototipo `codex/global-state-branch@6ac08826` conservó `originalSpec` y la
restauró cuando la mutación del change fallaba en modo legacy. Esa corrección es
general y no depende de la rama de estado. Debe extraerse con fault injection,
sin traer la lógica de “spec canónica en integración” que solo existía porque el
prototipo separaba changes y specs.

`20260613-205854` introdujo la graduación y su vínculo bidireccional. Está
terminado y es contexto. Este bug mantiene el formato y el flujo `--new`/`--into`.

El alcance se limita a errores que el proceso puede capturar. Dos renames de
filesystem no forman una transacción ante `SIGKILL`, pérdida de energía o fallo
del disco durante la recuperación. El snapshot Git v2 resolverá esa garantía
con un solo commit; añadir ahora un journal persistente al modo legacy sería una
segunda arquitectura transitoria sin evidencia que la justifique.

## Specification

### CR1 — Fallo del change restaura la spec
- **Given** un change `done`, una spec refinada sin marcador y sus bytes originales `B0`
- **When** `graduate --into` escribe temporalmente la spec actualizada pero la mutación atómica del change falla antes de reemplazarlo
- **Then** la spec vuelve byte-for-byte a `B0`
- **And** el change permanece sin evento de graduación y sin `reviewed: true`
- **And** el comando propaga el error original

### CR2 — Fallo de la spec no toca el change
- **Given** el mismo change y una escritura de spec que falla antes de reemplazarla
- **When** se ejecuta `graduate --into`
- **Then** la spec y el change permanecen byte-for-byte iguales
- **And** el comando propaga el error de escritura

### CR3 — Éxito conserva el contrato actual
- **Given** un change `done` y una spec refinada válida
- **When** ambas escrituras terminan correctamente
- **Then** la spec contiene el id en `graduated_from`
- **And** el change contiene el evento `graduation` hacia esa spec y `reviewed: true`
- **And** el valor de retorno y la salida CLI legacy no cambian

### CR4 — Fallo de recuperación es explícito
- **Given** que falla la mutación del change y también falla restaurar la spec original
- **When** termina el intento de recuperación
- **Then** el comando falla con `graduation failed and spec rollback failed: <spec-path>`
- **And** conserva el error original y el error de rollback como causas diagnósticas
- **And** no afirma que la graduación fue revertida o completada

### CR5 — Otros modos no adquieren una transacción falsa
- **Given** `graduate --new`, `graduate --skip` o un repositorio futuro incompatible
- **When** se ejecuta el comando correspondiente
- **Then** conserva su semántica de una sola autoridad y sus guards existentes
- **And** este bug no crea journals, commits Git ni fallback de estado global

## Plan

- [x] Añadir seams de inyección en `src/commands/graduate.mjs` y tests fallidos de spec/change en `test/graduate.test.mjs` sin alterar la API pública; verify: `node --test test/graduate.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-21T21:05:27Z`
- [x] Capturar los bytes originales y restaurarlos en el orquestador legacy de `src/commands/graduate.mjs`, fuera del callback de transformación; verify: `node --test test/graduate.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-21T21:05:27Z`
- [x] Añadir un fallo doble y preservar ambas causas en `src/commands/graduate.mjs`; verify: `node --test test/graduate.test.mjs` (CR4)
  - **Resolved:** `2026-07-21T21:05:28Z`
- [x] Ejecutar regresiones de `src/commands/graduate.mjs` para scaffold/skip/schema y el gate completo; verify: `node --test test/graduate.test.mjs test/config-migration.test.mjs && pnpm verify` (CR3, CR5)
  - **Resolved:** `2026-07-21T21:07:00Z`

## Log

- **2026-07-21T19:53:19Z** `[note]` Extraído del prototipo como corrección legacy independiente; la atomicidad ante crash queda deliberadamente reservada al snapshot Git v2.
- **2026-07-21T20:03:17Z** `[status]` draft → approved (human via conversation)
- **2026-07-21T21:02:23Z** `[status]` approved → in-progress
- **2026-07-21T21:02:23Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-21T21:05:28Z** `[note]` Implementada compensación legacy: la spec se restaura tras un fallo del change y el fallo doble conserva ambas causas diagnósticas.
- **2026-07-21T21:07:00Z** `[status]` in-progress → in-review
- **2026-07-21T21:10:11Z** `[review]` in-review → in-progress (retry): P1: no distinguir error de cleanup posterior al commit del change puede restaurar la spec y recrear inconsistencia; P2: falta lock de spec durante change y rollback.
- **2026-07-21T21:12:10Z** `[status]` in-progress → in-review
- **2026-07-21T21:14:13Z** `[review]` in-review → in-progress (retry): P1: inferir el commit releyendo el change falla si esa lectura falla; se requiere señal explícita después del reemplazo atómico.
- **2026-07-21T21:15:09Z** `[note]` Corrección tras dos revisiones: el commit del change se señala tras su rename atómico y la spec queda bloqueada durante escritura y rollback.
- **2026-07-21T21:15:32Z** `[status]` in-progress → in-review
- **2026-07-21T21:17:37Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-21T21:21:30Z** `[validation]` in-validation → done (human accepted via conversation)
