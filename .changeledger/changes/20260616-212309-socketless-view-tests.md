---
id: "20260616-212309"
title: Tests del viewer no deben depender de abrir sockets locales
type: bug
status: done
created: 2026-06-16T21:23:09Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Durante `pnpm verify` en un sandbox restringido, los tests del viewer fallan con
`listen EPERM 127.0.0.1`. La lógica que se quiere validar es del router,
seguridad HTTP y serialización, pero la suite depende de poder abrir un socket
real de loopback.

## Investigation
- `test/view.test.mjs` levanta el servidor HTTP real para validar endpoints.
- En entornos de agente con sandbox de red, abrir `127.0.0.1` puede estar
  bloqueado aunque no haya acceso externo.
- El resultado es una fricción operativa: la puerta completa requiere escalación
  aunque el comportamiento bajo prueba podría ejercitarse en proceso.
- La capa del viewer ya está parcialmente separada entre dominio, router y
  transporte; se puede llevar más lógica al router testeable sin socket.

## Specification
### CR1 — Tests sin socket para comportamiento HTTP
- **Given** un entorno donde `server.listen(127.0.0.1)` falla con `EPERM`
- **When** se ejecutan los tests del router y seguridad del viewer
- **Then** validan status, headers, tokens, body limits y assets sin abrir un socket real

### CR2 — Cobertura de transporte real acotada
- **Given** el comando `sl view` necesita seguir vinculando a loopback en producción
- **When** se ejecuta la cobertura del transporte real
- **Then** existe un test pequeño que valida el bind cuando el entorno lo permite, sin bloquear la suite principal en sandbox

### CR3 — Verify funciona en sandbox
- **Given** un sandbox sin permiso para escuchar en loopback
- **When** se ejecuta `pnpm verify`
- **Then** la suite no falla por `listen EPERM 127.0.0.1`

## Plan
- [x] Extraer o reutilizar helpers de `src/viewer/server/router.mjs` para probar requests/responses en memoria desde `test/view.test.mjs` (CR1, CR3) — 2026-06-17T15:19:05Z
- [x] Reducir el test con socket real de `src/viewer/server/*.mjs` en `test/view.test.mjs` a una cobertura mínima y tolerante al entorno (CR2, CR3) — 2026-06-17T15:19:05Z
- [x] Ejecutar `pnpm test -- test/view.test.mjs` contra `src/viewer/server/router.mjs` y `pnpm verify` sin escalación para confirmar que no depende de loopback real (CR1, CR2, CR3) — 2026-06-17T15:19:06Z

## Log
- **2026-06-16T21:23:09Z** — Creado desde fricción observada: la suite completa requirió escalación porque los tests del viewer abrían `127.0.0.1`.
- **2026-06-17T10:02:17Z** — status: draft → approved
- **2026-06-17T10:36:10Z** — status: approved → in-progress
- **2026-06-17T10:36:10Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T15:21:31Z** — status: in-progress → in-review
- **2026-06-17T15:22:33Z** — review → done (delegated subagent, clean context)
- **2026-06-17T15:22:39Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
