---
id: "20260616-162027"
title: Evitar perdida silenciosa del registry corrupto
type: bug
status: done
created: 2026-06-16T16:20:27Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Evitar que un `registry.json` corrupto sea tratado como registry vacio y se
sobrescriba silenciosamente al registrar un proyecto.

## Investigation

`src/registry.mjs` devuelve `{}` si el JSON del registry no puede parsearse.
Despues, `register` escribe el nuevo objeto y puede borrar todas las entradas
anteriores sin que el usuario se entere.

El registry es local y recuperable, pero es la puerta de entrada del viewer
multi-proyecto. Fallar fuerte con un mensaje claro es preferible a perder
informacion silenciosamente.

## Specification

### CR1 — Registry corrupto falla al leer
- **Given** un archivo `registry.json` con el contenido literal `not-json`
- **When** se llama `readRegistry`
- **Then** se lanza un error literal `registry.json is not valid JSON`

### CR2 — Register no sobrescribe registry corrupto
- **Given** un archivo `registry.json` con el contenido literal `not-json`
- **When** se llama `register` con un proyecto valido
- **Then** se lanza un error literal `registry.json is not valid JSON`
- **And** el contenido de `registry.json` sigue siendo exactamente `not-json`

### CR3 — Registry ausente sigue empezando vacio
- **Given** que no existe `registry.json`
- **When** se llama `readRegistry`
- **Then** retorna `{}`

## Plan

- [x] Añadir tests en `test/registry.test.mjs` para `src/registry.mjs` con lectura corrupta, no sobrescritura al registrar y registry ausente (CR1, CR2, CR3) — 2026-06-16T16:31:24Z
- [x] Actualizar `src/registry.mjs` y cubrirlo con `test/registry.test.mjs` para distinguir archivo ausente de JSON invalido y lanzar un error claro en el segundo caso (CR1, CR2, CR3) — 2026-06-16T16:31:27Z
- [x] Revisar `src/commands/register.mjs` y cubrirlo con `test/registry.test.mjs` para que el error llegue al CLI sin borrar datos locales (CR2) — 2026-06-16T16:31:30Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para verificar `src/registry.mjs` y `src/commands/register.mjs` con `test/registry.test.mjs` (CR1, CR2, CR3) — 2026-06-16T16:31:36Z

## Log
- **2026-06-16T16:25:41Z** — status: draft → approved
- **2026-06-16T16:31:01Z** — status: approved → in-progress
- **2026-06-16T16:31:01Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:31:43Z** — status: in-progress → in-review
- **2026-06-16T16:43:22Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:44:49Z** — graduado a spec `architecture.md`
