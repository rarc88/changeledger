---
id: "20261012-125611"
title: sync no adopta una revisión remota cuyo mínimo supera la CLI instalada
type: bug
status: in-progress
created: 2026-10-12T12:56:11Z
depends_on: []
branch: bug/20261012-125611
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

- [x] Escribir pruebas fallidas de sync frente a un mínimo remoto superior e inferior
  - **Target:** `test/sync.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-12T13:45:50Z`
- [x] Comparar el mínimo de la revisión remota antes de avanzar o reconciliar
  - **Target:** `src/commands/sync.mjs, src/commands/activate.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-12T13:45:50Z`
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T12:56:11Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:40Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T13:31:53Z** `[status]` approved → in-progress
- **2026-10-12T13:31:53Z** `[branch]` set: bug/20261012-125611 (auto)
- **2026-10-12T13:45:49Z** `[note]` Reproducido con la CLI real antes del cambio: sync salió con 0 tras un fast-forward y tras una reconciliación publicada hacia una revisión con min_cli_version 99.0.0, y después list falló con «ChangeLedger CLI 0.18.0-dev is below this repository's minimum 99.0.0». Implementación: sync llama a assertCliAdmitted sobre la revisión remota cuando la relación es behind o diverged, antes de avanzar, reconciliar o publicar. assertCliAdmitted se trasladó de src/commands/activate.mjs a src/version-guard.mjs, fuera del Target del Plan, porque activate ya importa de sync y la importación inversa habría creado un ciclo. En la reconciliación se compara la config de la revisión remota, no la del árbol mezclado. Mutantes M1–M6 fallaron por la aserción esperada.
