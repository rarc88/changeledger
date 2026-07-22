---
id: "20260722-203029"
title: Receipts del CLI con procedencia de proyecto y repositorio
type: bug
status: draft
created: 2026-07-22T20:30:29Z
depends_on: []
related_to: ["20260721-193106", "20260722-190137"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (fila ISO-1.2) encontró
que ningún receipt del CLI — humano ni `--json` — identifica el proyecto ni el
repositorio sobre el que operó: solo un `ledger_revision` opaco con
freshness/confirmación. Un receipt copiado fuera de su terminal no puede
atribuirse a un proyecto sin cruzarlo con el registry. `20260722-190137` cubre
la procedencia de los payloads del viewer; esta es la superficie CLI,
pendiente. Hallazgo medio: sin riesgo de escritura cruzada (el aislamiento se
verificó), pero la atribución inequívoca que exige el audit no se cumple.

## Investigation

`printLedgerRevision` (`bin/changeledger.mjs:211`) y `ledgerReceipt`
(`src/ledger-store.mjs:44`) emiten `ledger_revision`, `ledger_freshness` y
`ledger_confirmation`, sin `project_id` ni path del repositorio. Verificado en
vivo: `approve` imprimió solo `Ledger revision: bb80fd…`; `list --json` solo
`ledger_revision`. El `project_id` está disponible en la config/authority del
repo resuelto al construir el receipt; añadirlo es barato. Contraste: el viewer
ya expone `id`+`path`+`ledger_revision` en `/api/projects` y `/api/repo`.

## Specification

### CR1 — Todo receipt identifica su procedencia
- **Given** cualquier comando del CLI que emita un receipt de ledger (lectura o
  mutación, humano o `--json`)
- **When** se imprime el receipt
- **Then** incluye `project_id` y el path del repositorio junto a la revisión
- **And** el formato humano lo muestra sin romper los consumidores existentes
  del formato JSON (campos aditivos)

### CR2 — La procedencia refleja el repo resuelto, no una selección externa
- **Given** un CLI cuyo cwd pertenece al proyecto B mientras cualquier otra
  superficie tiene seleccionado A
- **When** se emite el receipt
- **Then** la procedencia nombra B (el repo realmente resuelto por cwd)

## Plan

- [ ] Añadir tests fallidos de procedencia en receipts humano y JSON (lectura y mutación) y extender `ledgerReceipt`/`printLedgerRevision` en `src/ledger-store.mjs` y `bin/changeledger.mjs` con `project_id` y path aditivos; verify: `node --test test/cli-bin.test.mjs test/ledger-mutations.test.mjs` (CR1, CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:29Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106 (fila ISO-1.2 de la ejecución paralela): 20260722-190137 cubre los payloads del viewer; esta es la superficie CLI.
