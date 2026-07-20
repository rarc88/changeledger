---
id: "20260617-231423"
title: Registry global debe serializar escrituras concurrentes
type: bug
status: done
created: 2026-06-17T23:14:23Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Resolver el hallazgo de auditoria: el registry global (`~/.spec-ledger/registry.json`)
usa una secuencia read-modify-write sin lock. Dos procesos concurrentes pueden
perder actualizaciones aunque cada escritura individual sea atomica.

## Investigation

`src/registry.mjs` protege la integridad del archivo final con `writeFileAtomic`,
pero `register()` y `remove()` hacen:

1. `readRegistry()`
2. mutacion en memoria
3. `writeRegistry()`

Si dos procesos leen el mismo snapshot antes de escribir, el ultimo writer pisa
la mutacion del primero. Esto no corrompe JSON, pero si puede perder registros de
proyectos o removals.

Solucion: reutilizar el mecanismo de lock existente (`withFileLock` o una
variante equivalente) alrededor de la transaccion completa del registry. La
mutacion debe leer el registry dentro del lock, escribir dentro del lock y
mantener los errores actuales para JSON corrupto.

## Specification

### CR1 — Registros concurrentes no se pierden
- **Given** un registry inicial vacio
- **When** dos procesos registran proyectos distintos al mismo tiempo
- **Then** `registry.json` contiene ambos proyectos
- **And** el archivo queda como JSON valido

### CR2 — Remove concurrente no revive entradas
- **Given** un registry con los proyectos `a` y `b`
- **When** un proceso elimina `a` mientras otro registra `c`
- **Then** `registry.json` contiene `b` y `c`
- **And** no contiene `a`

### CR3 — Registry corrupto sigue fallando sin sobrescribir
- **Given** `registry.json` contiene texto que no es JSON valido
- **When** se ejecuta `sl register`
- **Then** el comando falla con `registry.json is not valid JSON`
- **And** el contenido corrupto queda byte-for-byte igual

## Plan

- [x] Agregar cobertura concurrente en `test/registry.test.mjs` para dos `register()` simultaneos contra `src/registry.mjs`, verificando con `pnpm test` (CR1)
  - **Resolved:** `2026-06-18T10:08:48Z`
- [x] Agregar cobertura en `test/registry.test.mjs` para `remove()` + `register()` concurrentes contra `src/registry.mjs`, verificando con `pnpm test` (CR2)
  - **Resolved:** `2026-06-18T10:08:48Z`
- [x] Envolver la transaccion read-modify-write de `src/registry.mjs` con un lock por `registry.json`, verificando con `pnpm test` (CR1, CR2)
  - **Resolved:** `2026-06-18T10:08:48Z`
- [x] Mantener el comportamiento de registry corrupto en `src/registry.mjs`, verificando con `pnpm test` y `node bin/sl.mjs check` (CR3)
  - **Resolved:** `2026-06-18T10:08:48Z`
- [x] Ejecutar `pnpm verify` como cierre (support)
  - **Resolved:** `2026-06-18T10:08:48Z`

## Log

- **2026-06-17T23:14:29Z** `[note]` creado desde los hallazgos de la auditoria 20260617-225650.
- **2026-06-18T09:47:05Z** `[status]` draft → approved
- **2026-06-18T09:56:47Z** `[status]` approved → in-progress
- **2026-06-18T09:56:47Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-06-18T10:05:52Z** `[status]` in-progress → in-review
- **2026-06-18T10:06:02Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-06-18T10:06:47Z** `[graduation]` spec: `architecture.md`
- **2026-06-18T10:09:09Z** `[archive]` archived
