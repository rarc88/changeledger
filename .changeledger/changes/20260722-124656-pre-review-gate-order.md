---
id: "20260722-124656"
title: Ejecutar el gate local antes de entrar en review
type: bug
status: in-progress
created: 2026-07-22T12:46:56Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260615-150510", "20260629-234939", "20260704-114323", "20260726-141120"]
---

## Request

El gate local debe decidir si existe un candidato revisable. Hoy el contrato mueve
primero el change a `in-review` y después ejecuta formatter, suite completa y
`changeledger check`. Si uno falla, el lifecycle ya afirma que comenzó review
aunque ningún reviewer haya inspeccionado el resultado, y el orquestador no tiene
ninguna vía nombrada para deshacerlo.

Se necesita mantener el change en `in-progress` hasta que el candidato pase sus
gates, sin ejecutar comandos externos como efecto lateral de una mutación de
ChangeLedger, y que la transición rechace un candidato inválido en vez de
aceptarlo y delegar el descubrimiento al reviewer.

## Investigation

Los dos fragmentos del contrato se contradicen. En `templates/contract/implement.md`,
la lista ordenada que abre con "When implementation and every task are complete"
pone la transición en el paso 2 y los gates en el 3:

```text
2. `changeledger status <id> in-review`.
3. Apply the local formatter and full gates, including `changeledger check`, to the exact review candidate.
```

En `templates/contract/review.md`, la sección "Independent Review" afirma lo
contrario: "The candidate reaches review only after host formatter and full
gates". Son semánticamente incompatibles y el conflicto es de prosa normativa, no
de implementación.

Cuatro supuestos del draft original se verificaron contra el árbol el
2026-07-28. Dos eran falsos y obligan a reescribir el alcance:

1. **La vía sin veredicto existe y el contrato no la nombra.** El draft afirmaba
   que no había transición de agente `in-review → in-progress` por fallo local.
   Es falso: el grafo de `src/lifecycle.mjs` declara
   `'in-review': ['in-validation', 'in-progress', 'blocked']`, y `status()` en
   `src/commands/agent.mjs` no tiene guard para ese movimiento — su único guard
   extra cubre `done → in-progress`. `changeledger status <id> in-progress`
   funciona hoy y escribe un evento genérico `type: 'status'`, no un veredicto.
   El defecto real es que ningún fragmento la menciona, así que el contrato
   enruta al orquestador a `review fail --retry`, que sí fabrica un veredicto
   inexistente.
2. **La escritura ya es atómica y byte-preservante.** `src/atomic-write.mjs`
   escribe a un fichero temporal, hace `fsyncSync` y `renameSync` bajo
   `withFileLock`, y solo escribe después de que el mutador retorne: una
   transición ilegal lanza antes de tocar el fichero. El criterio del draft
   original que lo exigía no podía fallar y se retira.
3. **Ninguna validación corre en el camino de escritura `in-progress → in-review`.**
   Ni `assertChangeTextValid` ni `checkRepo` se invocan ahí. La transición acepta
   un candidato con criterios incompletos o Plan sin trazabilidad, y el primero
   que lo descubre es el reviewer. Esto sí es falsable y es el mecanismo que
   convierte este change en algo más que prosa.
4. **`reviewRetryCount` ya cuenta solo veredictos reales.** En `src/metrics.mjs`
   filtra por `type === 'review'` con `from === 'in-review'` y
   `to === 'in-progress'`. Que las métricas no se muevan es **consecuencia** de no
   escribir el evento, no un comportamiento nuevo que verificar: el criterio se
   reescribe para afirmar la ausencia del evento, que sí es observable.

La causa raíz es el orden contractual. ChangeLedger no ejecuta formatter ni tests
configurables dentro de comandos de mutación —verificado: ningún comando de
mutación invoca comando externo alguno, y `src/git.mjs` solo llama a los binarios
fijos `git` y `gh`— así que el agente debe correr el gate host antes de pedir la
transición. Y arreglar el orden hace innecesario el veredicto fabricado: si los
gates corren antes, nunca hace falta volver de `in-review` por un fallo local.

`20260726-141120` cerró este mismo invariante para la **entrada** a review,
prohibiéndola en tipos sin review. La salida sigue abierta.

## Specification

### CR1 — El gate local precede a la transición
- **Given** el fragmento `templates/contract/implement.md` y su lista ordenada de preparación de review
- **When** se compone el contexto `implement`
- **Then** el paso que aplica formatter, verificaciones de tarea, suite completa y `changeledger check` aparece antes del paso `changeledger status <id> in-review`
- **And** `templates/contract/review.md` afirma el mismo orden sin contradecirlo

### CR2 — Un fallo del gate local no escribe historia de review
- **Given** un candidato cuyo gate local falla mientras el change sigue en `in-progress`
- **When** el orquestador interrumpe la preparación
- **Then** el contrato nombra `changeledger status <id> in-progress` como la vía sin veredicto y prohíbe `changeledger review <id> fail --retry` para un fallo que ningún reviewer emitió
- **And** el Log del candidato no contiene ningún evento de tipo `review` ni ninguna transición a `in-review`

### CR3 — La transición a `in-review` rechaza un candidato inválido
- **Given** un change en `in-progress` cuyo documento tiene un criterio sin Given/When/Then y una tarea CR-bearing sin target ni verificación
- **When** se ejecuta `changeledger status <id> in-review`
- **Then** el comando falla con código distinto de cero y nombra cada defecto de readiness encontrado
- **And** el documento conserva `status: in-progress` y no gana ninguna entrada de Log

### CR4 — Tras la transición solo se revalida lo alterado
- **Given** una transición correcta a `in-review`
- **When** el orquestador prepara la delegación
- **Then** el contrato exige reaplicar el formatter al documento y ejecutar `changeledger check`
- **And** exige repetir las verificaciones afectadas ante cualquier alteración posterior del candidato antes de entregarlo al reviewer

### CR5 — Los tipos sin review usan el mismo orden
- **Given** un tipo sin `review_required`
- **When** el contrato describe su salida de `in-progress`
- **Then** exige pasar el gate local antes de `changeledger status <id> in-validation`
- **And** no introduce una puerta de review para ese tipo

## Plan

- [ ] Reordenar el gate normativo en `templates/contract/implement.md` y alinear `templates/contract/review.md`, nombrando la vía sin veredicto; verify: `node --test test/context.test.mjs` (CR1, CR2, CR4, CR5)
- [ ] Validar readiness del candidato en la transición a `in-review` en `src/commands/agent.mjs`; verify: `node --test test/lifecycle.test.mjs test/cli.test.mjs` (CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T12:46:56Z** `[note]` Draft separa fallo de preparación y fallo de review: gates externos antes del lifecycle, validación estructural atómica durante la transición.
- **2026-07-28T13:45:34Z** `[note]` Enmendado el 2026-07-28 tras verificar sus supuestos contra el árbol. Retirado el criterio de escritura atómica: src/atomic-write.mjs ya usa temp+fsync+rename bajo withFileLock y el criterio no podía fallar. Retirada la tarea de métricas: reviewRetryCount ya filtra type=review. Corregida la Investigation: status <id> in-progress SÍ existe como vía sin veredicto y el defecto es que ningún fragmento la nombra. Añadido CR3, falsable: ninguna validación corre hoy en el camino de escritura a in-review. Punteros de línea sustituidos por nombres de sección y símbolo.
- **2026-07-28T13:57:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-28T13:58:41Z** `[status]` approved → in-progress
- **2026-07-28T13:58:41Z** `[owner]` set: raruiz-hiberuscom (auto)
