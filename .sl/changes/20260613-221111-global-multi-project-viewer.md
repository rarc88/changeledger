---
id: "20260613-221111"
title: Visor global multiproyecto
type: feature
status: approved
created: 2026-06-13T22:11:11Z
depends_on: ["20260613-221110"]
---

## Request

`sl view` debe ser **global**: leer el registro y mostrar todos los proyectos
registrados, con un selector en la UI, autoenfocando el repo actual si se ejecuta
dentro de uno. `sl view .` muestra solo el actual.

## Investigation

- Depende del registro (`project_id → path`) del change de identidad.
- El server debe servir varios `.sl/` por path; la API necesita dimensión de
  proyecto.
- Paths muertos (repo borrado/movido sin re-register) deben mostrarse
  deshabilitados, no romper.

## Proposal

- Server: `GET /api/projects` (lista del registro con estado vivo/muerto) y
  `GET /api/repo?project=<id>` (el repo de ese proyecto).
- UI: selector de proyecto (sidebar/dropdown); al elegir, carga sus changes/specs.
  Autoselecciona el proyecto del cwd si aplica.
- `sl view` global por defecto; `sl view .` fuerza solo el repo actual.
- Entradas muertas: deshabilitadas en el selector con aviso.

## Specification

### CR1 — Lista de proyectos
- **Given** varios proyectos registrados
- **When** abro `sl view`
- **Then** la UI lista todos y permite cambiar entre ellos

### CR2 — Autoenfoque del actual
- **Given** ejecuto `sl view` dentro de un repo registrado
- **When** carga el visor
- **Then** ese proyecto queda seleccionado por defecto

### CR3 — Carga por proyecto
- **Given** selecciono un proyecto
- **When** se carga
- **Then** muestra sus changes y specs (board/table/graph/specs)

### CR4 — Solo actual
- **Given** ejecuto `sl view .`
- **When** carga
- **Then** muestra únicamente el repo actual

### CR5 — Path muerto
- **Given** un proyecto cuyo path ya no existe
- **When** abro el visor
- **Then** aparece deshabilitado con aviso, sin romper

## Plan

- [ ] Server: `/api/projects` + `/api/repo?project=id` desde el registro
- [ ] UI: selector de proyecto + carga por proyecto (CR1, CR3)
- [ ] Autoenfoque del cwd; `sl view .` solo actual (CR2, CR4)
- [ ] Manejo de paths muertos (CR5)
- [ ] Tests del server multiproyecto
- [ ] Documentar en README

## Log

- **2026-06-13T22:11:11Z** — Creado. Aprobado: `sl view` global con selector,
  autoenfoque del actual, `sl view .` para el repo actual.
