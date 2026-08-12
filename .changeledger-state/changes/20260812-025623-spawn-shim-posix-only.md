---
id: "20260812-025623"
title: El contador de spawns del undo se salta Windows con razón
type: quick
status: approved
created: 2026-08-12T02:56:23Z
depends_on: []
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
