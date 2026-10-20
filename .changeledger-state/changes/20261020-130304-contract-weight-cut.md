---
id: "20261020-130304"
title: Recortar el peso del contrato por lo que un agente carga de verdad
type: refactor
status: in-progress
created: 2026-10-20T13:03:04Z
depends_on: []
branch: refactor/20261020-130304
related_to: []
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El contrato es lo único que se paga en cada tarea. Hoy son 20 fragmentos y 9.480
palabras en disco, pero el número que importa no es ese: los modos son
incrementales, así que un agente implementando sostiene `core` más `implement`,
5.853 tokens, y uno redactando 5.682.

Este change recorta ese peso sin decidir nada de producto. Quita verdad
duplicada, defensas contra fallos que ya no existen, y prosa que enseña lo que
`--help` imprime bajo demanda. No retira ninguna capacidad.

Fuera de alcance, por ser decisiones de producto y no recortes: la retirada de
la Definición de Ready, que es bilateral —`check` la aplica hoy y quitar la
prosa antes que el código dejaría una puerta que rechaza borradores contra una
regla que ningún contexto enuncia—; la retirada del estándar de cuantificador
universal; y el modelo de agrupación y ramas.

## Proposal

### Lo medido

Un análisis delegado midió los contextos **compuestos**, no los ficheros, que es
lo que el plan original no hizo:

| Contexto | Palabras | Tokens | Techo |
|---|---|---|---|
| `core` (siempre) | 2.105 | 2.954 | 3.250 |
| `implement` (+ `delegation`, `handoff`) | 2.041 | 2.899 | 3.000 |
| `spec` (+ `delegation`, `readiness`) | 1.819 | 2.728 | 3.000 |
| `review` (+ `handoff`) | 917 | 1.242 | 2.500 |
| `release` | 260 | 410 | 2.500 |

`implement` está a 101 tokens de su techo; es el paquete que más urge. Las
cápsulas de delegación están todas al 15-25% del suyo: ahí no está el peso.

Cuatro clases de recorte, todas verificadas contra el árbol de hoy:

- **Verdad duplicada.** Ocho obligaciones enunciadas en dos fragmentos, cada una
  con una copia que sobrevive. La mayor es el aislamiento de correcciones, 176
  palabras en `implement.md` que `review.md` ya impone.
- **Defensas obsoletas.** El rol `post-review` es inalcanzable desde que se
  retiró `in-validation`: `agent-context.mjs` lo condiciona a ese estado y
  `status` ya no lo acepta, así que toda invocación lanza. Son 422 palabras más
  su superficie de CLI. Y dos pasajes que argumentan contra `blocked` y contra
  el arma retirada de `[validation]`.
- **Prosa que `--help` ya imprime.** La peor es la tabla de los nueve tipos de
  evento en `implement.md`: `log --help` imprime más —incluye qué comando
  escribe cada tipo— y lo **genera** desde `LOG_EVENT_DEFINITIONS` con una
  comprobación fail-closed, mientras el contrato lleva una copia a mano.
- **Prosa larga.** La ventana de delta esperado son 12 líneas de exégesis para
  una regla de 60 palabras.

El análisis también desmintió tres recortes del plan. `readiness.md` no es una
defensa obsoleta sino una regla viva y aplicada por código. `discarded.md`
cuenta un techo como si fuera contenido. Y fundir `handoff.md` en
`delegation.md` no ahorra nada: responden preguntas distintas.

### El recorte

Recortar las cuatro clases. Cada obligación que sale de un fragmento nombra su
nuevo hogar y se comprueba con un grep de la obligación, no de palabras
parecidas. Ninguna obligación desaparece.

Los techos bajan a lo medido en el mismo change, para que el hueco liberado no
se vuelva a gastar, salvo el de `core`: su techo de líneas está acoplado al
`head -N` del bootstrap que `register` escribe en cada repo consumidor, así que
moverlo obliga a re-registrar los cuatro y merece su propio change deliberado.

## Specification

### CR1 — Ninguna obligación se enuncia en dos fragmentos
- **Given** las ocho duplicaciones identificadas, cada una con un hogar superviviente nombrado
- **When** se recorta la copia redundante
- **Then** un grep de la obligación —no de palabras parecidas— la encuentra en el hogar nombrado
- **And** el brazo de rechazo humano del aislamiento de correcciones, que hoy sólo vive en la copia que se borra, queda enunciado en `review.md`

### CR2 — El rol `post-review` no existe en el producto
- **Given** que `agent-context post-review <id>` lanza hoy para cualquier id, porque su estado requerido ya no es canónico
- **When** se retira el rol
- **Then** no quedan `templates/contract/agent-contexts/post-review.md` ni `agent-prompts/post-review.md`
- **And** `agent-prompt --help` y `agent-context --help` no lo ofrecen
- **And** `changeledger context core` no lo nombra en la lista de roles

### CR3 — Ningún fragmento enseña lo que `--help` imprime
- **Given** los seis pasajes que duplican salida de ayuda
- **When** se recortan
- **Then** por cada uno, la salida del `--help` correspondiente cubre lo recortado
- **And** sobrevive la obligación que la ayuda no lleva: tipar todo evento del Log, escalar a modo antes de actuar, los cuatro puntos estratégicos de `sync`, que la graduación no es una mutación masiva, y la línea base de una delegación que escribe

### CR4 — El camino de implementación adelgaza al menos un 25%
- **Given** `core` + `implement` en 5.853 tokens medidos con el tokenizador de referencia
- **When** se aplican todos los recortes
- **Then** el mismo par mide 4.400 tokens o menos
- **And** ningún contexto compuesto crece

### CR5 — Los techos reflejan lo medido y sólo pueden bajar
- **Given** los techos de `budgets.yml`, hoy de 2× a 7× su contenido
- **When** se cierran los recortes
- **Then** cada techo salvo el de `core` baja a lo medido más un margen declarado en el propio fichero
- **And** `AGENTS.md` enuncia que un techo sólo puede bajar, y que subirlo exige una decisión del humano registrada en un change
- **And** el techo de `core` no se toca, y el change dice por qué

### CR6 — La tabla de eventos deja de mantenerse a mano
- **Given** `test/contract.test.mjs`, que hoy fija la tabla de `implement.md` contra `LOG_EVENT_DEFINITIONS`
- **When** se recorta la tabla
- **Then** la aserción apunta a la salida de `log --help`, que se genera de esa misma constante con su propia comprobación fail-closed
- **And** ningún test nuevo fija una frase literal de un fragmento

## Plan

- [x] Retirar el rol `post-review` del contrato, la CLI y los tests
  - **Target:** `templates/contract/agent-contexts/post-review.md`, `templates/contract/agent-prompts/post-review.md`, `src/commands/agent-context.mjs`, `src/commands/agent-prompt.mjs`, `bin/changeledger.mjs`, `templates/contract/core.md`
  - **Verify:** `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs test/contract.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-20T13:18:50Z`
- [x] Cortar la verdad duplicada, cada obligación con su hogar comprobado por grep
  - **Target:** `templates/contract/implement.md`, `templates/contract/review.md`, `templates/contract/core.md`, `templates/contract/delegation.md`, `templates/contract/close.md`, `templates/contract/handoff.md`
  - **Verify:** `node --test test/contract.test.mjs test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-20T13:36:51Z`
- [x] Recortar la prosa que `--help` ya imprime, conservando lo que la ayuda no lleva
  - **Target:** `templates/contract/implement.md`, `templates/contract/core.md`, `templates/contract/close.md`, `templates/contract/delegation.md`, `templates/contract/spec.md`, `templates/contract/readiness.md`
  - **Verify:** `node --test test/contract.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-20T14:02:59Z`
- [ ] Retargetear la tabla de eventos del contrato a la salida generada
  - **Target:** `test/contract.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR6
- [ ] Comprimir los cuatro pasajes largos sin perder obligación
  - **Target:** `templates/contract/implement.md`, `templates/contract/core.md`, `templates/contract/handoff.md`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR4
- [ ] Bajar los techos a lo medido y enunciar la regla de techo decreciente
  - **Target:** `templates/contract/budgets.yml`, `AGENTS.md`
  - **Verify:** `node --test test/contract.test.mjs test/context.test.mjs`
  - **Criteria:** CR5

## Log
- **2026-10-20T13:03:04Z** `[version]` 0.18.0
- **2026-10-20T13:06:55Z** `[status]` draft → approved (human via conversation)
- **2026-10-20T13:07:01Z** `[status]` approved → in-progress
- **2026-10-20T13:07:01Z** `[branch]` set: refactor/20261020-130304 (auto)
- **2026-10-20T13:18:51Z** `[note]` Selección A (CR2): retirado el rol post-review, que era superficie muerta verificable. agent-context.mjs lo condicionaba al estado in-validation, retirado en 20261018-131621, así que toda invocación lanzaba desde entonces; comprobado en vivo antes de tocar nada. Fuera los dos fragmentos (422 palabras), las entradas de AGENT_ROLES y ALLOWED_STATUSES, los dos bloques de ayuda y el nombre en la lista de roles de core.md. Catorce tests caían: tres eran exclusivos del rol y se borran, el resto enumeraba roles y se actualiza. Lo que no es una simple actualización: el audit de roles retirados de 20260726-141123 vigilaba que 'audit' no resolviera ni como alias, y ahora recorre ['audit', 'post-review'], porque un rol retirado que vuelve a resolver en silencio es el fallo que ese test existe para cazar. Pasa de aserción única a bucle para que el segundo nombre no dependa de que el primero no lance. Dos listas de inventario de fragmentos y tres de roles válidos derivan ahora de ROLES o de la constante, en vez de repetir la enumeración a mano; eran cinco sitios donde añadir un rol exigía recordar cinco ediciones. Verificado: 319/318 en los cinco ficheros propios, pnpm test 2057/2056/1 con el conocido de npm pack, biome limpio, check verde. Nota: el recorte en core es de 3 palabras —el peso del rol estaba fuera de los contextos compuestos—, así que esta selección no mueve la aguja de CR4; su valor es que un agente ya no puede ser dirigido a un rol que siempre falla.
- **2026-10-20T13:36:52Z** `[note]` Selección B (CR1): siete duplicaciones cortadas, cada obligación con un grep de la obligación —no de palabras parecidas— en su hogar nombrado; los dieciséis greps están en verde. El recorte mayor del análisis delegado NO aguantó la verificación y lo invertí. Proponía borrar las 176 palabras de 'Correction isolation' de implement.md porque review.md ya las impone: falso. review.md sólo cubre tres de sus siete obligaciones; faltan el retorno a in-review para confirmar, la prohibición de empezar otra tarea mientras una corrección espera, el procedimiento completo del rechazo humano y el límite de que esto no autoriza dejar sin hacer los commits de implementación. Y la dirección estaba al revés: quien corrige está en in-progress, así que carga implement.md y NO carga review.md. El duplicado es el párrafo final de review.md, no el bloque de implement.md. Cortado ese, con una salvedad: era el único sitio que pedía releer el contexto antes de corregir tras un fail, así que esa cláusula se mueve a implement.md antes de borrarlo. Consecuencia honesta: implement pierde 71 palabras en vez de las 230 proyectadas, y review pierde 85 en vez de 39. Las otras seis sí aguantaron. core.md pierde las cláusulas de alcance de list --pending, que close.md enuncia con más precisión y sólo cuando aplican; delegation.md pierde la instrucción de decirle al delegado que comparte el worktree, porque la cápsula del propio delegado ya se lo dice y agent-prompt más agent-context es el camino obligado; close.md pierde la frontera de release, que core.md enuncia con el mensaje exacto del rechazo; handoff.md pierde la retrospectiva, que pertenece al cierre y se enriquece al moverla. Otro falso negativo propio digno de registro: mi script de verificación daba por ausente 'One owner per write surface' porque la obligación cruza un salto de línea y grep es por líneas. Rehecho normalizando los saltos; la obligación estaba. Medido: core 2105→2076 palabras, implement 2041→1970, review 917→832. Verificado: pnpm test 2057/2056/1 con el conocido de npm pack, biome limpio, check verde.
