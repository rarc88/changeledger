---
id: "20260722-163407"
title: Un remoto de estado ambiguo cae en silencio a origin
type: bug
status: done
created: 2026-07-22T16:34:07Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193102"]
release_impact: patch
---

## Request

Una auditoría adversarial externa encontró que la resolución del remoto de
estado contradice el contrato de `20260721-193102`: la Investigation exige que
«un remoto ausente o ambiguo es un error de configuración visible» y CR7 que el
protocolo «identifica el único remoto configurado o falla si no puede
resolverlo». Hoy una config con múltiples valores de `changeledger.remote` cae
en silencio a `origin`.

## Investigation

Causa raíz: `stateRemote` (`src/state-store.mjs:198-212`) ejecuta
`git config --get changeledger.remote`. Verificado empíricamente: sobre una
clave con dos valores asignados vía `--add`, Git no falla — `--get` devuelve en
silencio el último valor asignado, sin error ni exit code distinto. `stateRemote`
usa ese valor tal cual, por lo que el remoto efectivo depende de qué valor se
añadió último, sin ningún aviso de que hay más de uno configurado.

Consecuencias:

- Un repo mal configurado lee y publica estado contra el último valor añadido,
  sin aviso — el caso exacto que el spec quería hacer visible, y más silencioso
  de lo documentado originalmente: no hay ni siquiera un fallback a `origin`
  observable, solo una elección arbitraria por orden de escritura de config.
- La rama «falla si no puede resolverlo» de CR7 no tiene ningún test en
  `test/state-store.test.mjs` ni `test/state-command.test.mjs`.

Dirección del fix: detectar multivalor (`git config --get-all` o código de
salida 2) y fallar cerrado nombrando los valores encontrados; la ausencia
legítima conserva el fallback documentado a `origin`.

## Specification

### CR1 — La ambigüedad falla cerrada y visible
- **Given** un clon activado v2 con `changeledger.remote` configurado dos veces
  con valores `origin` y `backup`
- **When** se ejecuta `state status`, `state sync` o cualquier lectura/mutación
  state
- **Then** falla con `ambiguous changeledger.remote configuration: origin,
  backup`
- **And** no hace fetch ni push contra ningún remoto

### CR2 — La ausencia conserva el fallback documentado
- **Given** un clon activado v2 sin la clave `changeledger.remote`
- **When** se resuelve el remoto de estado
- **Then** usa `origin` y el receipt lo identifica como remoto efectivo

## Plan

- [x] Corregir `stateRemote` en `src/state-store.mjs` para fallar ante multivalor nombrando los valores y conservar el fallback por ausencia, escribiendo antes los tests fallidos de ambos casos; verify: `node --test test/state-store.test.mjs test/state-command.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-22T18:00:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T18:05:00Z`

## Log

- **2026-07-22T16:34:07Z** `[note]` Draft creado desde una auditoría adversarial externa pre-producción sobre codex/state-replica-v2; desviación media respecto a CR7 de 20260721-193102, sin ruta de pérdida de datos.
- **2026-07-22T16:49:00Z** `[status]` draft → approved
- **2026-07-22T17:24:58Z** `[status]` approved → in-progress
- **2026-07-22T17:24:58Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T18:05:00Z** `[note]` `stateRemote` usa `git config --get-all` y falla cerrado nombrando todos los valores cuando hay más de uno; la ausencia conserva el fallback a `origin`. Verificado empíricamente que el bug real era peor de lo documentado en el draft: `--get` sobre una clave multivalor no falla, devuelve en silencio el último valor añadido sin aviso alguno. Gate completo: 913/913 tests, lint y 218 changes válidos.
- **2026-07-22T17:29:58Z** `[status]` in-progress → in-review
- **2026-07-22T17:35:05Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-22T17:59:11Z** `[validation]` in-validation → done (human accepted)
