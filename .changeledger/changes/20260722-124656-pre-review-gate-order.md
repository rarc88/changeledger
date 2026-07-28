---
id: "20260722-124656"
title: Ejecutar el gate local antes de entrar en review
type: bug
status: done
created: 2026-07-22T12:46:56Z
depends_on: []
archived: true
reviewed: true
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

- [x] Reordenar el gate normativo en `templates/contract/implement.md` y alinear `templates/contract/review.md`, nombrando la vía sin veredicto; verify: `node --test test/context.test.mjs` (CR1, CR2, CR4, CR5)
  - **Resolved:** `2026-07-28T14:09:06Z`
- [x] Validar readiness del candidato en la transición a `in-review` en `src/commands/agent.mjs`; verify: `node --test test/lifecycle.test.mjs test/cli.test.mjs` (CR3)
  - **Resolved:** `2026-07-28T14:17:58Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-28T14:18:24Z`

## Log

- **2026-07-22T12:46:56Z** `[note]` Draft separa fallo de preparación y fallo de review: gates externos antes del lifecycle, validación estructural atómica durante la transición.
- **2026-07-28T13:45:34Z** `[note]` Enmendado el 2026-07-28 tras verificar sus supuestos contra el árbol. Retirado el criterio de escritura atómica: src/atomic-write.mjs ya usa temp+fsync+rename bajo withFileLock y el criterio no podía fallar. Retirada la tarea de métricas: reviewRetryCount ya filtra type=review. Corregida la Investigation: status <id> in-progress SÍ existe como vía sin veredicto y el defecto es que ningún fragmento la nombra. Añadido CR3, falsable: ninguna validación corre hoy en el camino de escritura a in-review. Punteros de línea sustituidos por nombres de sección y símbolo.
- **2026-07-28T13:57:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-28T13:58:41Z** `[status]` approved → in-progress
- **2026-07-28T13:58:41Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-28T14:09:07Z** `[note]` CR1/CR2/CR4/CR5: gate step now precedes the in-review transition in implement.md (steps 2/3 swapped, tail renumbered 4..7 to 5..8), new step 4 revalidates only the transition's own alteration, review.md states the same order and names status <id> in-progress as the no-verdict path while forbidding review fail --retry for a failure no reviewer emitted. Both fragment snapshot pins re-pinned with per-rule classification. Five mutations applied one at a time, all killed.
- **2026-07-28T14:17:58Z** `[note]` CR3: status() now calls assertChangeTextValid on the pre-flip text when the target is in-review, after assertTransition so type-level refusals keep their message. Pre-flip is load-bearing: checkCoverage only reports readiness as errors in draft/approved/in-progress, so validating the post-flip text would exempt the candidate under judgment. Guard mutations F1 (delete), F2 (validate post-flip) and F3 (drop the in-review condition) each killed the suite.
- **2026-07-28T14:19:12Z** `[note]` Findings for review: (1) the delegation's count of 8 status(...,'in-review') sites undercounts the write path — the reach() helper in test/agent.test.mjs and cli-bin.test.mjs both traverse it, and an unconditional-throw probe showed 21 pre-existing tests reaching it, all already readiness-valid, so no fixture needed repair; (2) placing the guard after assertTransition is what preserves the three type-level refusal messages (141120 CR5 in agent-context, 141120 CR1/CR2 in agent) unchanged; (3) scope incident: src/lifecycle.mjs was briefly mutated to test the new edge pin and restored byte-exact (git diff empty), so that one mutation is unproven and the file is outside the delegated write surface.
- **2026-07-28T14:23:04Z** `[note]` Commit combinado de las tres tareas del Plan, con su razon: la implementacion se delego en una sola pasada y el delegado no toca git, asi que las tres casillas y sus notas ya estaban escritas al recibir el informe. El codigo es separable (templates/contract/*.md frente a src/commands/agent.mjs) pero la unidad completa exigida por el contrato -codigo, test, casilla y Log- solo se podria separar reescribiendo el documento dos veces, que es la reconstruccion que el contrato prohibe. Defecto estructural del flujo, no del trabajo: delegar el Plan entero impide el commit por tarea. Registrado como hallazgo.
- **2026-07-28T14:23:51Z** `[status]` in-progress → in-review
- **2026-07-28T14:23:52Z** `[note]` Mandato de review: superficie que gobierna -los dos fragmentos del contrato y el guard de status()-, no auditoria completa. Puntos de escrutinio explicitos, de la lista de decisiones no especificadas que devolvio el implementador: (1) los dos comentarios de clasificacion de los pins de snapshot, incluido si alguna obligacion salio de implement.md sin sede nombrada; (2) validar el texto pre-flip en vez del post-flip, declarado load-bearing; (3) usar assertChangeTextValid en vez de checkRepo, que deja los invariantes de repo fuera de la transicion; (4) el test de comportamiento vive en test/agent.test.mjs mientras el verify declarado de la tarea 2 nombra lifecycle y cli; (5) el gate paso de 7 a 8 pasos; (6) CR2 tiene una sola sede, review.md; (7) la frase move directly de review.md quedo intacta; (8) test positivo anadido que CR3 no pide. El orquestador se somete al mismo estandar: la mutacion del pin de aristas de lifecycle la aplique yo y esta probada.
- **2026-07-28T14:38:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T14:38:00Z** `[note]` Review de contexto limpio: PASS. 12 mutaciones re-derivadas una a una en copia fuera del repo, cero supervivientes, gate verde en la copia (836/836). Correcciones al registro, verificadas por el orquestador: (1) la justificacion escrita en la nota de las 14:17 es FALSA -el pin anadido a test/lifecycle.test.mjs no era necesario para que el verify declarado de la tarea 2 fuese veraz, porque test/cli.test.mjs sola mata la mutacion F1-; (2) de las tres aserciones de ese pin solo una duplica exactamente la linea 130 del pin preexistente 171002 CR1/CR3, no las tres como reporto el revisor; las otras dos no existen en otro sitio; (3) el comentario de clasificacion del pin de implement.md no nombra review.md:40 como sede superviviente de la afirmacion del camino de estado move directly, aunque la obligacion existe alli; (4) el mutante F2 del implementador murio por el invariante de replay del Log, no por readiness, asi que no probaba la afirmacion pre-flip; el revisor construyo F2b y esa si la prueba. Ninguna de las cuatro justifica retry.
- **2026-07-28T14:56:06Z** `[validation]` in-validation → in-progress (human rejected via conversation): Roberto pide arreglar los tres residuos del review con ronda de confirmacion: retirar la asercion duplicada del pin de lifecycle, completar el comentario de clasificacion de implement.md nombrando review.md como sede superviviente del camino de estado, y la evidencia del F2 ya corregida en el Log
- **2026-07-28T14:57:21Z** `[status]` in-progress → in-review
- **2026-07-28T14:57:21Z** `[note]` Correccion del orquestador, sin commitear, para ronda de confirmacion con mandato minimo. Dos ediciones: (1) test/context.test.mjs, el comentario de clasificacion de implement.md ahora nombra review.md como sede superviviente de la mitad camino-de-estado de la frase move directly, y senala que esa sede esta pinneada por la asercion de este mismo fichero; (2) test/lifecycle.test.mjs, retirada la asercion assertTransition('in-review','in-progress') del pin 124656 porque duplica exactamente la del pin preexistente 171002 CR1/CR3; queda el canTransition, que no se afirma en ningun otro sitio -verificado: el happy path de CR1 no incluye in-review-. Mutacion aplicada por mi para probar que el pin recortado sigue mordiendo: quitar in-progress de los sucesores de in-review lo mata (17/2). Restaurado byte-exacto con git checkout, git diff vacio. Gate completo verde 836/836. El orquestador se somete al mismo estandar que el implementador: escrutar estas dos ediciones.
- **2026-07-28T15:00:46Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T15:00:46Z** `[note]` Ronda de confirmacion con mandato minimo: PASS, sin defectos. Verificado por ejecucion: review.md:40 contiene la frase intacta en todo el historial del change, test/context.test.mjs:527-530 la pinnea, y ningun otro sitio afirma canTransition('in-review','in-progress') -el revisor trazo el BFS reachableWithoutReview y razono que in-review nunca es estado origen ahi porque CR6 lo hace inalcanzable sin review-. Mutacion re-derivada en copia: el pin recortado falla con AssertionError false !== true, 17/2, y restaurado da 19/19. Gate verde 836/836.
- **2026-07-28T15:06:22Z** `[validation]` in-validation → done (human accepted)
- **2026-07-28T15:07:59Z** `[graduation]` spec: `lifecycle.md`
- **2026-07-28T19:41:27Z** `[archive]` archived
