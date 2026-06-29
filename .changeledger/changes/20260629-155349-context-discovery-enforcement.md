---
id: "20260629-155349"
title: Reforzar descubrimiento completo del contrato
type: bug
status: done
created: 2026-06-29T15:53:49Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Al probar ChangeLedger en otros proyectos con agentes, se observó un fallo
repetido: el agente ejecuta `changeledger context`, pero después procede como si
cumplir el comando bastara, incluso cuando no leyó o no siguió toda la salida.
En un caso el agente explicó que el contexto era largo, se truncó, y el contrato
concreto se perdió frente al sesgo de “implementar ya”.
Después aclaró que no había ejecutado el arranque seguro `changeledger context`,
sino `changeledger context <change-id>` con un change anterior; eso volcó el
documento completo de otro ciclo y produjo 36KB de contexto irrelevante.

Se quiere una corrección justa y mínima, sin añadir comandos ni atajos nuevos:

- reforzar en el bootstrap de `AGENTS.md`/`CLAUDE.md` que la salida de
  `changeledger context` debe leerse completa y que una salida truncada bloquea
  el trabajo;
- mantener el bootstrap enfocado en un único punto de entrada:
  `changeledger context` sin argumentos, dejando los modos avanzados para la
  propia salida del contexto;
- reforzar en `templates/contract/core.md` que ejecutar el comando no equivale a
  cumplir el contrato;
- dejar claro que, si no hay un change aprobado/en progreso aplicable, el agente
  no puede editar archivos de implementación salvo que el humano elija
  explícitamente una edición directa puramente operativa.

## Investigation

Estado actual:

- El bootstrap administrado en `src/contract.mjs` ordena ejecutar
  `changeledger context` y seguir su salida, pero no dice que la lectura completa
  sea obligatoria ni qué hacer si la salida llega truncada.
- El mismo bootstrap presenta hoy `changeledger context` y
  `changeledger context <change-id>` como alternativas cercanas. Esa redacción
  permite que un agente use un ID viejo como “contexto inicial”, arrastre una
  salida grande e irrelevante, y luego racionalice el incumplimiento como
  problema de tamaño. Para evitar esa confusión, el bootstrap debe mencionar
  solo `changeledger context`; la salida core puede explicar los modos
  avanzados.
- `templates/contract/core.md` define el fast path no negociable, pero no separa
  explícitamente “ejecuté el comando” de “leí y seguí la salida completa”.
- El contrato ya distingue trabajo operacional en `release` e `implement`, pero
  no expresa en el core la regla general para una edición directa sin change:
  el agente no debe inferirla por tamaño o trivialidad; debe confirmar la opción
  con el humano.
- `changeledger context` core ya tiene presupuesto pequeño y tests de límite
  (`<= 120` líneas y `<= 8192` bytes), por lo que no hace falta añadir un comando
  tipo `quick`. `changeledger new` ya cubre la creación rápida de drafts.

La corrección debe ser textual y verificable, manteniendo la superficie de CLI
actual.

## Specification

### CR1 — Bootstrap exige lectura completa
- **Given** un repositorio registrado por ChangeLedger
- **When** `init` o `register` instala o refresca el bloque administrado en
  `AGENTS.md` y `CLAUDE.md`
- **Then** el bloque indica que `changeledger context` sin argumentos es el
  punto de entrada por defecto y debe leerse completo antes de crear o modificar
  archivos
- **And** indica que, si la salida está truncada o incompleta, el agente debe
  detenerse y resolver el acceso al contexto antes de continuar

### CR2 — Bootstrap no introduce modos avanzados
- **Given** un agente lee el bloque administrado en `AGENTS.md` o `CLAUDE.md`
- **When** busca el punto de entrada de ChangeLedger
- **Then** el bloque menciona solo `changeledger context` sin argumentos
- **And** no menciona la variante con change id ni otros modos que puedan
  confundirse con el contexto inicial

### CR3 — Core separa ejecución de cumplimiento
- **Given** un agente ejecuta `changeledger context`
- **When** lee el contexto core
- **Then** el contrato declara que ejecutar el comando no basta para cumplir
- **And** el cumplimiento exige leer la salida completa y seguir el modo actual

### CR4 — Sin change aplicable no hay edición silenciosa
- **Given** no hay un change aprobado o en progreso aplicable a la solicitud
- **When** el agente considera editar archivos del repositorio
- **Then** el contexto core prohíbe editar archivos de implementación de forma
  silenciosa
- **And** dirige al agente a crear/actualizar un change o preguntar al humano si
  quiere una edición directa puramente operativa

### CR5 — La excepción operativa queda en manos del humano
- **Given** una edición parece puramente operativa, reversible y sin cambio de
  verdad persistente ni comportamiento observable
- **When** no existe un change aplicable
- **Then** el contrato exige que el agente pregunte si proceder directo o
  documentarlo como change
- **And** si hay duda, el agente debe preferir crear o actualizar un change

## Plan

- [x] Actualizar el texto `REFERENCE` en `src/contract.mjs`; verificar: `node --test test/contract.test.mjs test/cli.test.mjs` (CR1, CR2) — 2026-06-29T16:05:03Z
- [x] Actualizar `templates/contract/core.md` con las reglas de cumplimiento completo, bloqueo ante truncado y edición operativa explícita; verificar: `node --test test/context.test.mjs test/cli.test.mjs` (CR3, CR4, CR5) — 2026-06-29T16:05:08Z
- [x] Ajustar tests de contexto/contrato para fijar la nueva redacción sin ampliar el presupuesto del core; verificar: `pnpm test` y `node bin/changeledger.mjs check 20260629-155349` (CR1, CR2, CR3, CR4, CR5) — 2026-06-29T16:05:27Z

## Log

- 2026-06-29T15:53:49Z — Draft creado tras autorización humana explícita para
  plantear el change.
- 2026-06-29T16:02:00Z — Investigación refinada: el contexto de 36KB vino de
  ejecutar `changeledger context <change-id>` contra un change anterior, no del
  contexto inicial sin argumentos.
- **2026-06-29T16:02:24Z** — status: draft → approved
- **2026-06-29T16:03:44Z** — status: approved → in-progress
- **2026-06-29T16:03:44Z** — owner → Roberto Ruiz (auto)
- **2026-06-29T16:07:19Z** — status: in-progress → in-review
- **2026-06-29T16:09:15Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-29T16:20:02Z** — validation → done (human accepted)
- **2026-06-29T16:21:35Z** — graduado a spec `contract-discovery.md`
- **2026-06-29T16:22:11Z** — archived
