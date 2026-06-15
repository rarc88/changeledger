---
id: "20260615-222616"
title: Recuperar locks huérfanos de sl new
type: bug
status: done
created: 2026-06-15T22:26:16Z
depends_on: ["20260615-214828"]
reviewed: true
owner: Roberto Ruiz
---

## Request

Eliminar el riesgo de que `sl new` quede bloqueado por un lock huérfano si el
proceso muere después de reservar un id y antes de ejecutar el `finally` que
borra `.sl/changes/.<id>.lock`.

## Investigation

La corrección de concurrencia usa un archivo lock oculto con `fs.openSync(lock,
'wx')` y lo borra en `finally`. Eso evita que dos procesos escriban el mismo id,
pero deja una deuda: si el proceso termina abruptamente entre la reserva y la
limpieza, el lock queda en disco. Como el retry interpreta `EEXIST` como "id en
uso", un lock huérfano puede saltarse ids indefinidamente o bloquear un segundo
concreto aunque no exista el change final.

El archivo final ya se escribe con `flag: 'wx'`, así que la solución puede ser
más simple: reservar el archivo final directamente con escritura exclusiva y
rellenarlo en la misma operación, o bien aplicar una política explícita de locks
stale con metadatos y edad máxima. Reservar el archivo final evita un artefacto
temporal adicional y reduce la superficie de fallo.

## Specification

### CR1 — Un lock huérfano no bloquea la creación para siempre
- **Given** existe `.sl/changes/.20260615-120000.lock` sin archivo final asociado
- **When** `sl new` intenta crear un change para ese instante
- **Then** el comando no queda bloqueado por el lock huérfano
- **And** crea un change válido o avanza a otro id de forma determinista

### CR2 — La escritura sigue siendo atómica entre procesos
- **Given** dos procesos ejecutan `sl new` en el mismo segundo
- **When** ambos intentan reservar el mismo id
- **Then** solo uno puede escribir el archivo final de ese id
- **And** el otro reintenta con el siguiente segundo sin sobrescribir nada

### CR3 — No quedan artefactos temporales normales
- **Given** `sl new` termina correctamente
- **When** se lista `.sl/changes`
- **Then** no quedan archivos `.lock` creados por la operación normal

## Plan

- [x] Añadir un test que simule un lock huérfano antes de llamar a `newChange()` (CR1, CR3) — 2026-06-15T22:48:00Z
- [x] Simplificar `src/commands/new.mjs` para depender de escritura exclusiva del archivo final o limpiar locks stale con regla explícita (CR1, CR2, CR3) — 2026-06-15T22:50:12Z
- [x] Mantener los tests existentes de concurrencia, no-overwrite y coherencia `id`/`created` (CR2) — 2026-06-15T22:48:00Z
- [x] Ejecutar `pnpm test -- test/cli.test.mjs` y `pnpm check` (CR1, CR2, CR3) — 2026-06-15T22:48:00Z

## Log
- **2026-06-15T22:38:25Z** — status: draft → approved
- **2026-06-15T22:46:47Z** — status: approved → in-progress
- **2026-06-15T22:46:47Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:48:04Z** — status: in-progress → in-review
- **2026-06-15T22:49:48Z** — review → in-progress (retry): TOCTOU en isStaleLock y Plan pendiente detectados por revisión independiente
- **2026-06-15T22:50:13Z** — status: in-progress → in-review
- **2026-06-15T22:51:04Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:51:10Z** — graduado a spec `architecture.md`
