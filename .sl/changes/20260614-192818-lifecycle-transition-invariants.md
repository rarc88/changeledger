---
id: "20260614-192818"
title: Hacer cumplir transiciones de lifecycle y graduacion
type: bug
status: done
created: 2026-06-14T19:28:18Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Hacer cumplir el lifecycle documentado en todos los comandos de escritura:
rechazar saltos o regresiones inválidas, y permitir graduar únicamente changes
terminados.

## Investigation

- `status()` comprueba que el estado destino pertenece a `config.statuses`, pero
  no valida la transición desde el estado actual.
- Hoy son posibles saltos como `draft → done`, regresar desde `done` o marcar
  `blocked` desde estados no activos.
- El visor restringe `draft → approved`, pero el CLI —que es la autoridad de
  escritura general— no aplica el grafo del contrato.
- `skipGraduation` exige `done`; `graduate` no, por lo que dos caminos de la
  misma operación tienen invariantes distintos.
- Las reglas deben derivarse de un modelo explícito y testable, no de la posición
  incidental en `statuses`.

## Specification

### CR1 — Happy path permitido
- **Given** un change en `draft`
- **When** transita `draft → approved → in-progress → done`
- **Then** cada transición se escribe y registra en Log

### CR2 — Bloqueo reversible
- **Given** un change en `in-progress`
- **When** transita a `blocked` y después vuelve a `in-progress`
- **Then** ambas transiciones están permitidas

### CR3 — Saltos y regresiones se rechazan
- **Given** un change en `draft` o `done`
- **When** se intenta `draft → done`, `done → in-progress` o repetir el mismo
  estado
- **Then** el comando falla con la transición concreta
- **And** el archivo queda byte-for-byte igual

### CR4 — Graduación solo desde done
- **Given** un change cuyo status no es `done`
- **When** se ejecuta `sl graduate <id> <slug>`
- **Then** falla antes de crear el spec o modificar el change

### CR5 — CLI y visor comparten autoridad
- **Given** una transición solicitada por CLI o por visor
- **When** se valida
- **Then** usa la misma función de dominio para decidir si es válida
- **And** el visor mantiene su restricción adicional de solo aprobación humana

## Plan

- [x] Modelar las transiciones permitidas en un helper puro de lifecycle — 2026-06-15T11:47:15Z
- [x] Aplicar el helper en `status()` antes de cualquier mutación y preservar atomicidad ante error — 2026-06-15T11:47:16Z
- [x] Exigir `status: done` en `graduate()` antes de crear archivos — 2026-06-15T11:47:16Z
- [x] Reutilizar la validación de dominio desde el endpoint del visor manteniendo la política humana adicional — 2026-06-15T11:47:16Z
- [x] Añadir tests de happy path, blocked reversible, saltos, regresiones, no-op y graduación prematura — 2026-06-15T11:47:16Z
- [x] Actualizar contrato/spec de arquitectura y ejecutar `pnpm verify` (CR1, CR2, CR3, CR4, CR5) — 2026-06-15T11:47:16Z

## Log
- **2026-06-15T11:38:40Z** — status: draft → approved
- **2026-06-15T11:45:19Z** — status: approved → in-progress
- **2026-06-15T11:45:19Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T11:47:16Z** — status: in-progress → done
- **2026-06-15T21:16:52Z** — graduation skipped: bug de invariantes de lifecycle; sin verdad persistente nueva
- **2026-06-15T21:17:58Z** — archived
