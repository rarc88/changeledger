---
id: "20260703-150229"
title: Evitar cargas duplicadas del contexto
type: bug
status: in-progress
created: 2026-07-03T15:02:29Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
---

## Request

Evitar que los agentes carguen primero un `changeledger context *` truncado y
después repitan el comando para obtenerlo completo. El centinela final debe ser
recuperación ante un fallo inesperado, no el camino normal de adquisición. Una
nueva intervención del humano tampoco debe provocar otra carga del core si el
contexto completo sigue disponible en la conversación activa.

## Investigation

El bootstrap y el core ya ordenan ejecutar `changeledger context` directamente,
sin pipes ni filtros, y todas las composiciones terminan con el centinela
`CHANGELEDGER CONTEXT END`. Sin embargo, la regla enfatiza qué hacer después de
detectar truncamiento y no ordena con suficiente precisión configurar la
captura de la primera invocación para conservar stdout completo.

Los tests verifican delimitadores para el core, los modos explícitos y un
contexto por ID; además limitan el tamaño de cada composición base. El cuerpo del
change seleccionado es deliberadamente variable y no puede tener una garantía
universal de transporte: el CLI controla lo que emite, pero no el límite que una
herramienta anfitriona aplica a stdout.

La causa de las cargas repetidas es por tanto contractual: algunos agentes usan
un presupuesto pequeño o interpretan cada mensaje nuevo como un nuevo trigger.
Prometer que el proceso externo jamás truncará sería falso; sí puede exigirse que
la primera invocación no solicite conscientemente previews ni límites y que no se
repita mientras el resultado completo continúe en contexto.

## Specification

### CR1 — Primera captura completa
- **Given** un agente que acaba de descubrir el bootstrap de ChangeLedger y aún no posee el core completo
- **When** ejecuta por primera vez `changeledger context`
- **Then** debe invocarlo directamente, sin pipes, filtros, resúmenes, previews ni límites voluntarios de líneas, bytes o tokens
- **And** si su herramienta permite configurar el presupuesto de salida, debe reservar capacidad suficiente para conservar la respuesta completa en esa primera ejecución

### CR2 — Contextos especializados completos
- **Given** un agente que necesita `changeledger context spec`, `implement`, `review`, `release` o `<change-id>`
- **When** ejecuta el contexto especializado
- **Then** aplica la misma regla de captura completa desde el primer intento
- **And** no trata una vista parcial como contexto operativo válido

### CR3 — No recargar por cada mensaje
- **Given** que el core completo hasta `CHANGELEDGER CONTEXT END` permanece disponible en la conversación activa
- **When** llega un nuevo mensaje humano sobre la misma tarea
- **Then** el agente no vuelve a ejecutar el core solo por ese mensaje
- **And** carga únicamente el modo o change-id que una transición real de tarea o lifecycle requiera

### CR4 — Recuperación cerrada
- **Given** una captura directa configurada como completa
- **When** falta de todos modos la línea `CHANGELEDGER CONTEXT END`
- **Then** el agente se detiene y repite el comando con una captura mayor, sin planificar ni actuar con la salida parcial
- **And** esta repetición se describe como recuperación excepcional

### CR5 — Cobertura de todas las composiciones
- **Given** cada modo explícito y cada estado canónico resoluble por change id
- **When** los tests componen su contexto
- **Then** la primera línea contiene el delimitador BEGIN correcto y la última contiene el mismo centinela END
- **And** los presupuestos existentes de las composiciones base continúan cumpliéndose

## Plan

- [ ] Tighten one-pass acquisition in `src/contract.mjs` and `templates/contract/core.md`, including the mode/status matrix in `test/context.test.mjs`; verify: `node --test test/contract.test.mjs test/context.test.mjs test/cli.test.mjs` (CR1, CR2, CR3, CR4, CR5)
- [ ] Update `.changeledger/specs/contract-discovery.md` with first-call capture and reload semantics; verify: `node bin/changeledger.mjs check 20260703-150229` (CR1, CR2, CR3, CR4, CR5)
- [ ] Run the complete quality gate after implementation; verify: `pnpm verify` (support)

## Log

- 2026-07-03T15:02:29Z — Se autorizó reemplazar la doble carga normal por una
  primera captura deliberadamente completa, conservando el centinela como
  recuperación ante límites externos inesperados.
- **2026-07-03T15:11:44Z** — status: draft → approved
- **2026-07-03T16:53:35Z** — status: approved → in-progress
- **2026-07-03T16:53:35Z** — owner → Roberto Ruiz (auto)
