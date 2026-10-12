---
id: "20261012-125611"
title: sync no adopta una revisión remota cuyo mínimo supera la CLI instalada
type: bug
status: draft
created: 2026-10-12T12:56:11Z
depends_on: []
related_to: ["20260925-130844", "20260924-184354"]
owner: rarc88
---

## Request

`20260925-130844` hizo que `changeledger activate` compare la CLI instalada con
el `min_cli_version` de la revisión que adopta. La revisión de ese change observó
que `changeledger sync` puede adoptar, por fast-forward o por merge, una revisión
remota cuya config declare un mínimo superior a la CLI instalada, y que sólo
después el resto de comandos se negarían a trabajar. Se pide que `sync` compare
el mínimo de la revisión remota antes de adoptarla y falle sin efectos, con el
mismo diagnóstico que el resto de la CLI.

## Investigation

El hook `preAction` de `bin/changeledger.mjs` compara la versión instalada con la
config efectiva local antes de ejecutar `sync`. `src/commands/sync.mjs` trae la
copia remota con `fetchState` y avanza la ref local con `advanceStateRef`
(fast-forward) o con `commitMergedState` (reconciliación), ambos de
`src/state-store.mjs`, sin leer el mínimo de la revisión remota.
`src/commands/activate.mjs` resuelve el caso análogo con `assertCliAdmitted`,
que lee con `readStateConfigText` la config de una revisión y lanza el
diagnóstico de `cliVersionError`. El caso de `sync` está razonado desde el
código y no se ha reproducido todavía.

Interfaces externas: ninguna nueva; `fetch` y `push` de git ya son contratos de
la herramienta.

## Specification

### CR1 — Un fast-forward no adopta un mínimo superior
- **Given** un clon activado y compatible, cuyo remoto publica una revisión descendiente de la local con `min_cli_version: 99.0.0`
- **When** se ejecuta `changeledger sync`
- **Then** termina con código distinto de cero y muestra `ChangeLedger CLI <instalada> is below this repository's minimum 99.0.0; update the global installation.`
- **And** `refs/heads/changeledger/state` conserva su oid y el remoto no cambia

### CR2 — Una reconciliación tampoco lo adopta
- **Given** un clon activado con un commit local propio y un remoto divergente cuya config declara `min_cli_version: 99.0.0`
- **When** se ejecuta `changeledger sync`
- **Then** termina con código distinto de cero con el diagnóstico de CR1, no crea el commit de merge y no publica nada

### CR3 — Un remoto compatible se sincroniza como hoy
- **Given** un clon activado cuyo remoto publica una revisión descendiente con `min_cli_version: 0.1.0`
- **When** se ejecuta `changeledger sync`
- **Then** termina con código cero y la ref local avanza a la revisión remota

## Plan

- [ ] Escribir pruebas fallidas de sync frente a un mínimo remoto superior e inferior
  - **Target:** `test/sync.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
- [ ] Comparar el mínimo de la revisión remota antes de avanzar o reconciliar
  - **Target:** `src/commands/sync.mjs, src/commands/activate.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T12:56:11Z** `[version]` 0.18.0-dev
