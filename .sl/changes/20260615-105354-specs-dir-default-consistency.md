---
id: "20260615-105354"
title: Unificar el default de specs_dir entre graduate y loadRepo
type: bug
status: done
created: 2026-06-15T10:53:54Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Eliminar la divergencia de default para `specs_dir`: `graduate` asume
`.sl/specs` cuando la clave falta en config, mientras `loadRepo` trata su
ausencia como "no hay specs". El resultado es un spec escrito en disco pero
invisible para el visor y reportado como error por `sl check`.

## Investigation

- `src/commands/graduate.mjs` resuelve `path.join(repoRoot, config.specs_dir ?? '.sl/specs')`.
- `src/repo.mjs` usa `config.specs_dir ? path.join(repoRoot, config.specs_dir) : null`
  y solo carga specs cuando la clave existe.
- Con un config sin `specs_dir`, `sl graduate` crea el archivo en `.sl/specs`,
  pero `loadRepo` devuelve `specs: []`. El visor no lo muestra y `checkSpecs`
  marca el change como "graduated to a missing spec" pese a existir el archivo.
- El template por defecto incluye `specs_dir`, así que el fallo solo aparece con
  config editado a mano; aun así es un default contradictorio que viola
  fail-fast: dos módulos de la misma operación discrepan en silencio.
- `sl check` no valida `specs_dir` en `checkConfig`, por lo que la inconsistencia
  no se detecta.

## Specification

### CR1 — Default único y compartido
- **Given** un `config.yml` sin la clave `specs_dir`
- **When** se ejecutan `graduate` y `loadRepo`
- **Then** ambos resuelven el mismo directorio (o ambos fallan explícitamente)
- **And** un spec graduado es visible para el visor y para `sl check`

### CR2 — Coherencia verificable
- **Given** un repo con la clave omitida o presente
- **When** se ejecuta `sl check`
- **Then** no reporta como faltante un spec que sí existe en disco

## Plan

- [x] Centralizar la resolución de `specs_dir` (incluido su default) en un único punto reutilizado por graduate y loadRepo — 2026-06-15T11:44:28Z
- [x] Cubrir con test el caso de config sin `specs_dir`: graduar y luego cargar/checkear el repo — 2026-06-15T11:44:29Z
- [x] Ejecutar `pnpm verify` (CR1, CR2) — 2026-06-15T11:44:29Z

## Log
- **2026-06-15T11:38:40Z** — status: draft → approved
- **2026-06-15T11:43:36Z** — status: approved → in-progress
- **2026-06-15T11:43:37Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T11:44:29Z** — status: in-progress → done
- **2026-06-15T21:16:52Z** — graduation skipped: bug de default specs_dir; sin verdad persistente nueva
- **2026-06-15T21:17:58Z** — archived
