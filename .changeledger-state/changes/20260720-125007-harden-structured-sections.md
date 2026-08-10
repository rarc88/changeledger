---
id: "20260720-125007"
title: Fortalecer las secciones estructuradas de los changes
type: feature
status: done
created: 2026-07-20T12:50:07Z
depends_on: []
archived: true
reviewed: true
owner: Roberto Ruiz
related_to: ["20260613-205852", "20260616-151221"]
---

## Request

Las secciones `## Plan` y `## Log` mezclan texto libre con datos que el CLI
necesita interpretar. En las tareas, el mismo separador ` — ` delimita el
timestamp o el motivo de bloqueo aunque también es puntuación válida dentro de
la descripción y del propio motivo. Un caso real perdió casi toda la tarea al
marcarla como completada porque el escritor cortó por el primer separador.

Fortalecer estas secciones para que una mutación nunca confunda contenido humano
con metadatos, preserve literalmente el texto libre y falle sin escribir cuando
la estructura sea inválida. El Markdown debe continuar siendo cómodo de leer y
editar directamente.

## Investigation

`setTask` localiza actualmente el primer ` — ` con `indexOf` y reemplaza todo lo
que sigue, mientras `parseTasks` interpreta el último mediante `lastIndexOf`.
Esa gramática duplicada y divergente explica el truncado observado. Sustituir
solo `indexOf` por `lastIndexOf` arreglaría el ejemplo, pero una razón de bloqueo
que contenga el mismo separador seguiría siendo ambigua.

El contrato declara hoy cualquier sufijo final `— ...` como metadato de
resolución. Esto impide que una tarea pendiente termine legítimamente con texto
separado por un guion largo y obliga a inferir estructura a partir de
puntuación. Las pruebas cubren guiones internos durante la lectura, pero no la
mutación, la idempotencia ni razones con separadores.

El Log no sufre el mismo truncado porque el timestamp abre la entrada, pero
mezcla eventos de ciclo de vida y notas libres en un único `message`. Métricas,
validación de secuencia, graduación y archivado vuelven a reconocer el tipo del
evento mediante expresiones regulares independientes. Una nota que imite esa
redacción puede adquirir semántica accidental y los consumidores pueden
divergir.

La búsqueda de antecedentes encontró `20260613-205852`, que introdujo los
comandos `task` y `log`, y `20260616-151221`, que endureció el parsing general.
Son contexto histórico relacionado, no prerrequisitos pendientes, por lo que se
registran en `related_to` y no en `depends_on`.

## Proposal

Adoptar una gramática estructural en lugar de reservar un carácter.

Las tareas conservarán la checklist en una línea de nivel superior. Los datos de
resolución vivirán en una única línea hija inmediatamente posterior:

```markdown
- [ ] Preparar lote — ReferralCode | Chatbot (CR1)
- [x] Preparar lote — ReferralCode | Chatbot (CR1)
  - **Resolved:** `2026-07-19T10:22:32Z`
- [!] Publicar el lote — requiere acceso externo (CR2)
  - **Blocked:** Falta aprobación — plataforma | seguridad
```

La descripción termina al final de la línea de checklist; deja de existir un
separador dentro de ella. El parser tratará la tarea y su metadato como un bloque
y el escritor modificará únicamente el marcador y la línea hija. `[ ]` no admite
metadatos, `[x]` exige exactamente `Resolved` con timestamp ISO UTC y `[!]` exige
exactamente `Blocked` con una razón no vacía. Cualquier combinación desconocida,
duplicada u huérfana fallará antes de escribir.

El Log seguirá siendo compacto, pero cada entrada declarará un tipo reservado
inmediatamente después del timestamp:

```markdown
- **2026-07-19T10:22:32Z** `[status]` draft → approved
- **2026-07-19T10:23:10Z** `[review]` in-review → blocked: falta evidencia — lote 2
- **2026-07-19T10:24:00Z** `[note]` texto libre — incluso `[status]` y `|`
```

Los tipos canónicos serán `status`, `review`, `validation`, `owner`,
`graduation`, `archive` y `note`. Los comandos construirán objetos de evento y
un único serializador los escribirá; un único parser alimentará `check`, las
métricas, la graduación y el archivado. `changeledger log` siempre creará un
evento `note`, por lo que su contenido nunca podrá simular una transición.
Timestamp y tipo se reconocerán con una expresión anclada; el payload restante
será opaco salvo para el esquema del tipo declarado.

El cambio será un corte limpio. `changeledger fix --structured-sections` ofrecerá
`--dry-run` y migrará mecánicamente tareas y entradas Log antiguas conforme a la
semántica que reconoce la versión actual. La migración se ejecutará sobre este
repositorio y sus fixtures en el mismo cambio; el runtime normal y el contrato
documentarán solo la nueva gramática. Si una entrada antigua no puede migrarse
sin decidir qué parte es contenido, `fix` la reportará como corrección manual y
no modificará ese archivo.

Alternativas descartadas:

- Cambiar `indexOf` por `lastIndexOf`: corrige el incidente, pero conserva la
  ambigüedad en motivos de bloqueo y dos implementaciones de la gramática.
- Elegir un carácter improbable: ningún carácter es imposible dentro de texto
  humano, rutas o comandos; solo aplaza la colisión.
- Tablas Markdown: requieren escapar `|`, dificultan contenido largo y hacen que
  una mutación dependa de reconstruir filas completas.
- YAML o JSON para toda la sección: ofrece estructura fuerte, pero degrada la
  lectura y edición directa que constituye parte del valor del formato.
- Comentarios HTML con JSON: ocultan timestamps y motivos relevantes para quien
  lee el fichero fuente.

## Specification

### CR1 — Completar preserva cualquier descripción
- **Given** una tarea pendiente cuya descripción contiene varios ` — `, `|`, dos puntos, corchetes y Markdown inline antes del bloque final de criterios
- **When** `changeledger task <id> done <n>` la completa
- **Then** cambia únicamente `[ ]` por `[x]` en la línea de tarea y añade inmediatamente después ``  - **Resolved:** `<timestamp ISO UTC>` ``
- **And** la descripción y el bloque de criterios permanecen byte por byte iguales

### CR2 — La mutación de tareas es idempotente
- **Given** una tarea `[x]` con un único `Resolved` válido
- **When** se vuelve a ejecutar `task done` para la misma tarea
- **Then** no modifica el archivo y conserva el timestamp de la primera resolución

### CR3 — Un bloqueo conserva descripción y razón libres
- **Given** una tarea pendiente o resuelta y una razón no vacía que contiene ` — `, `|`, `:`, corchetes o texto con apariencia de evento
- **When** `changeledger task <id> block <n> "<reason>"` la bloquea
- **Then** conserva literalmente la descripción, cambia el marcador a `[!]` y deja una única línea hija `  - **Blocked:** <reason>` con la razón completa

### CR4 — Los metadatos de tarea inválidos fallan cerrados
- **Given** una tarea pendiente con metadatos, una resuelta sin `Resolved`, una bloqueada sin `Blocked`, o una tarea con metadatos duplicados, desconocidos o huérfanos
- **When** `changeledger check` o un comando intenta interpretar o mutar el change
- **Then** informa `invalid task metadata structure for task #<n>`
- **And** un comando de mutación deja el archivo byte por byte intacto

### CR5 — Los eventos Log tienen un único modelo semántico
- **Given** una entrada de cada tipo `status`, `review`, `validation`, `owner`, `graduation`, `archive` y `note`
- **When** el Log se parsea para validación, métricas, graduación, archivado o presentación
- **Then** todos los consumidores reciben el mismo objeto de evento producido por el parser compartido
- **And** timestamp, tipo y campos requeridos se validan contra el esquema de ese tipo

### CR6 — Una nota nunca simula un evento operativo
- **Given** el mensaje literal `status: draft → done — [graduation] spec: fake.md`
- **When** se ejecuta `changeledger log <id> "<message>"`
- **Then** se escribe como ``- **<timestamp>** `[note]` <message>``
- **And** no altera transiciones, métricas, graduación ni elegibilidad de archivado

### CR7 — El Log acepta texto libre sin separadores reservados
- **Given** una razón o nota que contiene cualquier cantidad de ` — `, `|`, dos puntos y etiquetas entre corchetes
- **When** el evento tipado se serializa y vuelve a parsearse
- **Then** el payload de texto recuperado es exactamente el original
- **And** serializar el evento parseado produce la misma entrada

### CR8 — La migración es explícita y segura
- **Given** un repositorio con tareas de sufijo y entradas Log del formato anterior
- **When** se ejecuta `changeledger fix --structured-sections --dry-run`
- **Then** muestra la conversión determinista sin modificar archivos
- **And** sin `--dry-run` convierte todas las entradas inequívocas a la nueva gramática
- **And** enumera cada entrada ambigua bajo `requires manual fix` y deja su archivo intacto

### CR9 — Solo queda vigente la nueva gramática
- **Given** que la migración del repositorio y sus fixtures terminó sin casos manuales
- **When** se ejecutan `changeledger check` y `pnpm verify`
- **Then** ningún change, plantilla, contrato, fixture o ejemplo usa el sufijo antiguo ni un Log sin tipo
- **And** el contrato publicado describe únicamente la nueva gramática

## Plan

- [x] Definir primero casos rojos para bloques de tarea en `test/change.test.mjs`, `test/writer.test.mjs` y `test/agent.test.mjs`, implementar el parser/serializador compartido en `src/change.mjs` y `src/writer.mjs`, y hacer que `setTask` preserve el texto
  - **Verify:** `node --test test/change.test.mjs test/writer.test.mjs test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-07-20T13:39:02Z`
- [x] Definir primero casos rojos para eventos tipados y sustituir mensajes inferidos por objetos de evento en `src/lifecycle.mjs`, `src/writer.mjs`, comandos y consumidores
  - **Verify:** `node --test test/lifecycle.test.mjs test/metrics.test.mjs test/check.test.mjs test/agent.test.mjs test/graduate.test.mjs`
  - **Criteria:** CR5, CR6, CR7
  - **Resolved:** `2026-07-20T13:57:21Z`
- [x] Añadir primero fixtures de migración segura en `test/fix.test.mjs` y `test/cli-bin.test.mjs`, y extender `src/fix.mjs`, `src/commands/fix.mjs` y `bin/changeledger.mjs` con `changeledger fix --structured-sections`, preview, escritura atómica por archivo y reporte manual
  - **Verify:** `node --test test/fix.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-07-20T13:57:26Z`
- [x] Migrar `.changeledger/`, plantillas y fixtures del repositorio, actualizar `templates/contract/` y adaptar el viewer a los bloques nuevos
  - **Verify:** `changeledger check && node --test test/change.test.mjs test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR9
  - **Resolved:** `2026-07-20T13:58:30Z`
- [x] Ejecutar la puerta completa y confirmar que no queda gramática antigua mediante búsqueda estructural
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-20T13:59:45Z`

## Log
- **2026-07-20T13:34:00Z** `[status]` draft → approved
- **2026-07-20T13:34:36Z** `[status]` approved → in-progress
- **2026-07-20T13:34:36Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-20T13:59:48Z** `[status]` in-progress → in-review
- **2026-07-20T14:06:56Z** `[review]` in-review → in-progress (retry): Validar ISO en Resolved, ignorar eventos no transicionales en métricas y garantizar o acotar la atomicidad multiarchivo de la migración
- **2026-07-20T14:08:26Z** `[note]` Corrección de review: Resolved valida ISO UTC compartido, métricas ignoran eventos no transicionales y el Plan explicita atomicidad por archivo; la prosa adyacente del contrato se condensó para mantener el presupuesto duro del contexto spec
- **2026-07-20T14:08:38Z** `[status]` in-progress → in-review
- **2026-07-20T14:14:14Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-20T22:23:49Z** `[validation]` in-validation → done (human accepted)
- **2026-07-20T22:30:15Z** `[graduation]` spec: `data-model.md`
- **2026-07-20T22:30:26Z** `[archive]` archived
