---
id: "20260731-161654"
title: Validar completamente la configuración Git
type: bug
status: in-progress
created: 2026-07-31T16:16:54Z
depends_on: []
related_to: ["20260613-205853", "20260711-210115", "20260711-225637"]
owner: Roberto Ruiz
release_impact: patch
---

## Request

`changeledger check` debe detectar una sección `git` estructuralmente inválida
antes de que otro comando intente consumirla. Hoy una config puede pasar el
gate general y fallar después al resolver `git.integration_branch`; el check no
representa el contrato efectivo del repositorio.

## Investigation

`integrationBranch(config)` acepta una clave ausente o `null`, normaliza un
string no vacío y falla para cualquier otra forma. `checkConfig`, en cambio,
valida mappings como `types`, `release` y `readiness`, pero no inspecciona
`config.git`. Así, `git: dev`, `git: []` o `integration_branch: 7` pueden pasar
`changeledger check` aunque consumidores posteriores fallen.

La rama histórica `codex/state-replica-v2` ya extrajo este defecto del intento
de estado global y lo resolvió sin introducir campos de réplica. La corrección
debe reflejar únicamente el contrato Git público vigente. Claves desconocidas
dentro de `git` permanecen permitidas para conservar extensibilidad.

`20260613-205853` estableció la validación de config; `20260711-210115` declaró
la rama de integración y `20260711-225637` completó su migración y edición en el
viewer. Los tres están terminados y aportan contexto.

## Specification

### CR1 — `git` debe ser un mapping
- **Given** una config válida salvo por `git: dev`, `git: []` o `git: true`
- **When** se ejecuta `changeledger check`
- **Then** falla con `config "git" must be a mapping`
- **And** no lanza una excepción ni modifica la config

### CR2 — `integration_branch` debe cumplir el contrato del accessor
- **Given** una config cuyo `git.integration_branch` es `7`, `false`, `[]` o un string vacío
- **When** se ejecuta `changeledger check`
- **Then** falla con `config "git.integration_branch" must be a non-empty string`
- **And** el diagnóstico coincide con el que produce `integrationBranch(config)`

### CR3 — Ausencia y null conservan la autodetección
- **Given** una config sin `git`, con `git: {}` o con `git.integration_branch: null`
- **When** se ejecutan `changeledger check` e `integrationBranch(config)`
- **Then** el check no reporta error Git y el accessor devuelve `undefined`

### CR4 — Claves Git desconocidas siguen permitidas
- **Given** una config con `git.integration_branch: dev` y `git.provider_option: keep`
- **When** se ejecuta `changeledger check`
- **Then** no reporta error por `provider_option`
- **And** no elimina ni reinterpreta la clave

## Plan

- [x] Escribir primero la matriz de formas Git válidas e inválidas en el validador puro
  - **Target:** `src/check.mjs`, `test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-07-31T17:25:51Z`
- [x] Compartir o contrastar las reglas con `integrationBranch` para impedir deriva diagnóstica
  - **Target:** `src/config.mjs`, `src/check.mjs`, `test/config.test.mjs`, `test/check.test.mjs`
  - **Verify:** `node --test test/config.test.mjs test/check.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-07-31T17:25:52Z`
- [ ] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T17:21:17Z** `[status]` approved → in-progress
- **2026-07-31T17:25:52Z** `[note]` CR1–CR4 red→green: check devolvía [] para git escalar, lista, booleano e integration_branch numérico; 3 regresiones fallaron antes del fix y luego config+check pasaron 154/154. Mutantes del guard mapping, llamada compartida y aceptación de null fallaron por la razón esperada y fueron restaurados por edición.
