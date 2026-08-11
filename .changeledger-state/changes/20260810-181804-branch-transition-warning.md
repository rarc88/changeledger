---
id: "20260810-181804"
title: Avisar la discrepancia del campo branch en las transiciones
type: feature
status: discarded
created: 2026-08-10T18:18:04Z
depends_on: []
related_to: ["20260805-052741", "20260808-141944"]
owner: rarc88
---

## Request

Pendiente del plan del estado global v3 (origen: PR #3, campo `branch`): en
el mundo consolidado post-cutover el campo `branch` del frontmatter es el
único enlace vivo documento→código, así que una transición de lifecycle
ejecutada desde un checkout que no coincide con la rama registrada merece un
aviso — hoy pasa en silencio y el enlace se degrada sin que nadie lo vea.

La Investigation debe fijar el diseño antes de aprobar: qué transiciones
avisan (¿solo las de agente?, ¿también `commit`?), contra qué se compara
(rama actual del checkout vs `branch` registrado), aviso vs error (la
dirección conversada es aviso: modelo owner + guard, nunca bloquear), y qué
pasa con checkouts detached o worktrees paralelos.

## Investigation

## Proposal

## Specification

## Plan

## Log
- **2026-08-11T14:36:29Z** `[status]` draft → discarded: Ya cubierto por 20260808-141944 (done, graduado): las transiciones agent-owned comparan checkout vs branch registrado y avisan sin bloquear (src/commands/agent.mjs, CR1-CR5 en test/agent.test.mjs, 5/5 verdes hoy). El Request de este draft afirmaba 'hoy pasa en silencio', falso contra el código vigente — el backlog que lo originó era anterior a 141944
