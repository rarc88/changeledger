---
id: "20260812-025623"
title: El contador de spawns del undo se salta Windows con razón
type: quick
status: in-progress
created: 2026-08-12T02:56:23Z
depends_on: []
branch: quick/20260812-025623
related_to: ["20260810-181802"]
owner: rarc88
---

## Request

Última capa del CI de Windows: `20260810-181802 CR1` cuenta spawns de git
con un shim de PATH (`#!/bin/sh` + `sh -c 'command -v git'`) — técnica
POSIX; en Windows además el env del hijo se construye con la clave `PATH`
cuando la real es `Path`, y el hijo pierde git entero (`spawnSync git
ENOENT`). El criterio (la enumeración del undo no crece con N) es de lógica
independiente del SO y queda medido en macOS/linux: el test se salta en
win32 con `skip` y razón explícita, en vez de portar el shim a
cmd/PATHEXT — coste sin beneficio de cobertura real.

## Log
- **2026-08-12T02:56:25Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T02:56:26Z** `[status]` approved → in-progress
- **2026-08-12T02:56:26Z** `[branch]` set: quick/20260812-025623 (auto)
- **2026-08-12T02:58:25Z** `[note]` Skip con razón en win32 para el contador de spawns (técnica sh/PATH POSIX-only; en Windows además el env del hijo perdía git por la clave PATH vs Path). El criterio queda medido en macOS/linux; en local sigue corriendo (skip no dispara)
- **2026-08-12T02:58:25Z** `[status]` in-progress → in-validation
- **2026-08-12T03:07:56Z** `[validation]` in-validation → in-progress (agent rejected): Mismo concern, segundo asiento: el shim sh de edit.test CR8 (carrera CAS de newChangeFrom) tampoco ejecuta en win32 — Missing expected exception; extender el skip con razón
- **2026-08-12T03:09:40Z** `[note]` Segundo asiento del mismo concern: skip con razón en edit.test CR8 (el shim sh que escenifica la carrera CAS no ejecuta en win32); la propagación queda pineada en POSIX. Los shims de repo.test pasan en Windows empíricamente y no se tocan
- **2026-08-12T03:09:40Z** `[status]` in-progress → in-validation
- **2026-08-12T03:17:18Z** `[validation]` in-validation → in-progress (agent rejected): Tercer asiento de la clase: import.test 004608 CR1 escenifica la carrera CAS con 'command -v git' (POSIX); skip con razón en win32 — censo barrido: es el último shim sin guardar (cutover/edit ya guardados, repo.test pasa empíricamente en Windows)
- **2026-08-12T03:18:30Z** `[note]` Tercer asiento: skip en import.test 004608 CR1 (shim de carrera con command -v). Censo de la clase cerrado: cutover CR1-spawns, edit CR8 e import CR1 guardados; repo.test countGitSpawns pasa en Windows empíricamente y queda fuera
