---
id: "20260613-221110"
title: Identidad de proyecto y registro global
type: feature
status: done
created: 2026-06-13T22:11:10Z
depends_on: ["20260613-134548"]
---

## Request

Trabajamos en varios proyectos a la vez. Para un visor global necesitamos que
cada repo tenga **identidad estable** y un **registro global** que sepa dónde
vive cada uno. Repos movidos o clonados en otro equipo deben poder revincularse.

## Investigation

- Separar **identidad** (viaja con el repo, comprometida) de **ubicación**
  (local a cada máquina).
- `config.yml` lleva `project_id` (aleatorio, estable) + `project_name` (legible).
- Registro global en `~/.spec-ledger/registry.json`: `{ id: { name, path } }`.
- Repo movido / nuevo equipo: el `project_id` no cambia; solo el path en el
  registro → `sl register` lo actualiza.
- `crypto.randomBytes` en Node para el id (10 hex). Sin deps.

## Proposal

- `config.yml`: añadir `project_id` y `project_name` (default = nombre del dir).
- `src/registry.mjs`: leer/escribir el registro global (crea `~/.spec-ledger/`).
  `register({id, name, path})`, `list()`, `remove(id)`.
- `sl init`: genera `project_id`/`project_name` si faltan y registra el path.
- `sl register`: (re)vincula el path actual al `project_id` del config (repo
  movido, clonado, o ya inicializado en otra máquina).
- `sl init` sobre un `.sl/` existente: no clobbea; sugiere `sl register`.

## Specification

### CR1 — init da identidad y registra
- **Given** un repo sin inicializar
- **When** ejecuto `sl init`
- **Then** `config.yml` tiene `project_id` y `project_name`
- **And** el registro global mapea ese id a la ruta del repo

### CR2 — register revincula el path
- **Given** un repo ya inicializado movido a otra ruta
- **When** ejecuto `sl register`
- **Then** el registro actualiza el path de ese `project_id` (no duplica)

### CR3 — id estable entre máquinas
- **Given** un clon del repo en otro equipo (mismo `project_id`)
- **When** ejecuto `sl register`
- **Then** el registro de esa máquina apunta al clon local con el mismo id

### CR4 — init no sobrescribe
- **Given** un repo con `.sl/` existente
- **When** ejecuto `sl init`
- **Then** falla sin clobbear y sugiere `sl register`

## Plan

- [x] `src/registry.mjs` (read/write `~/.spec-ledger/registry.json`) — 2026-06-13T22:15:38Z
- [x] `config.yml` template: `project_id`/`project_name`; generación en `init` — 2026-06-13T22:15:38Z
- [x] `sl init`: generar identidad + registrar; no clobbear (CR1, CR4) — 2026-06-13T22:15:38Z
- [x] `sl register` command (CR2, CR3) — 2026-06-13T22:15:38Z
- [x] Tests (init registra, register revincula, no duplica) — 2026-06-13T22:15:38Z
- [x] Documentar en README y AGENTS.md — 2026-06-13T22:15:38Z

## Log

- **2026-06-13T22:11:10Z** — Creado. Aprobado: id aleatorio + nombre; registro
  global keyado por id; `sl register` para revincular.
- **2026-06-13T22:12:45Z** — status: approved → in-progress
- **2026-06-13T22:15:38Z** — status: in-progress → done
- **2026-06-13T22:15:38Z** — Implementado: registry.mjs, identidad en config (init inyecta id+name), sl register, tests (registro aislado por SPEC_LEDGER_HOME). Este repo registrado como 304c473ce5.
