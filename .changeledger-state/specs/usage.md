---
title: Registrar el consumo de tokens y su coste en cada transición con ccusage
updated: 2026-10-02T15:25:19Z
tags: [feature]
graduated_from: []
---

# Registrar el consumo de tokens y su coste en cada transición con ccusage

<!-- changeledger:spec-scaffold -->

> Scaffold from change 20261001-155612; replace this seed with durable current truth before --into.

### CR1 — Sin la clave no cambia nada
- **Given** un repo donde `git config --get changeledger.usage.collector` no devuelve valor y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** no se lanza ningún proceso `npx` ni `ccusage`, no existe `<git-common-dir>/changeledger/usage/` y la salida es la de hoy

### CR2 — Un colector desconocido es un error de configuración
- **Given** un repo con `git config changeledger.usage.collector other`
- **When** se ejecuta `changeledger check`
- **Then** termina con código distinto de cero y muestra `git config "changeledger.usage.collector" must be "ccusage"`
- **And** con el valor `ccusage` ese error no aparece
- **And** una clave `usage` en `config.yml`, sin el valor en git config, no activa la captura ni es validada

### CR3 — Una transición deja una foto completa
- **Given** `changeledger.usage.collector=ccusage` en git config, un `ccusage` simulado cuya salida de `claude session --json` es la fixture capturada con una sesión cuyo `projectPath` codifica la raíz del repo y dos modelos, y un change `approved`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** existe exactamente un archivo `<git-common-dir>/changeledger/usage/<id>/<instante>-1.json` cuyo `at` es el instante de la línea `[status]` `approved → in-progress`, con `schema: 1`, `event: "status"`, `from: "approved"`, `to: "in-progress"`, `collector` `{ "name": "ccusage", "version": "20.0.26", "pricing": "online" }`, `excluded: []`, `error: null`
- **And** su única sesión tiene `source: "claude"` y, por modelo, los tokens y el coste de `modelBreakdowns` con los nombres del registro, y el comando termina con código cero

### CR4 — Toda transición y la creación fotografían; el resto de comandos no
- **Given** `changeledger.usage.collector=ccusage` en git config, el `ccusage` simulado de CR3, un repo inactivo y uno activado
- **When** se ejecutan `changeledger new`, `approve`, `status`, `review`, `validation`, `reopen` y `discard`, una transición desde el viewer y un evento `status` de `changeledger apply`, y después `log`, `task`, `owner`, `branch`, `archive`, `graduate`, `edit` y `fix`
- **Then** cada uno del primer grupo deja exactamente un registro por evento de transición escrito, con `event: "created"` y `from: null` para `new`
- **And** ningún comando del segundo grupo deja un registro

### CR5 — Sólo cuentan las sesiones de este repo y de sus worktrees
- **Given** el `ccusage` simulado devuelve sesiones con `projectPath` igual a la codificación de la raíz, igual a la de un worktree del repo, igual a la de la raíz con el sufijo `-foo` y la de otro repo
- **When** se toma una foto
- **Then** el registro contiene sólo las dos primeras, siendo la codificación la ruta con cada carácter no alfanumérico sustituido por `-`
- **And** si ninguna sesión coincide, `sessions` es `[]` y stderr muestra `usage: no sessions matched this repository`

### CR6 — Las fuentes sin projectPath quedan fuera con aviso
- **Given** el listado sin fuente devuelve sesiones de `claude` y `gemini`, y `gemini session --json` devuelve dos sesiones sin `projectPath`
- **When** se toma una foto
- **Then** el registro contiene `excluded: [{ "source": "gemini", "sessions": 2 }]` y ninguna sesión de `gemini`
- **And** stderr muestra `usage: excluded gemini (2 sessions without projectPath)`

### CR7 — El coste se congela con respaldo offline y nunca inventa un cero
- **Given** el `ccusage` simulado sale con código distinto de cero sin `--offline` y con la fixture con `--offline`, y `totals.unpricedModels` contiene `claude-sonnet-5-5`
- **When** se toma una foto
- **Then** el registro tiene `collector.pricing: "offline"` y el modelo `claude-sonnet-5-5` tiene `cost_usd: null`
- **And** stderr muestra `usage: online pricing unavailable; used ccusage offline prices`

### CR8 — Un fallo del colector nunca bloquea la transición
- **Given** `changeledger.usage.collector=ccusage` en git config y, en cuatro casos, un `npx` ausente, un `ccusage` que supera los 10 s, uno que sale con código distinto de cero en ambos intentos y uno que escribe JSON inválido
- **When** se ejecuta `changeledger status <id> in-progress` en cada caso
- **Then** el comando termina con código cero y el Log contiene la transición
- **And** queda un registro con `sessions: []` y `error` no nulo, y stderr muestra una línea que empieza por `usage: snapshot failed: `

### CR9 — Los registros viven fuera del ledger en ambos layouts
- **Given** `changeledger.usage.collector=ccusage` en git config, un repo inactivo y uno activado con un worktree adicional
- **When** se ejecuta una transición desde la raíz y otra desde el worktree
- **Then** ambos registros están bajo el mismo `<git-common-dir>/changeledger/usage/` que devuelve `git rev-parse --git-common-dir`
- **And** `git status --porcelain` no los muestra, ningún commit de la ref de estado contiene una ruta `usage` y `changeledger check` termina con código cero

### CR10 — El primer uso real en este repo
- **Given** este repo con `git config changeledger.usage.collector ccusage`, el `ccusage` 20.0.26 real y un change de prueba
- **When** el humano lo crea, lo aprueba y lo lleva a `in-progress` desde una sesión de Claude Code abierta en el repo
- **Then** `<git-common-dir>/changeledger/usage/<id>/` contiene tres registros sin `error`, con la sesión actual en cada uno
- **And** los tokens de esa sesión no decrecen entre registros consecutivos, de modo que cada diferencia es el consumo del tramo
