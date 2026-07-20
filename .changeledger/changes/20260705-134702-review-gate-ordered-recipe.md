---
id: "20260705-134702"
title: El gate de revisión carece de receta ordenada única
type: bug
status: done
created: 2026-07-05T13:47:02Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Una auditoría de followability del contrato (2026-07-05) concluyó que el gate
de revisión es el procedimiento donde un modelo promedio falla con más
probabilidad. La secuencia real que debe ejecutar el orquestador es:
completar tareas → `changeledger status <id> in-review` → cargar
`changeledger context review` una vez → delegar un revisor read-only con
contexto limpio → registrar él mismo `changeledger review <id> pass|fail`.
Ese orden no está escrito como receta en ningún fragmento: está repartido en
prosa densa entre cuatro archivos, y cada uno aporta una pieza distinta.

Errores previsibles ya observados o anticipados: delegar el comando de
veredicto al subagente (el change 20260704-114323 documentó exactamente ese
patrón) o ejecutar `review <id> pass` con el change aún `in-progress`, que el
CLI rechaza con un error que el agente no anticipó.

## Investigation

Piezas del procedimiento y dónde viven hoy:

- `templates/contract/core.md:30-31` — regla 6: usar revisor fresco de contexto
  limpio antes de la validación humana. No dice quién registra el veredicto ni
  en qué orden.
- `templates/contract/implement.md:57-63` — un único párrafo denso mezcla tres
  instrucciones: mover a `in-review`, cargar `context review` una sola vez (con
  la excepción de compactación entre paréntesis) y registrar el veredicto uno
  mismo con `review <id> pass|fail` (nunca `log`+`status`). Es la pieza más
  completa pero no es una secuencia numerada y omite la delegación en sí.
- `templates/contract/review.md:15-22` — «Record exactly one verdict» con los
  tres comandos. Este fragmento se compone en el modo `review`, que carga el
  orquestador, pero también describe el trabajo del revisor delegado; el sujeto
  de «record» queda implícito.
- `templates/contract/delegation.md:23-25` — la revisión configurada es
  especial: subagente read-only, «the orchestrator alone records the verdict».
  Este fragmento solo se compone en `spec` e `implement`, no en `review`.

Verificado en código que el orden importa: `changeledger review <id> pass`
lanza error si el change no está ya `in-review` (`src/commands/agent.mjs`,
guard de estado) y solo un `pass` avanza a `in-validation`. El CLI actúa como
guardrail, pero el error llega después de que el agente ya eligió mal el orden.

Causa raíz: el contrato define todas las restricciones del gate pero nunca las
presenta como una secuencia ordenada en el lugar donde el orquestador la
necesita (el pack `implement`, que es el contexto activo cuando la
implementación termina). Un modelo promedio no reconstruye la secuencia por
inferencia entre cuatro fragmentos.

Restricción de diseño: los contextos compuestos tienen presupuestos de
líneas/bytes verificados en `test/context.test.mjs` (`implement`: 175 líneas /
8000 bytes). La receta debe reemplazar prosa existente, no solo añadirse, y el
presupuesto debe seguir pasando sin ajuste.

Relación con el draft 20260704-144327 (esqueletos de prompt por rol): ese
change cubre el contenido del prompt de delegación; este cubre el orden del
procedimiento en el orquestador. Son complementarios y no se solapan: el
esqueleto de review referencia el checklist, no la secuencia del gate.

## Specification

### CR1 — El pack implement contiene la receta ordenada del gate
- **Given** un repo ChangeLedger con la plantilla de contrato de este paquete
- **When** se ejecuta `changeledger context implement`
- **Then** la salida contiene una lista numerada (`1.` a `5.`) con exactamente
  estos pasos en este orden: completar tareas del Plan; `changeledger status
  <id> in-review`; cargar `changeledger context review` una sola vez; delegar
  un revisor read-only de contexto limpio; registrar el veredicto el propio
  orquestador con `changeledger review <id> pass|fail`
- **And** el paso 5 conserva la prohibición literal de sustituirlo por
  `log`+`status`
- **And** la receta conserva la excepción de recarga por pérdida de contexto
  (compactación o sesión nueva)

### CR2 — La receta reemplaza la prosa dispersa sin duplicar la verdad
- **Given** el fragmento `templates/contract/implement.md` tras el cambio
- **When** se lee la sección que hoy ocupa el párrafo de las líneas 57-63
- **Then** la receta numerada sustituye a ese párrafo (no coexiste con él)
- **And** `templates/contract/review.md` identifica explícitamente al
  orquestador como sujeto que registra el veredicto, sin repetir la receta
- **And** ni `core.md` ni `delegation.md` incorporan la secuencia; conservan
  sus reglas actuales

### CR3 — Los presupuestos de contexto siguen pasando sin ajuste
- **Given** los presupuestos vigentes en `test/context.test.mjs` (implement:
  175 líneas / 8000 bytes; review: 75 líneas / 4000 bytes)
- **When** se ejecuta `node --test test/context.test.mjs`
- **Then** todas las pruebas pasan con los valores actuales, sin modificarlos

## Plan

- [x] Añadir pruebas fallidas en `test/context.test.mjs` que exijan la receta numerada de cinco pasos en la composición de `implement` y el sujeto orquestador en `review`; luego reescribir el párrafo de `templates/contract/implement.md:57-63` como receta numerada y ajustar `templates/contract/review.md`, sin tocar `core.md` ni `delegation.md`; verify: `node --test test/context.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-05T14:06:25Z`
- [x] Comprobar que las composiciones de `templates/contract/implement.md` y `templates/contract/review.md` respetan los presupuestos vigentes sin modificarlos; verify: `node --test test/context.test.mjs` (CR3)
  - **Resolved:** `2026-07-05T14:06:25Z`
- [x] Ejecutar el quality gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-05T14:06:25Z`

## Log
- **2026-07-05T13:57:39Z** `[status]` draft → approved
- **2026-07-05T14:00:10Z** `[status]` approved → in-progress
- **2026-07-05T14:00:10Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-05T14:06:25Z** `[note]` Receta numerada de 5 pasos en implement.md (reemplaza el parrafo denso), review.md nombra al orquestador como sujeto del veredicto. Snapshots de implement/review actualizados; presupuestos 175/8000 y 75/4000 intactos. 540 tests verdes.
- **2026-07-05T14:06:25Z** `[status]` in-progress → in-review
- **2026-07-05T14:08:46Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-05T16:48:17Z** `[validation]` in-validation → done (human accepted)
- **2026-07-10T10:27:39Z** `[graduation]` skipped: La verdad durable ya quedó incorporada en los fragmentos contractuales canónicos.
- **2026-07-10T20:18:08Z** `[archive]` archived
