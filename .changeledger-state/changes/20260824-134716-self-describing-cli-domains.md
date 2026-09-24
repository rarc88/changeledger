---
id: "20260824-134716"
title: Exponer valores válidos y rechazar opciones incompatibles
type: bug
status: done
created: 2026-08-24T13:47:16Z
depends_on: []
reviewed: true
branch: bug/20260824-134716
related_to: ["20260720-125007", "20260729-203257", "20260805-052741"]
owner: Roberto Ruiz
---

## Request

La CLI obliga a agentes y humanos a adivinar dominios cerrados y combinaciones válidas. El caso observado es el Log: el parser acepta ocho tipos, incluido `branch`, mientras `changeledger context implement` enumera siete y lo omite. El mismo patrón aparece en argumentos con alternativas, opciones mutuamente excluyentes y modos de `fix`: la ayuda nombra capacidades de forma parcial, algunas combinaciones se resuelven por prioridad silenciosa y `nothing to fix` no distingue entre un modo sin candidatos y defectos que requieren reparación manual.

La CLI debe ser autoexplicativa: todo dominio cerrado que exponga debe enumerar sus valores efectivos, toda combinación incompatible debe fallar antes de escribir y la ayuda/diagnóstico debe derivarse de la misma autoridad ejecutable que valida. El alcance incluye los dominios auditados de eventos Log, roles de agente, veredictos, acciones de tarea, impactos de release y placeholders de rama; los conflictos entre modos de migración de `fix` y entre `review --retry/--block`; y la explicación de las reparaciones que realmente cubre `fix`. La ayuda de `changeledger log` debe ser el punto de descubrimiento directo de la gramática del Log: debe dejar claro que el comando solo escribe eventos `note` y mostrar los ocho tipos, sus payloads y los comandos que generan los eventos operativos.

Quedan fuera: generar todo el contrato desde JavaScript, convertir todos los diagnósticos a un protocolo estructurado, alterar la gramática de los changes o ampliar lo que cada migración automática puede reparar.

## Investigation

`src/lifecycle.mjs` exporta `LOG_EVENT_TYPES = [status, review, validation, owner, branch, graduation, archive, note]`, pero `templates/contract/implement.md` mantiene una lista escrita a mano sin `branch`. El commit que añadió el evento de rama actualizó parser y tests, no el contrato. La lista visible por el agente puede divergir porque no existe un guard que compare ambas autoridades.

La construcción de comandos repite otros dominios en `bin/changeledger.mjs`, módulos de comandos, README y contrato. Commander dispone de `Argument.choices()` para dominios estáticos y `Option.conflicts()` para incompatibilidades, pero hoy `fix` acepta simultáneamente `--graduation-links`, `--structured-sections` y `--plan-tags` y escoge silenciosamente la primera prioridad. `review --retry --block` también elige `--retry` sin rechazar la ambigüedad.

`fix --help` enumera los tres modos de migración, pero no dice que deben ejecutarse por separado ni describe las reparaciones del modo por defecto: normalización de marcadores `[ x ]`/`[X]`, separadores legacy y timestamps casi ISO. El resumen de ejecución describe reparaciones realizadas, pero `nothing to fix` no identifica qué modo se evaluó ni separa entradas no reconocidas que requieren intervención manual.

`changeledger log` no recibe un tipo: siempre serializa el mensaje como un evento `note`. Su ayuda actual solo muestra `<id> <message...>` y no distingue esa capacidad limitada de la gramática completa del Log. Por tanto, enumerar los eventos únicamente en `context implement` no resuelve el punto de descubrimiento natural del comando ni explica qué comando autorizado produce cada evento operativo.

Los changes relacionados introdujeron las secciones estructuradas (`20260720-125007`), la gramática de tags del Plan (`20260729-203257`) y el evento de rama (`20260805-052741`). No son prerequisitos de ejecución porque ya están cerrados, pero explican las tres autoridades que hoy divergen.

## Specification

### CR1 — La gramática visible del Log coincide con el parser
- **Given** la lista ejecutable `LOG_EVENT_TYPES`
- **When** se compone `changeledger context implement`
- **Then** el contexto enumera exactamente `status`, `review`, `validation`, `owner`, `branch`, `graduation`, `archive` y `note`
- **And** documenta la forma válida del payload de cada tipo y que cada evento de transición contiene una sola transición
- **And** un test falla si la lista ejecutable cambia sin actualizar la superficie consumida por agentes

### CR2 — Los dominios cerrados auditados se enumeran desde su autoridad
- **Given** los argumentos estáticos de rol, veredicto y acción de tarea, y los dominios de impacto de release y placeholders de rama
- **When** una persona consulta la ayuda o entrega un valor inválido
- **Then** la salida enumera todos los valores válidos aplicables a ese dominio
- **And** los tipos, estados y etapas configurables se enumeran desde la configuración efectiva del repositorio, no desde una lista estática

### CR3 — Los modos de migración de fix son incompatibles entre sí
- **Given** cualquier par entre `--graduation-links`, `--structured-sections` y `--plan-tags`
- **When** se ejecuta `changeledger fix` con ambas opciones
- **Then** el comando termina con código distinto de cero antes de modificar archivos
- **And** stderr nombra literalmente las dos opciones en conflicto y dice que no pueden usarse juntas

### CR4 — Review rechaza decisiones de fallo ambiguas
- **Given** un change en `in-review`
- **When** se ejecuta `changeledger review <id> fail --retry --block`
- **Then** el comando termina con código distinto de cero antes de modificar el change
- **And** stderr nombra `--retry` y `--block` como opciones incompatibles

### CR5 — Fix explica exactamente sus capacidades y su resultado
- **Given** `changeledger fix --help`
- **When** se lee la ayuda
- **Then** enumera las tres reparaciones del modo por defecto y los tres modos de migración con su alcance exacto
- **And** declara que los modos de migración se ejecutan de uno en uno
- **And** `changeledger fix --structured-sections` sin transformaciones aplicables identifica el modo evaluado y reporta cero reparaciones, sin sugerir que todos los errores estructurales son reparables automáticamente

### CR6 — Los diagnósticos de eventos inválidos son accionables
- **Given** una línea superior de Log que no cumple la gramática
- **When** se ejecuta `changeledger check`
- **Then** el diagnóstico conserva archivo y línea, enumera los ocho tipos válidos y muestra la forma canónica `- **YYYY-MM-DDTHH:MM:SSZ** `[type]` payload`
- **And** no afirma que `fix --structured-sections` pueda reparar una forma que el migrador no reconoce

### CR7 — La ayuda de log descubre la gramática completa sin prometer escritura arbitraria
- **Given** `changeledger log --help`
- **When** una persona consulta cómo registrar una entrada
- **Then** la descripción y el argumento de mensaje explican que `changeledger log` escribe exclusivamente un evento `note`
- **And** empieza con una instrucción positiva y un ejemplo de la línea exacta que escribe, sin exigir conocer el contrato del Log
- **And** la ayuda enumera los ocho tipos válidos y la forma de payload de cada uno desde `LOG_EVENT_DEFINITIONS`
- **And** identifica cada comando autorizado en una línea separada, sin abreviaturas con `|` que parezcan tuberías de shell
- **And** separa el uso avanzado de `apply` de los comandos directos y no expone operaciones internas sin explicación
- **And** no presenta los tipos operativos como valores aceptados por `<message...>`
- **And** un test falla si cambian las definiciones ejecutables sin actualizar esa ayuda

## Plan

- [x] Añadir pruebas fallidas para listas expuestas, opciones incompatibles, ayuda de `fix` y diagnósticos de Log
  - **Target:** `test/cli-bin.test.mjs, test/lifecycle.test.mjs, test/check.test.mjs, test/contract.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/lifecycle.test.mjs test/check.test.mjs test/contract.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6
  - **Resolved:** `2026-08-24T16:35:02Z`
- [x] Centralizar y consumir los dominios cerrados auditados en la construcción de CLI y sus errores
  - **Target:** `bin/changeledger.mjs, src/lifecycle.mjs, src/release.mjs, src/config.mjs, src/commands/agent-context.mjs, src/commands/agent-prompt.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/lifecycle.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-08-24T16:35:07Z`
- [x] Alinear el contrato del Log con la autoridad ejecutable y cubrir su deriva
  - **Target:** `templates/contract/implement.md, src/contract.mjs, test/contract.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs test/lifecycle.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-08-24T16:35:10Z`
- [x] Hacer autoexplicativos la ayuda y el resumen de cada modo de fix
  - **Target:** `bin/changeledger.mjs, src/commands/fix.mjs, src/fix.mjs, test/fix.test.mjs, test/cli-bin.test.mjs`
  - **Verify:** `node --test test/fix.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR3, CR5
  - **Resolved:** `2026-08-24T16:35:14Z`
- [x] Mejorar el diagnóstico de Log inválido sin prometer reparaciones inexistentes
  - **Target:** `src/check.mjs, test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-24T16:35:20Z`
- [x] Ejecutar el gate completo del repositorio
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-24T16:38:18Z`
- [x] Exponer en `log --help` la escritura exclusiva de `note` y la gramática completa del Log
  - **Target:** `bin/changeledger.mjs, test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-08-24T17:42:40Z`

## Log
- **2026-08-24T16:17:16Z** `[status]` draft → approved (human via conversation)
- **2026-08-24T16:18:36Z** `[status]` approved → in-progress
- **2026-08-24T16:18:37Z** `[branch]` set: bug/20260824-134716 (auto)
- **2026-08-24T16:38:27Z** `[status]` in-progress → in-review
- **2026-08-24T16:41:44Z** `[note]` Mandato de revisión: auditoría completa de CR1–CR6 y del Plan sobre el rango cerrado dev..05c720c6, incluyendo decisiones no especificadas, diagnósticos, ayudas, autoridades de dominios y conflictos antes de escritura.
- **2026-08-24T16:52:52Z** `[review]` in-review → in-progress (retry): CR1 publica que todos los eventos contienen una transición y su guard compara strings descriptivos separados de parseLogEvent; un cambio real de gramática puede derivar sin romper el test.
- **2026-08-24T17:04:45Z** `[status]` in-progress → in-review
- **2026-08-24T17:05:21Z** `[note]` Mandato de revisión de confirmación: verificar únicamente que la corrección no comprometida cierra el cuantificador falso y la autoridad paralela de CR1, y que no introduce regresiones; observaciones latentes o adyacentes se reportan como follow-up.
- **2026-08-24T17:13:43Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-24T17:23:28Z** `[validation]` in-validation → in-progress (human rejected via conversation): La ayuda de changeledger log no explica que solo escribe eventos note ni expone los ocho tipos válidos, sus payloads y los comandos que generan los eventos operativos.
- **2026-09-24T18:11:46Z** `[status]` in-progress → in-review
- **2026-09-24T18:15:36Z** `[note]` Mandato de revisión de confirmación: verificar que la corrección no comprometida de CR7 resuelve el rechazo humano sobre log --help (escritura exclusiva de note, ocho tipos y payloads, productores por línea, apply separado) y que no introduce regresiones en el diff; hallazgos ajenos quedan como seguimiento. Gate: pnpm verify 1491/1491, changeledger check y check --commits limpios.
- **2026-09-24T18:18:55Z** `[review]` in-review → in-progress (retry): CR7: log --help no comienza con una instrucción positiva ni muestra una línea concreta de ejemplo; además describe apply como productor de status y note pero omite owner, que apply sí puede generar.
- **2026-09-24T18:22:59Z** `[status]` in-progress → in-review
- **2026-09-24T18:23:22Z** `[note]` Mandato de revisión de confirmación de CR7: comprobar que el diff staged sustituye la plantilla inicial por una instrucción positiva y una línea concreta de ejemplo, que apply incluye owner junto con status y note, y que el ajuste no introduce regresiones. Hallazgos ajenos a esta corrección quedan como seguimiento. Gate: pnpm verify 1491/1491 y changeledger check limpios.
- **2026-09-24T18:25:37Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-09-24T18:35:21Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-09-24T18:38:19Z** `[graduation]` spec: `architecture.md`
- **2026-09-24T18:38:27Z** `[graduation]` spec: `validation.md`
