---
id: "20260615-175734"
title: La resolución parcial de IDs puede modificar el change equivocado
type: bug
status: done
created: 2026-06-15T17:57:34Z
depends_on: []
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Evitar que comandos mutables acepten IDs parciales o ambiguos y terminen
modificando el primer archivo cuyo nombre comparte el prefijo. Un ID de change
debe resolverse por igualdad exacta con el `frontmatter.id`.

## Investigation

- `locate` en `src/commands/agent.mjs` y `resolveChange` en
  `src/commands/graduate.mjs` buscan archivos con
  `name.startsWith(\`${id}-\`)`.
- Como los IDs timestamp comparten prefijos, un valor truncado puede coincidir
  con varios archivos. `readdirSync().find(...)` elige el primero según el orden
  devuelto por el filesystem.
- Comandos como `status`, `review`, `owner`, `archive`, `log`, `task`, `graduate`
  y `skip` pueden escribir en un change distinto del solicitado.
- `show` compara el ID parseado por igualdad, pero la lógica está duplicada y no
  existe un resolvedor único para queries y mutaciones.
- El validador comprueba que nombre e ID coincidan, pero los comandos no deben
  depender de que el usuario haya ejecutado antes `sl check`.

## Specification

### CR1 — ID exacto resuelve un único change
- **Given** un change cuyo frontmatter contiene un ID completo válido
- **When** cualquier comando lo recibe
- **Then** resuelve exactamente ese archivo
- **And** conserva el comportamiento actual del comando

### CR2 — ID parcial se rechaza sin escribir
- **Given** varios changes que comparten un prefijo de timestamp
- **When** `status`, `review`, `owner`, `archive`, `log`, `task` o `graduate`
  recibe ese prefijo
- **Then** falla indicando que no existe un change con ese ID exacto
- **And** ningún archivo cambia

### CR3 — Nombre engañoso no sustituye al frontmatter
- **Given** un archivo cuyo nombre comienza por el ID solicitado pero cuyo
  `frontmatter.id` es distinto o inválido
- **When** se intenta resolver el change
- **Then** no se acepta como coincidencia exacta
- **And** el error puede recomendar ejecutar `sl check`

### CR4 — Queries y mutaciones usan una sola autoridad
- **Given** los comandos que localizan changes
- **When** se revisa su implementación
- **Then** comparten un resolvedor exacto
- **And** no quedan búsquedas independientes por prefijo

## Plan

- [x] Añadir tests end-to-end con IDs que comparten prefijo y comprobar ausencia de escrituras ante ID parcial (CR1, CR2, CR3) — 2026-06-15T18:42:28Z
- [x] Introducir un resolvedor compartido que lea y compare `frontmatter.id` por igualdad exacta (CR1, CR3, CR4) — 2026-06-15T18:42:28Z
- [x] Migrar comandos de agente, graduación y queries al resolvedor único con errores consistentes (CR1, CR2, CR4) — 2026-06-15T18:42:28Z
- [x] Ejecutar `pnpm verify` y smoke CLI desde el tarball (CR1, CR2) — 2026-06-15T18:42:28Z

## Log
- **2026-06-15T18:29:27Z** — status: draft → approved
- **2026-06-15T18:40:01Z** — status: approved → in-progress
- **2026-06-15T18:40:02Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T18:42:28Z** — fix: resolvedor único en repo.mjs compara frontmatter.id por igualdad exacta; agent.locate y graduate migrados; sin búsquedas por prefijo (CR1-CR4)
- **2026-06-15T18:42:38Z** — status: in-progress → in-review
- **2026-06-15T18:43:49Z** — review → done (delegated subagent, clean context)
- **2026-06-15T20:47:34Z** — graduation skipped: bug de resolución de id; sin verdad persistente nueva
