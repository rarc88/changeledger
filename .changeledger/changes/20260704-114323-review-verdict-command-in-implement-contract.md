---
id: "20260704-114323"
title: Comando de veredicto de revisión ausente en el contrato de implementación
type: bug
status: done
created: 2026-07-04T11:43:23Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Durante el change 20260704-103715, tras delegar la inspección de la revisión a
un subagente de contexto limpio y recibir su veredicto PASS como texto, el
agente orquestador registró la transición `in-review → in-validation` con
`changeledger log` (texto libre que imitaba la frase `review → in-validation`)
seguido de `changeledger status <id> in-validation`. Ambas escrituras
generaron dos líneas de Log casi idénticas con el mismo timestamp, y
`changeledger check` rechazó el change: `Log line N: transition "in-review →
in-validation" starts from "in-review" but the reconstructed status is
"in-validation"`.

El comando correcto, `changeledger review <id> pass`, ya existe y hace ambas
cosas en una sola escritura atómica. La regla del core (#6) de usar un "fresh
clean-context reviewer" es sobre evitar el sesgo de confirmación del
implementador, no sobre transferir autoridad de escritura: el orquestador
mantiene siempre el control del ledger, y el subagente de review debe ser
estrictamente de solo lectura (inspecciona y reporta; nunca mueve estado). El
orquestador nunca cargó `changeledger context review` antes de mover el change
a `in-review` ni antes de cerrar la revisión, así que no conocía el comando de
veredicto ni el checklist de inspección — de ahí el reporte de texto libre y
la reconstrucción manual.

## Investigation

`templates/contract/implement.md` es el contexto activo del orquestador
mientras ejecuta un change. Su sección "Execute the Plan" dice "move to
`in-review` if the type requires independent review" pero no instruye cargar
`changeledger context review` en ese punto, ni antes de cerrar la revisión.
Su lista de "Useful mutation commands" (`status`, `task`, `log`, `owner`,
`check`) omite `review <id> pass|fail` por completo.

`templates/contract/review.md:17-21` documenta `changeledger review <id>
pass|fail` y el checklist de inspección — pero solo se carga con
`changeledger context review`, contexto que `implement.md` nunca le dice al
orquestador que debe cargar en este punto del flujo.

`templates/contract/delegation.md:23` marca la revisión como delegación
especial ("a fresh clean-context subagent is a correctness requirement") pero
no aclara que ese subagente debe quedar restringido a herramientas de solo
lectura (sin `Bash` mutando el repo, sin `changeledger status|review|log`):
la independencia de juicio no requiere ni justifica darle autoridad de
escritura sobre el ledger.

Consecuencia observada: sin `changeledger context review` cargado, el
orquestador no sabía que existía `changeledger review <id> pass|fail` y
tradujo a mano el reporte del subagente con `log` + `status`, duplicando la
escritura que el comando dedicado hace de forma atómica.

## Specification

### CR1 — El orquestador carga el contexto de review una vez, antes de mover a in-review
- **Given** un change cuyo tipo requiere review, con Plan y tareas completos
- **When** el orquestador se dispone a mover el change de `in-progress` a `in-review`
- **Then** `implement.md` instruye cargar `changeledger context review` en ese punto, una sola vez, antes de delegar la inspección
- **And** ese mismo contexto ya cargado —mientras siga disponible en la conversación activa, sin compactación ni sesión nueva de por medio— basta para registrar el veredicto después, sin necesidad de recargarlo
- **And** la lista de "Useful mutation commands" de `implement.md` referencia `changeledger review <id> pass|fail` como el comando que el propio orquestador ejecuta al recibir el veredicto del subagente, no `log`/`status` genéricos

### CR2 — El subagente de review es de solo lectura
- **Given** un orquestador delegando la inspección de una revisión requerida a un subagente de contexto limpio
- **When** redacta el prompt de delegación siguiendo `delegation.md`
- **Then** el contrato exige que ese subagente quede restringido a herramientas de solo lectura (sin mutar el repo ni el ledger) y que solo reporte su veredicto en texto
- **And** dejar explícito que registrar `changeledger review <id> pass|fail` es responsabilidad exclusiva del orquestador, nunca del subagente

### CR3 — El veredicto de revisión no se confunde con la validación humana
- **Given** un change que acaba de recibir `changeledger review <id> pass` y quedó en `in-validation`
- **When** el orquestador revisa cómo se cierra `in-validation`
- **Then** el contrato deja claro que esa transición la produce solo el humano vía viewer (`POST /api/status`), sin comando CLI equivalente, y que el agente nunca debe simularla con `status`/`log`

## Plan

- [x] Actualizar `templates/contract/implement.md`: junto a "When implementation and every task are complete, move to `in-review`..." indicar que el orquestador carga `changeledger context review` una vez en ese punto (no recargarlo solo para registrar el veredicto si sigue disponible en la conversación activa), y añadir `changeledger review <id> pass|fail` a "Useful mutation commands" como comando que ejecuta el orquestador; verify: `node bin/changeledger.mjs check 20260704-114323` (CR1) — 2026-07-04T13:20:10Z
- [x] Actualizar `templates/contract/delegation.md` ("Configured review is special" o "Delegation prompt contract") para exigir que el subagente de review quede restringido a herramientas de solo lectura y solo reporte texto, nunca mute el ledger; verify: `node bin/changeledger.mjs check 20260704-114323` (CR2) — 2026-07-04T13:20:10Z
- [x] Añadir a `templates/contract/implement.md` la aclaración de que `in-validation → done|in-progress` no tiene comando CLI, es exclusiva del humano vía viewer; verify: `node bin/changeledger.mjs check 20260704-114323` (CR3) — 2026-07-04T13:20:11Z
- [x] Revisar `templates/contract/review.md` para confirmar que sigue coherente (dirigido a quien inspecciona) y sin contenido duplicado tras los cambios anteriores; verify: lectura manual de los tres fragmentos (support) — 2026-07-04T13:20:11Z

## Log
- **2026-07-04T13:16:38Z** — status: draft → approved
- **2026-07-04T13:18:33Z** — status: approved → in-progress
- **2026-07-04T13:18:33Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-04T14:17:09Z** — Presupuesto explícito de bytes/líneas de 'implement' insuficiente para CR1/CR2 (margen original de 4 bytes). Ajustado junto con spec/review/release/core a múltiplos de 1000 (core 8000, spec 12000, implement 8000, review 4000, release 3000) tras discusión sobre presupuestos de contexto. Restaurada en implement.md la cláusula de CR1 sobre no recargar context review salvo pérdida de contexto, que había quedado recortada por presupuesto en un primer intento. Snapshots de delegation.md e implement.md en test/context.test.mjs actualizados con clasificación de reglas.
- **2026-07-04T14:17:19Z** — status: in-progress → in-review
- **2026-07-04T14:19:50Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-04T14:20:02Z** — validation → done (human accepted)
- **2026-07-04T14:20:36Z** — graduation skipped: La verdad durable ya vive en templates/contract/implement.md y delegation.md, editados directamente por este change; no hay un spec de convención separado que actualizar.
- **2026-07-04T14:20:42Z** — archived

