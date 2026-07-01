---
id: "20260701-213931"
title: Descubrimiento temprano del contrato y delimitadores en context
type: feature
status: in-progress
created: 2026-07-01T21:39:31Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Mejorar la capa de entrega del contrato dinámico en dos frentes, sin embeber el
core en los `AGENTS.md` de los repos consumidores:

1. El bloque bootstrap administrado debe disparar la carga del core tan pronto
   el agente lee su `AGENTS.md`/`CLAUDE.md`, no solo "antes de crear o modificar
   archivos", e incluir una capability card mínima para que el agente sea
   consciente de la herramienta aunque desobedezca la instrucción.
2. La salida de `changeledger context` debe ir entre delimitadores explícitos
   para que el agente distinga el bloque contractual en su contexto y pueda
   verificar mecánicamente que el output no llegó truncado.

## Investigation

- El disparador actual del bootstrap (`REFERENCE` en `src/contract.mjs`) es
  condicional: "Before creating or modifying files". Una sesión de solo lectura
  o planificación nunca carga el core; cuando el agente por fin edita, ya trae
  un plan formado sin conocer lifecycle ni autorización.
- La regla anti-truncado actual ("do not pipe, filter, summarize...") depende de
  confianza: el modelo no puede saber qué le falta si el output llegó cortado
  por `head`, límites de tool-output o wrappers. No existe verificación
  mecánica de completitud.
- La cabecera actual `Mode: <mode>` es débil como delimitador: no marca el
  final, no identifica versión del CLI y se confunde con prosa.
- `checkContract` en `src/contract.mjs` ya compara el bloque administrado contra
  `REFERENCE` exacto y `changeledger check` reporta bloques desactualizados, así
  que la propagación del nuevo texto a repos consumidores ya tiene gate:
  `register` reescribe el bloque por marker y `check` exige re-registrar.
- El core tiene presupuesto (120 líneas / 8192 bytes) verificado por tests;
  añadir delimitadores consume presupuesto y los tests deben seguir pasando.
- El draft `#20260630-225213` optimiza la señal interna de los packs y asume el
  bootstrap como invariante; este change es la capa de entrega (trigger,
  awareness, delimitación) y no toca la composición interna de fragmentos.

## Proposal

**Bootstrap (bloque administrado en `AGENTS.md`/`CLAUDE.md`):**

- Trigger inmediato: instruir ejecutar `changeledger context` nada más leer el
  archivo, antes de planificar o investigar.
- Verificación por centinela: en lugar de solo prohibir truncar, exigir leer
  hasta la línea `END`; si falta, el output está truncado y hay que re-ejecutar
  sin pipes ni filtros.
- Capability card mínima dentro del bloque: regla dura (no crear/modificar
  archivos sin change autorizado) más un puntero al core como única fuente del
  workflow, los task contexts y la excepción operacional. Sin enumerar modos
  (duplicaría el core e invita a saltarse el contexto base) y sin un "Never"
  absoluto que contradiga la válvula operacional que el propio core define.

**Delimitadores en la salida de `context`:**

- Primera línea: `===== CHANGELEDGER CONTEXT BEGIN — mode: <mode> — v<version> =====`
  donde `<mode>` es el modo resuelto (en modo por id incluye además
  `— change: #<id>`) y `<version>` la versión del paquete.
- Última línea: `===== CHANGELEDGER CONTEXT END — if this line is missing, the
  output was truncated: stop and re-run =====`. El detector viaja con el output
  y no depende del bootstrap.
- Texto plano con `=====`: sobrevive cualquier renderizado, grep-friendly, sin
  HTML/XML. Reemplaza la línea actual `Mode: <mode>`.
- El aviso incremental de modos/ids se mantiene y pasa a referirse al centinela
  END del core como evidencia de lectura completa.
- La regla anti-truncado interna del core se acorta remitiendo al centinela END
  (hoy se repite en tres capas: bootstrap, core e incremental), recuperando
  presupuesto para contenido con señal.

**Alternativas descartadas:**

- Embeber el core completo en el bloque administrado: elimina el riesgo de
  desobediencia pero cuesta ~8KB por sesión en cada repo consumidor y esparce
  el contrato; rechazado explícitamente por el humano.
- Delimitadores en comentarios HTML o tags XML: invisibles o frágiles según el
  renderizado del harness; el texto plano es más robusto.

## Specification

### CR1 — El bootstrap dispara la carga inmediata del core
- **Given** un repo consumidor con `AGENTS.md` registrado
- **When** se ejecuta `changeledger register`
- **Then** el bloque administrado instruye ejecutar `changeledger context` inmediatamente después de leer el archivo, antes de planificar, investigar o actuar
- **And** el bloque ya no condiciona la carga a "before creating or modifying files"

### CR2 — El bootstrap incluye la regla dura y delega el detalle al core
- **Given** el bloque administrado generado por `register`
- **When** un agente lo lee sin ejecutar ningún comando
- **Then** el bloque enuncia la regla de no crear ni modificar archivos sin un change autorizado
- **And** remite al core como única fuente del workflow, los task contexts y la excepción operacional
- **And** no enumera los modos ni usa un "Never" absoluto que contradiga la válvula operacional del core

### CR3 — El bootstrap verifica completitud por centinela END
- **Given** el bloque administrado generado por `register`
- **When** un agente sigue su instrucción de lectura
- **Then** el bloque exige leer hasta la línea `CHANGELEDGER CONTEXT END` y tratar su ausencia como output truncado
- **And** indica re-ejecutar el comando directamente, sin pipes ni filtros, ante esa ausencia

### CR4 — La salida de context abre con delimitador BEGIN versionado
- **Given** un repo ChangeLedger con la versión del paquete disponible
- **When** se ejecuta `changeledger context`, `changeledger context <modo>` o `changeledger context <id>`
- **Then** la primera línea es `===== CHANGELEDGER CONTEXT BEGIN — mode: <mode> — v<version> =====` con el modo resuelto y la versión real del paquete
- **And** en modo por change id la línea incluye además `— change: #<id>`
- **And** la línea `Mode: <mode>` actual desaparece de la salida

### CR5 — La salida de context cierra con delimitador END autodetector
- **Given** cualquier invocación válida de `changeledger context`
- **When** se genera la salida
- **Then** la última línea es `===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====`
- **And** ningún contenido contractual aparece después de esa línea

### CR6 — Los presupuestos de composición absorben los delimitadores
- **Given** los tests de presupuesto del core (120 líneas / 8192 bytes)
- **When** se ejecuta la suite con los delimitadores incluidos en la salida
- **Then** el core delimitado sigue dentro de presupuesto
- **And** los tests de composición validan la presencia de BEGIN y END en todos los modos

### CR7 — check detecta bloques bootstrap desactualizados
- **Given** un repo consumidor cuyo `AGENTS.md` conserva el bloque administrado anterior
- **When** se ejecuta `changeledger check` con la nueva versión
- **Then** reporta error indicando referencia desactualizada y pide `changeledger register`
- **And** tras re-registrar, `changeledger check` pasa sin ese error

## Plan

- [x] Actualizar `REFERENCE` en `src/contract.mjs` con trigger inmediato, capability card y verificación por centinela; verify: `node --test test/contract.test.mjs` (CR1, CR2, CR3) — 2026-07-01T21:55:55Z
- [x] Añadir delimitadores BEGIN/END con modo, change id y versión en `src/commands/context.mjs`; verify: `node --test test/context.test.mjs` (CR4, CR5) — 2026-07-01T22:00:59Z
- [x] Acortar en `templates/contract/core.md` la regla anti-truncado remitiéndola al centinela END; verify: `node --test test/context.test.mjs` (CR6) — 2026-07-01T22:00:59Z
- [x] Mantener la salida delimitada de `src/commands/context.mjs` dentro del presupuesto del core y cubrir BEGIN/END en todos los modos; verify: `node --test test/context.test.mjs` (CR6) — 2026-07-01T22:00:59Z
- [x] Cubrir la detección de bloque desactualizado y el re-registro de `src/contract.mjs`; verify: `node --test test/contract.test.mjs` (CR7) — 2026-07-01T21:55:55Z
- [x] Re-registrar el bloque bootstrap del propio repo con `changeledger register` y validar con `node bin/changeledger.mjs check` (support) — 2026-07-01T21:56:16Z
- [x] Ejecutar el gate completo tras la implementación (support) — 2026-07-01T22:01:27Z

## Log

- **2026-07-01T21:39:31Z** — Draft creado. Alcance acotado a la capa de entrega del contrato (bootstrap + delimitadores); la señal interna de los packs pertenece a `#20260630-225213`. El humano descartó embeber el core en `AGENTS.md`.
- **2026-07-01T21:50:24Z** — Añadido a Proposal/Plan el recorte de la regla anti-truncado del core: hoy se repite en tres capas y el centinela END la vuelve redundante; se remite al centinela y se recupera presupuesto (CR6).
- **2026-07-01T21:51:41Z** — status: draft → approved
- **2026-07-01T21:53:05Z** — status: approved → in-progress
- **2026-07-01T21:53:05Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T21:55:55Z** — REFERENCE renovado: trigger inmediato, capability card y centinela END; detección de bloque desactualizado cubierta con el bloque anterior literal
- **2026-07-01T22:01:00Z** — Delimitadores BEGIN/END con versión y change id; core recortado al centinela; presupuesto y todos los modos cubiertos; suite completa verde (483)
- **2026-07-01T22:01:57Z** — status: in-progress → in-review
- **2026-07-01T22:03:22Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-01T23:00:36Z** — validation → in-progress (human rejected): card redundante con los modos y contradice la válvula operacional del core
- **2026-07-01T23:03:27Z** — Corrección tras rechazo humano: la card ya no enumera modos (duplicaba el core e invitaba a saltar el contexto base) ni usa 'Never' absoluto; ahora regla dura + puntero al core, que es la única fuente de la excepción operacional. CR2 y Proposal actualizados.
