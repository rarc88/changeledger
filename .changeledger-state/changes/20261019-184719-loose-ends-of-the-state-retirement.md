---
id: "20261019-184719"
title: Cerrar los cabos sueltos que dejó la retirada de los dos estados
type: bug
status: done
created: 2026-10-19T18:47:19Z
depends_on: ["20261018-131621"]
reviewed: true
branch: bug/20261019-184719
related_to: []
owner: raruiz-hiberuscom
release_impact: patch
---

## Request

`20261018-131621` retiró `in-validation` y `blocked` y pasó sus dos revisiones,
pero dejó ocho cabos sueltos: uno es un agujero real en el validador, dos son
afirmaciones que el propio producto publica y que ahora son falsas, y el resto
es deriva. Todos están nombrados en el Log de aquel change o en los informes de
sus revisiones.

Fuera de alcance: el rol `post-review`, que es inalcanzable desde que no existe
`in-validation` y cuyo dueño es el change de cápsulas; y la ausencia de un
comando de CLI que escriba la configuración autoritativa de un repo activado,
que es una capacidad que falta y no un cabo suelto de este trabajo.

## Investigation

- **El validador perdió poder de discriminación.** En `dev`, un documento con
  `status: done` y un Log que acabara en `[status] in-review → done` se
  rechazaba, porque esa arista no estaba en `TRANSITIONS`. El change la añadió
  para que `review pass` pudiera recorrerla, y `checkLifecycleSequence` dejó de
  poder distinguir una entrega con veredicto de una sin él. Las tres sedes de
  comando sí lo rechazan desde CR27; el hueco es el fichero editado a mano, que
  `spec.md` declara una vía legítima y que es la normal en los tres repos
  consumidores, todos en layout de worktree.
- **El sello de aceptación sólo ocurre si el merge precede a la graduación.**
  `sealAcceptance` se ejecuta en `--into` y `--skip`, consulta el merge en ese
  instante y nada lo reintenta después. `20261018-131621` cerró sin
  `accepted_at`: graduó y archivó con su rama sin fusionar. El aviso de CR22 lo
  habría señalado, pero `check` omite los archivados.
- **Dos publicaciones falsas.** `bin/changeledger.mjs` declara que ningún
  comando escribe `[validation]`, cuando `graduate` escribe su arma de
  aceptación; y `apply.mjs` mapea `validation` y `reopen` a comandos que ya no
  existen, con un comentario que además describe una negativa que
  `assertStatusDestinationAllowed` ya no hace.
- **La corrección del comentario de `review_required` cayó en el espejo
  inerte.** En un repo activado manda la configuración de la ref de estado, y
  allí sigue leyéndose «before universal human validation». Es el mismo reparto
  que produjo F2.
- **`LEGACY_EDGES` quedó parcialmente redundante.** `in-review → done` e
  `in-progress → done` son hoy aristas canónicas; sólo `draft → in-progress`
  sigue haciendo trabajo.
- **Dos métricas discrepan sobre el actor sin que nadie lo documente.**
  `rejectionCount` filtra por humano; las aristas de retrabajo de
  `usage-analysis` no, así que una reapertura del agente es retrabajo pero no
  rechazo.
- **Un pin de prosa demasiado ajustado.** `test/agent-context.test.mjs:447`
  fija la redacción exacta de una frase de `agent-contexts/review.md`, en
  contra de lo que pide `AGENTS.md`; y `:403` quedó subsumido por `:402`.

## Specification

### CR1 — El validador distingue una entrega con veredicto de una sin él
- **Given** un change de un tipo con `review_required`, con `status: done` en el frontmatter y un Log cuya última transición es `- **<ts>** `[status]` in-review → done`
- **When** se ejecuta `changeledger check <id>`
- **Then** sale con código distinto de cero
- **And** el mensaje nombra que la entrega desde `in-review` la registra `changeledger review <id> pass`
- **And** el mismo documento con `[review]` in-review → done` en su lugar sale con código 0
- **And** un Log que nombre antes un estado retirado —el caso de los changes en vuelo de los repos consumidores— no enmascara el rechazo

### CR2 — `sync` sella la aceptación que la graduación no alcanzó
- **Given** un change `done` sin `accepted_at`, ya graduado, cuya rama se fusionó en la rama de integración después de la graduación
- **When** se ejecuta `changeledger sync`
- **Then** el frontmatter recibe `accepted_at` con el instante del commit de merge y el Log su entrada `[validation] accepted (merged <sha-corto>)`
- **And** un change `done` cuya rama no está fusionada no recibe nada
- **And** el sellado ocurre también en un repo sin remoto, donde la publicación es un no-op: la detección del merge es local
- **And** el sellado ocurre también en un repo en layout de worktree, sin ref de estado y sin activar, escribiendo sobre el fichero del worktree
- **And** un checkout que tiene la ref de estado presente pero no la ha adoptado no sella nada, ni en el worktree ni en la ref

### CR3 — El aviso de aceptación pendiente alcanza a los archivados
- **Given** un change archivado, `done`, sin `accepted_at` y con su rama fusionada
- **When** se ejecuta `changeledger check`
- **Then** el aviso lo nombra igual que a uno no archivado

### CR4 — La ayuda no declara falsedades sobre quién escribe `[validation]`
- **Given** la salida de `changeledger log --help`
- **When** se lee la línea del tipo `validation`
- **Then** nombra toda sede de comando que escriba el arma de aceptación, derivada del código y no de una lista fija
- **And** no afirma que ningún comando lo escriba

### CR5 — `apply` no cita comandos retirados
- **Given** un manifiesto con una entrada `op: "validation"`
- **When** se ejecuta `changeledger apply --from`
- **Then** se rechaza sin escribir
- **And** el mensaje no nombra `changeledger validation` ni `changeledger reopen`

### CR6 — La configuración autoritativa no describe la puerta retirada
- **Given** este repo, activado
- **When** se lee el comentario de `review_required` de la configuración que resuelve la herramienta
- **Then** no contiene la cadena `human validation`

### CR7 — `LEGACY_EDGES` sólo lista aristas que no son canónicas
- **Given** `CANONICAL_STATUSES` y `TRANSITIONS` de `src/lifecycle.mjs`
- **When** se lee `LEGACY_EDGES` de `src/check.mjs`
- **Then** ninguna de sus aristas está ya en `TRANSITIONS`

### CR8 — El pin de prosa del revisor tolera la redacción
- **Given** `test/agent-context.test.mjs`
- **When** se reescribe la frase del veredicto de `agent-contexts/review.md` conservando su obligación — un veredicto `pass` o `fail`, y la clasificación del defecto como guía y no como segundo veredicto
- **Then** el test sigue pasando
- **And** no queda ninguna aserción subsumida por otra en ese bloque
- **And** la guarda no la satisface prosa ajena a la oferta del veredicto: una cápsula que deja de ofrecer los veredictos que la CLI acepta se pone en rojo

### CR9 — `rejectionCount` no cuenta como rechazo humano la devolución del agente
- **Given** un change cuyo Log tiene tres retornos de la puerta retirada: uno `(human rejected)`, uno `(agent rejected)` y uno sin actor
- **When** se calcula `rejectionCount`
- **Then** vale 2
- **And** la spec de métricas describe cómo se reconoce al agente en cada una de las dos formas, por qué difieren y que sobre el archivo real no se comportan distinto

## Plan

- [x] Estrechar la secuencia de ciclo de vida para exigir veredicto en la entrega desde `in-review`
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-19T20:01:02Z`
- [x] Sellar la aceptación pendiente desde `sync` y llevar el aviso a los archivados
  - **Target:** `src/commands/sync.mjs`, `src/check.mjs`
  - **Verify:** `node --test test/sync.test.mjs test/check.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-10-19T20:01:02Z`
- [x] Corregir lo que la CLI publica sobre `[validation]` y sobre las operaciones retiradas
  - **Target:** `bin/changeledger.mjs`, `src/commands/apply.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/apply.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-10-19T19:39:36Z`
- [x] Llevar la corrección del comentario a la configuración que la herramienta lee
  - **Target:** `.changeledger/config.yml`
  - **Verify:** verify: el comentario de la ref de estado no contiene `human validation`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-19T19:40:52Z`
- [x] Podar `LEGACY_EDGES` de lo que ya es canónico
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-19T20:01:03Z`
- [x] Aflojar el pin de prosa del veredicto del revisor
  - **Target:** `test/agent-context.test.mjs`
  - **Verify:** `node --test test/agent-context.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-19T19:40:52Z`
- [x] Documentar en la spec de métricas que el filtro de actor difiere entre rechazo y retrabajo
  - **Support:**
  - **Target:** `.changeledger/specs/metrics.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Resolved:** `2026-10-20T11:15:31Z`
- [x] Rectificar en la spec de arquitectura que el sello es la única escritura de `sync` por encima de la puerta de activación
  - **Support:**
  - **Target:** `.changeledger/specs/architecture.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Resolved:** `2026-10-20T11:15:32Z`
- [x] Excluir la devolución del agente del arma histórica de `rejectionCount`
  - **Target:** `src/metrics.mjs`
  - **Verify:** `node --test test/metrics.test.mjs`
  - **Criteria:** CR9
  - **Resolved:** `2026-10-20T11:46:32Z`

## Log
- **2026-10-19T18:47:19Z** `[version]` 0.18.0
- **2026-10-19T18:55:23Z** `[status]` draft → approved (human via conversation)
- **2026-10-19T18:56:14Z** `[status]` approved → in-progress
- **2026-10-19T18:56:14Z** `[branch]` set: bug/20261019-184719 (auto)
- **2026-10-19T18:57:29Z** `[note]` Rama creada desde feature/20261018-131621, no desde dev: este change corrige cabos sueltos de ese trabajo, que está en el PR rarc88/changeledger#13 y todavía no en la rama de integración. Salir de dev dejaba la rama sin el código a corregir, comprobado (assertNotShipped ausente). depends_on corregido de related_to a dependencia de ejecución real; al integrar, este change entra después del 13.
- **2026-10-19T19:39:36Z** `[note]` Selección B (CR4, CR5): el productor de [validation] en bin pasa a nombrar a changeledger graduate para el arma de aceptación y acota a la histórica la afirmación de que nadie la escribe; OPS_OWNED_ELSEWHERE deja de citar changeledger validation y changeledger reopen y apunta a lo que hace hoy ese trabajo — approve y discard como veredictos humanos, y status <id> in-progress --human para la vuelta desde done. Corregido también el comentario de apply.mjs que afirmaba que el asiento rechaza done, cosa que assertStatusDestinationAllowed ya no hace. Verificado por el orquestador: 127/0 en cli-bin y apply, biome limpio, log --help imprime los nueve tipos y el bloque validation nombra a graduate. La mutación M1b del delegado merece registro: probó que nombrar a graduate no basta si el texto conserva la afirmación general de que nada escribe el tipo — un arreglo a medias cae igual. El pin literal de apply.test.mjs se sustituyó por un bucle sobre las dos operaciones que asevera que el mensaje no nombra ningún comando retirado, en vez de fijar la redacción nueva.
- **2026-10-19T19:40:53Z** `[note]` Selección C parcial (CR6, CR8), hecha por el orquestador. CR6: el comentario de review_required se corrige en la configuración de la ref de estado con mutateState, que es la que la herramienta resuelve en un repo activado; el change anterior lo corrigió en el espejo del worktree y por eso seguía desalineado — el mismo reparto que produjo F2, repetido al arreglar F8. CR8: el pin de agent-context.test.mjs:447 deja de fijar la redacción exacta y pasa a vigilar la obligación — que la cápsula ofrezca exactamente los dos veredictos que la CLI acepta y que no reaparezca un flag de clase; comprobado traduciendo la frase del contrato al español, con el test en verde. Eliminada además la aserción de :403, subsumida por la de :402. Pendiente la tarea 7, documentar en metrics.md la asimetría de actor entre rejectionCount y las aristas de retrabajo: se hará en el cierre, que es la sede natural de una edición de verdad persistente.
- **2026-10-19T20:01:03Z** `[note]` Selección A (CR1, CR2, CR3, CR7): checkLifecycleSequence vuelve a distinguir una entrega con veredicto de una sin él, así que el fichero editado a mano —vía que spec.md declara legítima y que es la normal en los tres repos consumidores— deja de colar trabajo sin revisar. sync sella la aceptación pendiente reutilizando mergeRecord y recordedBranch, y el predicado pasa a ser una autoridad única exportada, pendingAcceptances, que check mapea a avisos y sync a sellos para que las dos sedes no diverjan. LEGACY_EDGES podado a lo que no es canónico, con el test aseverando la invariante en vez de fijar la lista. Nueve mutaciones, cada una con su diff. Decisión del delegado sobre los archivados, bien razonada y aceptada: se sellan. Si no, el aviso de CR3 sería inlimpiable para siempre, que es justo el diagnóstico sin salida que la doctrina de frozenReason existe para evitar; y el archivo congela la deliberación, no la telemetría derivada de git. Midió además el radio de impacto antes de decidir: de los 350 archivados sin accepted_at de este ledger, sólo uno resuelve un merge porque el resto tiene la rama borrada. Añadió una guarda fuera de criterio, con test y mutante propios: loadRepo dentro de sync habría permitido que una sola spec malformada impidiera viajar al journal, rompiendo la invariante de que sync nunca bloquea; la lectura degrada a aviso y el fallo de escritura sigue propagando. El orquestador cerró el residuo 1: el aviso apuntaba a graduate, que no puede limpiar un archivado, y ahora apunta a sync. Verificado: 292/0 en check y sync, pnpm test 2055/2054/1, biome limpio.
- **2026-10-19T23:18:41Z** `[note]` Residuo 2 de la selección A, resuelto por decisión del humano: el sello sube por encima de la puerta de activación. El razonamiento es que el no-op documentado de un checkout sin activar es sobre el TRANSPORTE, no sobre el ledger: sellar accepted_at reconcilia el documento local con un hecho de git y no publica nada. Sin esto, la telemetría que este change existe para conservar sólo funcionaba en el repo que menos la necesita — los tres repos consumidores están en layout de worktree y sync retornaba antes de sellar. Una sola excepción nueva por encima de la puerta: un checkout que tiene la ref de estado presente y no la ha adoptado no sella, porque el worktree y el snapshot son dos candidatos a sede de la escritura y nada dice todavía cuál es la verdad; --status sigue sin sellar por definición. CR2 ensanchado con las dos cláusulas y dos tests nuevos, cada uno matando su mutante con diff: devolver el sello debajo de la puerta mata el del layout de worktree, y quitar la guarda de adopción mata el de la ref no adoptada. Contrato ajustado en un solo sitio para no duplicar verdad: el bullet de done de core.md dice que una rama que aterriza después de la graduación la sella el siguiente sync, en cualquier layout y sin remoto; y el párrafo de sync cambia 'every point is a no-op' por 'every point transports nothing', que es lo que la promesa siempre quiso decir. Añadida la tarea 8: rectificar en la spec de arquitectura que el sello es la única escritura de sync por encima de la puerta, hoy dice que esos caminos sólo leen refs locales sin escrituras de ficheros. Verificado: 54/0 en sync, pnpm test 2057/2056/1 con el conocido de npm pack, biome limpio, contexto 226/325 líneas. Y probado en vivo sobre este ledger: sync selló 20261018-131621 (0c35eb7) y check pasó de un aviso a cero.
- **2026-10-20T09:53:00Z** `[status]` in-progress → in-review
- **2026-10-20T10:11:21Z** `[review]` in-review → in-progress: F1: CR2 falsifica a CR4 dentro del mismo change — sync escribe el arma accepted de [validation] y log --help sólo nombra a graduate. F2: la guarda de CR8 para el veredicto pass la satisface el texto 'PASS/FAIL evidence' de la propia cápsula, y la mutación que quita pass como veredicto ofrecido sobrevive. F3: la puerta de CR1 se esquiva con cualquier Log que nombre un estado retirado, que es la población para la que CR1 se escribió — pide decisión registrada.
- **2026-10-20T10:20:40Z** `[note]` Revisión independiente: FAIL con dos defectos bloqueantes y uno que pedía decisión. Los tres corregidos. F1 (CR2 falsificó a CR4 dentro del mismo change): sync escribe el arma accepted de [validation] y log --help sólo nombraba a graduate. Arreglado nombrando las dos sedes, y el test deja de aseverar una lista: deriva del código qué ficheros de src/commands anexan outcome: 'accepted' y exige que el help nombre cada uno, así que una tercera sede no puede volver a falsificar la ayuda en silencio. Mutación: quitar sync de la lista, el test muere. F2 (la guarda de CR8 era medio vacua): assert.match(reviewOut, /pass/i) lo satisfacía el 'per-criterion PASS/FAIL evidence' de la propia cápsula, dos palabras antes; la mutación del revisor que quitaba pass como veredicto ofrecido sobrevivía 29/29. Arreglado anclando ambas aserciones a la frase del veredicto (outcome: ...). Mutación M9 del revisor re-ejecutada: ahora muere. Esto lo escribí yo en la selección C y lo verifiqué traduciendo la frase al español, que es justo la mutación que NO distingue las dos cosas. F3 (la puerta de CR1 se esquivaba con cualquier estado retirado en el Log): medido antes de decidir. En los dos repos consumidores con ledger de worktree hay 20 changes en vuelo cuyos Logs ya nombran in-validation o blocked, y cero changes done vivos con la arista de entrega, así que cerrar el bypass tiene coste cero hoy y evita que la puerta nazca muerta justo en su población. El primer intento —subir la puerta por encima del chequeo canónico dentro del replay— NO funcionó y el test lo dijo: el bail es un return de la función entera, así que la línea de entrega ni se visita. Corregido sacando la puerta a su propia pasada, checkDeliveryVerdict, independiente del replay. Dos mutaciones: borrar la llamada mata los dos tests de CR1; meter el chequeo canónico dentro de la pasada nueva mata SÓLO el test de enmascaramiento, que es la prueba de que ese test mide la independencia y no otra cosa. CR1 y CR4 ensanchados con las cláusulas correspondientes. Verificado: 241/241 en check, 126/126 en cli-bin y agent-context, pnpm test 2058/2057/1 con el conocido de npm pack, biome limpio, contexto 226/325, y check ejecutado en vivo contra backend-laravel e ionic-app: cero impactos de la puerta nueva. Hallazgos del revisor no accionados, con razón: F4 (el sello puede anexar también un [version] en historia congelada) es la convención de graduate y no una clase nueva, pero el comentario de sealPendingAcceptances exagera al decir 'un hecho derivado de git' — se matiza en la graduación; F5 (el orden de salida en layout de worktree dice 'Nothing to sync' tras escribir un documento) es cosmético y cierto bajo la nueva redacción; F6 (aviso espurio cuando la activación está rota) y F7 (proyecto anidado dentro de un host activado) son caminos sin test y sin regresión, que van al change de seguimiento; F8 y F9 ya estaban declarados fuera de alcance y en la tarea 8.
- **2026-10-20T10:54:15Z** `[status]` in-progress → in-review
- **2026-10-20T11:18:15Z** `[note]` Revisión independiente, ronda 2: FAIL con cuatro puntos, los cuatro corregidos. El hallazgo que más vale es estructural y era mío: el plan era imposible. review pass valida el documento proyectado a done, y check rechaza 'status done but N tasks are not done'; las tareas 7 y 8 estaban diferidas 'al cierre', que sólo se alcanza DESPUÉS de done. O sea que el veredicto habría sido rechazado y completarlas tras un pass habría sido trabajo autorizado sin revisar. La sede correcta era changeledger edit spec:<slug>, que existe y es directa; mi nota de la selección C se equivocó al llamarlo cierre. Hechas las dos: metrics.md documenta que la asimetría de actor entre rejectionCount (sólo humano, mide insatisfacción) y FAILED_VERDICT_EDGES (sin filtro, mide consumo) es deliberada y que las dos cifras no tienen por qué cuadrar; architecture.md deja de publicar dos falsedades que este change había introducido —'sin remoto es no-op informativo' y 'sin fetch ni escrituras de refs o ficheros' en los caminos sin activar— y gana el párrafo del sello: por qué está por encima de la puerta, sus dos exclusiones y el alcance a archivados. CR8 seguía fallando su propia cláusula Then: el ancla /outcome/ rompía con una reescritura que conservaba la obligación, y el revisor lo demostró con la renombrada outcome→verdict, que es exactamente el coste que CR8 existe para quitar. Sustituido el ancla del sustantivo por sensibilidad a mayúsculas: la cápsula dice 'per-criterion PASS/FAIL evidence' y el caso es lo único que separa esa prosa de los dos tokens en minúscula que la CLI acepta. Tres mutaciones: quitar pass como veredicto muere; renombrar outcome a verdict sigue verde; reformular alrededor de reason sigue verde. core.md publicaba 'in any layout', falso para un checkout con la ref sin adoptar, y era la misma clase de defecto que CR4 y CR5 existen para cerrar; la cláusula se elimina en vez de enumerar excepciones, porque la obligación normativa es que el siguiente sync lo sella y el layout no es parte de ella. Y la cifra 'twenty of them are in flight' era falsa —el revisor contó 50 con un predicado más ancho— así que sale el número: un recuento en un comentario caduca. El comentario de sealPendingAcceptances admite ahora la línea [version] que appendLogEvent también estampa. No accionados y justificados: F5 (orden de salida en worktree) es cosmético; F6 (aviso espurio con activación rota) es ruido nuevo pero sólo en un repo ya roto; F7 (proyecto anidado en un host activado) no es regresión; los tres van al change de seguimiento. El agujero residual de CR4 que el revisor nombra —el grep es léxico y acotado a src/commands— es real y asumido: hoy encuentra las dos sedes y un escritor fuera de ese directorio se le escaparía. Verificado: pnpm test 2058/2057/1 con el conocido de npm pack, biome limpio sobre 132 ficheros, check verde, contexto 226/325. Ocho de ocho tareas resueltas.
- **2026-10-20T11:18:40Z** `[review]` in-review → in-progress: Ronda 2: el plan era imposible —review pass rechaza el documento con las tareas 7 y 8 abiertas y su sede estaba después de done—; CR8 seguía rompiendo su propia cláusula Then ante una reescritura que conservaba la obligación; core.md publicaba 'in any layout', falso para un checkout con la ref sin adoptar; y un recuento falso en un comentario entregado.
- **2026-10-20T11:18:47Z** `[status]` in-progress → in-review
- **2026-10-20T11:49:02Z** `[note]` Revisión independiente, ronda 3: FAIL con dos bloqueantes, los dos corregidos, más tres menores. El grave era mío y de la peor clase: publiqué en metrics.md como verdad persistente una afirmación que no verifiqué. Decía que rejectionCount sólo cuenta devoluciones del humano; es falso, su arma histórica no filtra por actor. Fui a los datos antes de redactar nada y el archivo decide la cuestión: de los 318 retornos de la puerta retirada en los dos repos consumidores, 104 llevan (agent rejected) y sus motivos son el agente cazando su propio defecto —'Self-reviewed instead of delegating', 'Bug encontrado en pruebas del server dev'—, 103 llevan (human …) y 214 no llevan actor. Así que la premisa de 20261018-131621 CR28, que un retorno en esa puerta era humano por definición, es falsa, y la métrica sobrecontaba un 49% en esos repos. Corregida la métrica, no la documentación: CR9 nuevo, el arma histórica excluye (agent …) en negativo y conserva los 214 sin actor, que son anteriores al detalle y cuyo asiento era del humano; exigir el actor en positivo allí habría vuelto a dejar la métrica en casi cero, que es justo lo que ese arma existe para evitar. Una corrección al informe del revisor: su tabla daba 0 retornos sin actor, y son 111 y 103, el grupo mayoritario — por eso el filtro correcto es negativo y no positivo. metrics.md reescrita diciendo la verdad, que incluye que las dos cifras divergen en DOS ejes y no en uno: el actor, y las aristas, porque el retrabajo cuenta además los dos review fail que rejectionCount no cuenta nunca. CR8, tercer intento, y el camino importa. Primero intenté que la cápsula nombrara el comando que registra el veredicto, para anclar en identificadores de CLI en vez de prosa; lo tumbó un test existente —'delegated capsules expose no orchestrator mutation surface'— y con razón: la cápsula del revisor no puede nombrar el comando mutador, porque invitaría al revisor a registrar su propio veredicto. El arreglo bueno es más barato: los dos veredictos van entrecomillados como literales, convención que el repo ya aplica, y la guarda lee REVIEW_VERDICTS de lifecycle.mjs y exige que cada uno aparezca como code span en la base de la cápsula, no en la prosa que la rodea. Cuatro mutaciones, incluidas las dos con las que el revisor tumbó el intento anterior: renombrar outcome a verdict y reformular 'with a reason' siguen verdes; quitar los dos veredictos de la CLI, y renombrarlos a accept/reject, mueren. Menores: la cifra falsa 'twenty in flight' sobrevivía en un segundo sitio, el comentario de test/check.test.mjs —la pasada de la ronda 2 cubrió uno de dos—; checkDeliveryVerdict se estrecha a status done, que es el Given de CR1, porque más ancho imprimía un remedio inalcanzable; y architecture.md gana lo que le faltaba por omisión: que sync escribe el sello también en el camino sin activar, que ahora lee el ledger entero con una salida de fallo nueva, y que en repo activado el sello es un CAS propio sobre la ref anterior al fetch, por lo que hay que releer el tip local antes de publicar. Verificado: pnpm test 2059/2058/1 con el conocido de npm pack, biome limpio, check verde, contexto 226/325. Nueve tareas, nueve resueltas.
- **2026-10-20T11:49:10Z** `[review]` in-review → in-progress: Ronda 3: metrics.md publicaba como verdad persistente que rejectionCount sólo cuenta devoluciones humanas, y su arma histórica no filtra por actor —104 de 318 retornos son del agente—; y CR8 seguía falsificado en las dos direcciones, una reescritura que conservaba la obligación lo ponía rojo y una cápsula que dejaba de ofrecer los dos veredictos seguía verde.
- **2026-10-20T11:49:17Z** `[status]` in-progress → in-review
- **2026-10-20T12:07:01Z** `[note]` Revisión independiente, ronda 4: FAIL con un solo bloqueante, y era mío por segunda vez sobre el mismo punto. Las tres cifras que publiqué en metrics.md eran falsas y además no sumaban: dije 318 retornos, 104 del agente y 214 sin actor. Lo comprobé yo mismo antes de aceptar nada y el revisor tiene razón: mi patrón de grep terminaba en (\s|$|:), y el espacio que precede a '(agent rejected)' lo hacía casar, así que conté los TOTALES por repo creyendo que contaba los que no llevan actor. Los números reales, verificados en los tres ledgers: 214 retornos en esa puerta en los dos repos consumidores, 111 del agente, 103 del humano, CERO sin actor; y 44 en el ledger propio, todos con actor. Esto significa que en la ronda 3 corregí al revisor sobre un grep malo y él tenía razón; queda registrado porque el error de método importa más que la cifra. Cae con ello la justificación que había dado para filtrar en negativo —que exigir el actor en positivo descartaría 214 entradas y re-ceraría la métrica—: con cero entradas sin actor las dos reglas dan exactamente lo mismo, comprobado. El código no cambia: el filtro negativo es correcto y está probado por mutación en las dos direcciones. Lo que cambia es la justificación, que ahora dice la verdad y es modesta: se excluye en negativo porque el escritor de esa forma está retirado y los detalles que pudo estampar no se leen de ningún código vigente, así que lo no marcado como agente se toma como del humano, y sobre el archivo real las dos reglas no se comportan distinto. La única cifra derivada que publico la verifiqué por dos vías independientes, grep crudo y el propio computeMetrics del producto antes y después del arreglo: backend-laravel 113→57, ionic-app 103→48, de ahí 'alrededor del doble'. Mismas cifras falsas corregidas también en el comentario de metrics.mjs, que es el segundo sitio: en la ronda 3 ya me pasó barrer uno de dos. CR9 ensanchado para exigir que la spec diga además que las dos reglas no difieren sobre el archivo real. No accionado y anotado para el change de seguimiento: con cero entradas sin actor, la única diferencia de comportamiento que le queda al filtro negativo es que un detalle no reconocido —(auto), un nombre, texto libre— contaría como rechazo humano; un /^human\b/ positivo sería estrictamente más seguro y hoy no cuesta nada, pero cambiarlo obliga a reescribir el Given de CR9 y el fixture de un test del change anterior, y no se observa en ningún archivo. Residuo de CR8 que el revisor reporta sin bloquear y comparto: la extracción de literales es agnóstica a la posición, así que una cápsula que prohibiera los veredictos conservándolos como code spans seguiría verde; es una construcción adversaria, no una deriva, y el modo de fallo real —quitar o renombrar un veredicto— muere. Verificado: pnpm test con el conocido de npm pack, biome limpio sobre 132 ficheros, check verde.
- **2026-10-20T12:10:06Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-20T12:33:29Z** `[graduation]` spec: `lifecycle.md`
- **2026-10-20T12:33:30Z** `[graduation]` spec: `validation.md`
- **2026-10-20T12:33:31Z** `[graduation]` spec: `architecture.md`
- **2026-10-20T12:33:31Z** `[graduation]` spec: `metrics.md`
- **2026-10-20T12:33:32Z** `[graduation]` spec: `global-state-scope.md`
- **2026-10-20T12:33:33Z** `[graduation]` spec: `data-model.md`
- **2026-10-20T12:33:33Z** `[graduation]` spec: `contract-discovery.md`
- **2026-10-20T12:33:53Z** `[note]` Graduación. Barrido previo de specs afectadas delegado con el método invertido —de cada criterio a la spec que posee esa verdad, no de las cadenas cambiadas a los documentos—, que es lo que encuentra la obsolescencia por omisión. Encontró cinco specs afectadas donde yo había reconciliado dos. La que justifica el método: lifecycle.md afirmaba 'Sin ella un agente entregaría sin veredicto su propio trabajo y check no vería nada mal', cierta al escribirse y falsa desde CR1, sin contener una sola cadena que este change tocara. validation.md tenía dos afirmaciones que CR3 volvió falsas en ambas mitades: que el sellado pertenece a la graduación y que el aviso respeta el predicado de congelado para no lanzar un subproceso git por archivado. Dos que no habría mirado solo: global-state-scope.md es el documento de techo y definía sync como puro transporte, que el sello deja de ser cierto; y data-model.md nunca listó accepted_at, hueco anterior a este change que este change empeora al darle un segundo escritor y llevarlo a los archivados. Absorbidas dos correcciones preexistentes en documentos que ya estaba editando, por no dejar falsedades verificables sabiéndolas: contract-discovery.md decía head -400 cuando el código emite 325 y la propia spec afirma que los dos números se igualan, y validation.md decía ocho tipos de evento cuando son nueve, cifra que architecture.md ya daba bien, así que las dos specs se contradecían. La graduation-review recomendó APPLY, re-derivó por dos vías las tres cifras de metrics.md y la relación 113→57 y 103→48, y verificó la ausencia de actor también en el ledger propio. De sus residuos no bloqueantes arreglé los que causaron mis ediciones: 'esa puerta' podía leerse más ancho que la forma [validation] que define el bullet y ahora lo dice; mi reescritura de 'check.mjs es puro' había estrechado el sujeto a checkRepo, que sí lanza un check-ref-format por change, y ahora dice lo que de verdad sostiene; y dos frases mías narraban el cambio en vez de enunciar la capacidad, que close.md prohíbe explícitamente. Arreglada también una falsedad de un identificador en architecture.md, que atribuía la lista de productores de log --help a LOG_EVENT_DEFINITIONS cuando sale de LOG_EVENT_PRODUCERS: es la misma clase que CR4 y estaba en la frase que CR4 gobierna. Queda sin accionar y anotado para el seguimiento: architecture.md nombra dos operaciones rechazadas por el batch cuando OPS_OWNED_ELSEWHERE tiene ocho. Siete specs enlazadas.
