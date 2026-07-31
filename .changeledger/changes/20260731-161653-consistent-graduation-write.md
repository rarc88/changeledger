---
id: "20260731-161653"
title: Evitar graduaciones parcialmente registradas
type: bug
status: in-validation
created: 2026-07-31T16:16:53Z
depends_on: []
related_to: ["20260613-205854", "20260718-111457"]
owner: Roberto Ruiz
release_impact: patch
---

## Request

`graduate --into` actualiza dos documentos que deben contar la misma verdad: la
spec incorpora `graduated_from` y el change registra el evento de graduación.
Si la escritura del change falla después de escribir la spec, el repositorio
queda parcialmente aplicado. La operación debe restaurar la spec cuando el
change no llegó a persistirse, sin deshacer una graduación que sí se confirmó.

## Investigation

En `graduate`, `mutateFileAtomic(changeFile, callback)` adquiere el lock del
change y ejecuta el callback antes de reemplazarlo. Dentro de ese callback se
escribe primero `specFile`; solo al retornar se serializa y reemplaza el change.
Un fallo capturable durante el write/rename del change deja la spec modificada y
el change original. No hay lock sobre la spec durante esa ventana ni señal que
distinga «el change no se escribió» de «se escribió y luego falló el cleanup del
lock».

La rama histórica `codex/state-replica-v2` cerró estas fronteras después de dos
rondas de review: bloqueó la spec durante escritura y compensación, añadió una
señal `onCommit` después del reemplazo atómico del change, restauró los bytes
originales solo antes de esa señal y conservó ambas causas cuando también
fallaba el rollback. Esa solución se refiere expresamente al modo de ficheros,
no al almacén de estado descartado.

`20260613-205854` introdujo la graduación en dos fases y `20260718-111457`
estructuró la procedencia de specs. Ambos están terminados y son contexto; este
bug no cambia el modelo de graduación ni su formato.

## Specification

### CR1 — Fallo del change restaura la spec
- **Given** un change `done`, una spec refinada y una inyección que hace fallar el rename atómico del change después de escribir la spec
- **When** se ejecuta `graduate <id> <slug> --into`
- **Then** se propaga el error original de escritura del change
- **And** change y spec quedan byte por byte como antes de la operación

### CR2 — Fallo de la spec no toca el change
- **Given** el mismo par de documentos y una inyección que hace fallar la escritura atómica de la spec
- **When** se ejecuta la graduación
- **Then** se propaga el error original de escritura de la spec
- **And** ninguno de los dos documentos cambia

### CR3 — Un change confirmado nunca se deshace
- **Given** una graduación cuyo change ya fue reemplazado atómicamente y cuyo cleanup de lock falla después
- **When** el error de cleanup se propaga
- **Then** la spec conserva `graduated_from: [<id>]`
- **And** el change conserva `reviewed: true` y su evento `graduation`

### CR4 — La spec permanece bloqueada hasta terminar la compensación
- **Given** una graduación que escribió la spec y después falla al escribir el change
- **When** se restaura la spec original
- **Then** el lock de la spec permanece adquirido desde su primera lectura hasta terminar el rollback
- **And** ninguna segunda graduación puede observar o reemplazar el estado intermedio

### CR5 — Un rollback fallido conserva ambas causas
- **Given** un error `change rename failed` seguido por un error `spec rollback rename failed`
- **When** también falla la restauración de la spec
- **Then** se lanza un `AggregateError` con mensaje `graduation failed and spec rollback failed: <specFile>`
- **And** `cause` es el error del change y `errors` contiene, en orden, el error del change y el del rollback

## Plan

- [x] Escribir primero fault-injection tests para fallos de spec, change, cleanup y rollback
  - **Target:** `test/graduate.test.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-07-31T17:12:18Z`
- [x] Añadir una señal posterior al reemplazo atómico sin cambiar el comportamiento de los demás consumidores
  - **Target:** `src/atomic-write.mjs`, `test/atomic-write.test.mjs`
  - **Verify:** `node --test test/atomic-write.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-07-31T17:12:18Z`
- [x] Mantener bloqueada la spec y compensarla únicamente cuando el change no se confirmó
  - **Target:** `src/commands/graduate.mjs`, `test/graduate.test.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-07-31T17:12:18Z`
- [x] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-31T17:13:50Z`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T17:02:37Z** `[status]` approved → in-progress
- **2026-07-31T17:12:18Z** `[note]` CR1–CR5 red→green: reproducción dejó change intacto y spec modificada; 6 fault-injection tests fallaron antes de la implementación y luego la selección pasó 36/36. Mutantes de rollback, onCommit, changeCommitted, lock de spec y orden de AggregateError fallaron por la razón esperada y fueron restaurados por edición.
- **2026-07-31T17:13:50Z** `[note]` Gate completo verde fuera del sandbox: Biome, 1056/1056 tests y changeledger check (1 válido).
- **2026-07-31T17:13:50Z** `[status]` in-progress → in-review
- **2026-07-31T17:14:36Z** `[note]` Mandato de revisión: auditoría completa de CR1–CR5, señal onCommit, lock de spec, compensación, AggregateError y ausencia de regresiones en consumidores de mutateFileAtomic.
- **2026-07-31T17:20:38Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-31T18:57:39Z** `[note]` Handoff: revisión independiente aprobada; candidato listo para validación humana en esta rama autosuficiente.
