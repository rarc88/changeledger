---
id: "20260715-125139"
title: Permitir decisiones humanas explícitas por conversación
type: feature
status: done
created: 2026-07-15T12:51:39Z
depends_on: [ "20260619-171002", "20260705-134703", "20260710-105205" ]
archived: true
reviewed: true
owner: Roberto Ruiz

---

## Request

Permitir que el humano apruebe, acepte o rechace un change mediante una
instrucción explícita en la conversación con el agente cuando no tiene acceso a
`changeledger view`. El agente debe limitarse a transmitir esa decisión por un
comando auditable: no puede inferirla, tomarla por el humano ni confundir elogio
o permiso para continuar con aprobación formal.

Las transiciones objetivo son:

- `draft → approved` por aprobación humana;
- `in-validation → done` por aceptación humana;
- `in-validation → in-progress` por rechazo humano con razón.

## Investigation

- El ownership ya pertenece al humano para las dos decisiones positivas, pero
  el mecanismo está acoplado al viewer en `templates/contract/core.md` y
  `.changeledger/specs/lifecycle.md`.
- La función `status()` admite `draft → approved` cuando recibe
  `actor: 'human'`; el binario fuerza `actor: 'agent'`, por lo que
  `changeledger status <id> approved` falla. El dominio del viewer reutiliza la
  misma función con actor humano.
- La función `validation()` ya implementa `pass`, ejecuta el check scoped sobre
  la transición candidata y escribe solo si el change es consistente. El CLI
  bloquea expresamente cualquier veredicto distinto de `fail`; el viewer llama
  la misma función para aceptar.
- `changeledger validation <id> fail "<razón>"` ya permite al agente rechazar y
  registra `agent rejected`. Si el humano ordena el rechazo en conversación, el
  movimiento es posible pero queda atribuido al ejecutor en vez de al dueño de
  la decisión.
- El viewer no autentica criptográficamente la intención humana; es una
  superficie de interacción confiada. La conversación puede ser otra superficie
  equivalente si el contrato exige una instrucción humana explícita y el CLI
  ofrece verbos que el agente no usa por iniciativa propia.
- Un flag o comando no puede demostrar que existió el prompt. La garantía es de
  autoridad contractual y trazabilidad, igual que en el viewer. No se añade
  almacenamiento de conversaciones, tokens de confirmación ni integración con
  un proveedor de chat.

## Proposal

Separar decisión de ejecución sin duplicar la lógica del dominio:

- añadir `changeledger approve <id>` como comando human-owned que reutiliza
  `status()` y solo admite `draft → approved`;
- ampliar `changeledger validation <id> pass` como comando human-owned que
  reutiliza el check scoped existente;
- conservar `changeledger validation <id> fail "<razón>"` para rechazo del
  agente y añadir `--human` cuando el agente transmite un rechazo explícito del
  humano;
- registrar el canal conversacional en el Log sin cambiar los eventos del
  viewer ni el grafo de lifecycle.

Los comandos positivos son deliberadamente específicos: no se habilita
`changeledger status ... approved|done`. El contrato ordena ejecutarlos solo
después de un mensaje humano activo que identifique inequívocamente el change y
la decisión. Frases como “se ve bien”, “continúa” o una recomendación del propio
agente no son autorización.

Eventos nuevos:

```text
status: draft → approved (human via conversation)
validation → done (human accepted via conversation)
validation → in-progress (human rejected via conversation): <razón>
```

## Specification

### CR1 — Aprobación humana por conversación
- **Given** un change `draft` y una instrucción humana explícita en la conversación que identifica inequívocamente ese change y ordena aprobarlo
- **When** el agente ejecuta `changeledger approve <id>`
- **Then** el change pasa a `approved`
- **And** el Log registra `status: draft → approved (human via conversation)`

### CR2 — Aprobación no inferida
- **Given** ausencia de una instrucción humana explícita de aprobación, aunque el humano diga “se ve bien”, pida continuar o el agente recomiende aprobar
- **When** el agente decide su siguiente acción
- **Then** no ejecuta `changeledger approve`
- **And** el change permanece `draft` hasta una decisión humana inequívoca

### CR3 — Aceptación humana por conversación
- **Given** un change `in-validation` consistente y una instrucción humana explícita que ordena aceptarlo
- **When** el agente ejecuta `changeledger validation <id> pass`
- **Then** se aplica el mismo check scoped usado por el viewer y el change pasa a `done`
- **And** el Log registra `validation → done (human accepted via conversation)`

### CR4 — Aceptación falla cerrado
- **Given** un change fuera de `in-validation`, con tareas incompletas o con una secuencia de Log inconsistente
- **When** se ejecuta `changeledger validation <id> pass`
- **Then** el comando falla con el diagnóstico existente
- **And** el archivo permanece byte-for-byte idéntico

### CR5 — Rechazo humano atribuido correctamente
- **Given** un change `in-validation` y una instrucción humana explícita de rechazo con razón `Falla en dispositivo`
- **When** el agente ejecuta `changeledger validation <id> fail --human "Falla en dispositivo"`
- **Then** el change pasa a `in-progress`
- **And** el Log registra `validation → in-progress (human rejected via conversation): Falla en dispositivo`

### CR6 — Rechazo del agente conserva su semántica
- **Given** un change `in-validation` que el agente rechaza razonadamente sin transmitir un veredicto humano
- **When** ejecuta `changeledger validation <id> fail "No cumple CR2"`
- **Then** el Log conserva `validation → in-progress (agent rejected): No cumple CR2`
- **And** una razón vacía falla sin escribir tanto con como sin `--human`

### CR7 — El viewer permanece compatible
- **Given** las acciones existentes de aprobar, aceptar o rechazar en `changeledger view`
- **When** el humano usa el viewer
- **Then** las transiciones, validaciones y mensajes de Log actuales permanecen sin cambios
- **And** viewer y conversación reutilizan las mismas funciones y guards de dominio

### CR8 — Ayuda y contrato expresan la autoridad
- **Given** la ayuda del CLI y el contexto compuesto para draft o `in-validation`
- **When** un agente consulta los mecanismos disponibles
- **Then** distingue decisiones human-owned por viewer o conversación de movimientos agent-owned
- **And** exige prompt humano explícito para `approve`, `validation pass` y `validation fail --human`, sin presentar el canal conversacional como permiso para inferir

## Plan

- [x] Escribir pruebas rojas en test/agent.test.mjs para atribución por canal conversacional y no-regresión del viewer; adaptar src/commands/agent.mjs sin duplicar guards ni el check scoped; verify: node --test test/agent.test.mjs test/view.test.mjs (CR1, CR3, CR4, CR5, CR6, CR7)
  - **Resolved:** `2026-07-15T13:30:53Z`
- [x] Escribir pruebas e2e en test/cli-bin.test.mjs para `approve`, `validation pass`, `validation fail --human`, estados inválidos y razones vacías; exponer los comandos y ayuda en bin/changeledger.mjs; verify: node --test test/cli-bin.test.mjs (CR1, CR3, CR4, CR5, CR6, CR8)
  - **Resolved:** `2026-07-15T13:30:53Z`
- [x] Actualizar templates/contract/core.md, templates/contract/spec.md y templates/contract/validation.md con viewer o conversación como mecanismos human-owned y la prohibición de inferir; cubrir composición y presupuestos en test/context.test.mjs; verify: node --test test/context.test.mjs (CR2, CR8)
  - **Resolved:** `2026-07-15T13:30:54Z`
- [x] Actualizar `.changeledger/specs/lifecycle.md` con decisiones humanas multicanal, comandos y eventos auditables, manteniendo el viewer como alternativa; verify: `changeledger check 20260715-125139` (CR1, CR3, CR5, CR6, CR7, CR8)
  - **Resolved:** `2026-07-15T13:30:54Z`
- [x] Ejecutar `pnpm verify` y confirmar que CLI, viewer, lifecycle y contrato completo permanecen verdes (support)
  - **Resolved:** `2026-07-15T13:34:09Z`

## Log

- **2026-07-15T12:51:39Z** `[note]` Draft creado para desacoplar las decisiones human-owned del acceso al viewer. Se reutilizan las rutas de dominio existentes, se conserva el rechazo agent-owned y se descartan autenticación de prompts o persistencia de conversaciones como complejidad fuera del núcleo local-first.
- **2026-07-15T12:53:55Z** `[status]` draft → approved
- **2026-07-15T13:20:14Z** `[status]` approved → in-progress
- **2026-07-15T13:20:14Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-15T13:20:15Z** `[note]` Implementation started on codex/resolve-approved-changes after the two bug fixes reached in-validation.
- **2026-07-15T13:30:54Z** `[note]` TDD completado: las pruebas rojas cubrieron approve ausente, validation pass bloqueado y --human desconocido; implementación de dominio, CLI, contrato y lifecycle terminada. Suite focalizada: 195/195 pruebas pasan.
- **2026-07-15T13:34:09Z** `[note]` Gate completo aprobado: Biome sin cambios, 682/682 pruebas pasan y 197 changes válidos.
- **2026-07-15T13:34:09Z** `[status]` in-progress → in-review
- **2026-07-15T13:40:59Z** `[review]` in-review → in-progress (retry): CR8: status --help contradice los canales conversacionales; validation.md eliminó reglas previas fuera del scope y debe restaurarlas.
- **2026-07-15T13:44:27Z** `[note]` Corrección tras review FAIL: prueba roja para status --help; ayuda alineada con approve/validation pass; reglas históricas de validation restauradas sin exceder el límite duro. Suites focalizadas 195/195.
- **2026-07-15T13:44:28Z** `[status]` in-progress → in-review
- **2026-07-15T13:50:57Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-16T13:37:32Z** `[validation]` in-validation → done (human accepted)
- **2026-07-16T13:39:26Z** `[graduation]` spec: `lifecycle.md`
- **2026-07-16T13:39:36Z** `[archive]` archived
