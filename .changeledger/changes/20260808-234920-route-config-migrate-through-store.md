---
id: "20260808-234920"
title: Enrutar config migrate por el store en repos activados
type: bug
status: draft
created: 2026-08-08T23:49:20Z
depends_on: ["20260808-151643"]
related_to: []
owner: rarc88
---

## Request

Hallazgo C de la review de `20260808-151643`, derivado a change dedicado por
decisión humana (2026-08-08): `applyMigration` en `src/config-migration.mjs`
escribe `config.yml` del working tree sin consultar la activación, así que
sobre un repo activado el comando CLI `changeledger config migrate` muta un
archivo que ninguna lectura consume — exactamente la divergencia
lectura/escritura que `20260808-151643` eliminó para las escrituras de config
del viewer (su CR6). La Investigation de aquel change lo excluyó
explícitamente («`config migrate` sobre repos inactivos»), por eso es trabajo
nuevo y no una corrección: la migración de schema sobre el config del
snapshot tiene sus propias preguntas (¿el preview lee del snapshot?, ¿qué
pasa con un worktree config divergente tras el cutover?) que merecen su
propia Investigation.

Nota: la ruta del viewer (`applyConfigMigrationImpl`) ya quedó enrutada en
`20260808-151643`; este change cubre la vía CLI directa y la coherencia del
preview.

## Investigation

Pendiente — se completa al retomar el change. Punto de partida: el hallazgo C
en el Log de `20260808-151643`, `applyMigration` en
`src/config-migration.mjs` (escritura sin gate), y el patrón de enrutado ya
validado en `saveProjectConfigImpl`/`patchProjectConfigImpl`.

## Specification

Pendiente — se redacta con la Investigation al retomar el change.

## Plan

- [ ] Completar Investigation, Specification y este Plan al retomar el change
  - **Support:**

## Log

- **2026-08-08T23:49:20Z** `[note]` Draft creado por decisión humana al
  validar `20260808-151643`: los follow-ups de superficie propia (viewer,
  retornos, test de doble conflicto) se corrigen en aquel change; este cubre
  la vía CLI de config migrate, excluida explícitamente de su alcance. Queda
  en draft hasta su debido momento.
