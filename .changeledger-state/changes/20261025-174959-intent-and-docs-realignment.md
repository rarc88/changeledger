---
id: "20261025-174959"
title: "INTENT.md y docs describen el flujo que el contrato sirve: sin validación humana, sin bloqueo, sin correcciones aisladas; el acta de julio se retira"
type: change
status: approved
created: 2026-10-25T17:49:59Z
depends_on: []
related_to:
  - "20261023-181753"
  - "20261024-121022"
  - "20261024-202659"
  - "20261024-202718"
parent: "20261023-181733"
owner: raruiz-hiberuscom
tdd: false
---

## Request

La épica `20261023-181733` termina cuando `INTENT.md` describe el flujo que el
contrato sirve, no el anterior. Hoy `INTENT.md` (121 líneas) narra en sus
secciones 5 a 8 y 10 un ciclo que ya no existe: revisión según el tipo, un
estado bloqueado, una etapa de validación humana, correcciones sin commit
hasta la confirmación y un `done` provisional hasta «cruzar una frontera
durable». `docs/usage-capture.md` (264 líneas) describe la captura de uso
con cuatro afirmaciones que el código desmiente desde que `validation`,
`reopen`, `in-validation` y `blocked` se retiraron. `docs/workflow-hardening.md`
(2.195 líneas, 21.204 palabras, cuatro veces el contrato entero) es el acta
de julio de 2026 de una iniciativa cuyo contrato ya no existe; nada la
referencia y su propia cabecera dice que no es verdad persistente ni trabajo
autorizado.

### Objective

`INTENT.md` y `docs/` describen el producto después del recorte, sin
cifras que caduquen. Terminado significa que:

- `INTENT.md` cuenta el flujo vigente: el humano aprueba de un draft su
  objetivo y su frontera; Specification y Plan nacen en `in-progress` con el
  código delante; la revisión independiente existe si la rama toca código y
  no según el tipo; no hay estado bloqueado ni etapa de validación humana —la
  aceptación es la fusión de la rama en integración y una entrega se devuelve
  a `in-progress` con razón—; una corrección tras `fail` o rechazo es una
  selección resuelta más, committeada y revisada de nuevo; la unidad de
  commit es la selección resuelta; la única frontera irreversible es una
  release registrada; un hallazgo fuera de la frontera se registra con
  `changeledger finding` y lo promueve el humano. Conserva intactos el
  propósito, la regla de conversación primero, la separación en changes, el
  modelo de confianza del commit (`review.md` lo cita), el estado global y los
  filtros y no-goals, que siguen siendo verdad y no llevan números;
- `test/intent.test.mjs` deja de pinar las cuatro frases que se vuelven
  falsas y guarda, con patrones tolerantes a la redacción, las obligaciones
  que `INTENT.md` conserva, o desaparece si `INTENT.md` deja de llevar detalle
  de ciclo de vida (decisión 2);
- `docs/usage-capture.md` dice qué eventos toman instantánea hoy (`created`,
  `status`, `review` y `discard`, con `apply` y las transiciones del viewer),
  que `[validation] accepted` no toma ninguna, que los registros nuevos sólo
  llevan `created | status | review`, que un veredicto fallido es `[review]
  in-review → in-progress` o `[status] done → in-progress` y que los dos
  bordes retirados sólo clasifican registros antiguos; y lo que el hallazgo
  sobre `gap` diga tras verificarlo (Investigation);
- `docs/workflow-hardening.md` deja de poder confundirse con doctrina vigente
  (decisión 1);
- ninguna línea añadida fuera de `.changeledger/` lleva un id de change ni un
  `CRn`, porque el hook de la rama lo rechaza.

### Frontier

**Entra.** `INTENT.md`, `test/intent.test.mjs`, `docs/usage-capture.md`,
`docs/workflow-hardening.md`, y `AGENTS.md` sólo si la decisión 1 obliga a
tocar la frase que apunta a `INTENT.md` (hoy no la toca). `src/usage-analysis.mjs`
sólo si la verificación del hallazgo sobre `gap` demuestra un desajuste de
código y el humano lo mete por enmienda registrada; si no, se documenta y se
registra como hallazgo.

**Queda fuera.** `docs/changeledger-v1-plan.md`, que es el plan y se queda
como documento histórico; `README.md` y `CONTRIBUTING.md`, ya realineados;
las specs del ledger (`readiness`, `validation`, `lifecycle`, `usage` y las
demás), que reconcilia la épica al cerrar; el viewer y `PROJECT_DOCUMENTS`;
cualquier cifra del contrato en `INTENT.md`.

**Pre-autorizado.** Borrar `docs/workflow-hardening.md` si la decisión 1 lo
fija así; reescribir o retirar `test/intent.test.mjs` según la decisión 2,
nombrándolo en el Log; enmendar la Specification en `in-progress` cuando el
código desmienta lo previsto, registrándolo. Si cambia el objetivo o la
frontera, se vuelve al humano.

### Decisiones de forma que el humano aprueba con el objetivo

1. **`docs/workflow-hardening.md` se borra.** Nada lo referencia, su
   contenido vive en los Logs de los changes cerrados y en el historial de
   git, y una realineación línea a línea es inviable: 59 líneas con id y 64
   con `CRn` que el hook rechazaría al tocarlas, en un documento que ya no
   describe nada vigente. Alternativa: dejarlo intacto con un aviso de
   «superado» en cabecera, que conserva 21.000 palabras que un agente puede
   leer como doctrina.
2. **`INTENT.md` conserva el ciclo en cinco frases y el test se reescribe.**
   La intención del producto incluye quién decide qué y cuándo un trabajo es
   irreversible; eso es intención, no mecánica. `test/intent.test.mjs` guarda
   con patrones tolerantes: el humano aprueba objetivo y frontera; la
   aceptación es la fusión; una entrega vuelve a `in-progress` con razón; sólo
   una release registrada es irreversible; `discarded` es terminal.
   Alternativa: que `INTENT.md` remita al contrato para todo el ciclo y el
   test desaparezca, que deja a la intención sin decir quién acepta.
3. **Los filtros y no-goals siguen sin cifras.** AGENTS.md ya fija que los
   techos viven en `budgets.yml` y sólo bajan; una cifra en `INTENT.md`
   caduca con el siguiente recorte. La sección duplica la spec
   `product-principles`; la épica decide al cerrar cuál apunta a cuál.

### Investigation

Mapa leído en `dev` (`2f481a54`) por una investigación delegada de sólo
lectura.

**`INTENT.md`.** Lo referencian `AGENTS.md` (presupuesto y no-goals),
`templates/contract/review.md` («INTENT.md's trust model») y el viewer
(`PROJECT_DOCUMENTS`). Frases falsas: «algunos tipos de change requieren una
revisión» (la revisión existe si la rama toca código); «el change queda
bloqueado» (seis estados, sin `blocked`; un impedimento es una tarea `[!]`);
toda la sección 6 «Validación humana» (no hay `in-validation`; `review pass`
lleva a `done` y la aceptación es la fusión); toda la sección 7 «Correcciones
sin commit apresurado» (una corrección se committea y se revisa de nuevo);
«`done` sigue siendo provisional hasta cruzar una frontera durable» y «el
cierre definitivo requiere la frontera durable» (sólo una release registrada
es irreversible); «entrega un resultado completado o bloqueado»; «el humano
revisa los borradores y los aprueba» (aprueba objetivo y frontera); «la tarea
suele ser esa unidad» de commit (la unidad es la selección resuelta, con
cuatro clases). Siguen siendo verdad: propósito, conversación primero,
separación en changes, «sin aprobación no hay código», el commit de baseline,
el modelo de confianza, el estado global y los filtros y no-goals.
`test/intent.test.mjs` pina cinco frases, cuatro de ellas ya falsas;
`test/context.test.mjs` exige que `review.md` cite el modelo de confianza de
`INTENT.md`, no lee el fichero.

**`docs/usage-capture.md`.** Nadie lo referencia ni lo empaqueta. Coinciden
con el código la versión pinada de ccusage, el tiempo límite, los mensajes de
aviso, los grupos de `--by` y las pistas de `analyze`. Falsos: los comandos
`validation` y `reopen` como escritores de instantáneas; `[validation]` como
evento instantaneado (hoy sólo existe `accepted (merged <sha>)`, escrito por
`graduate` y `sync`, sin instantánea); el campo `event` con `validation` en
registros nuevos; la definición de `rework` sin el borde `[status] done →
in-progress` y con dos bordes retirados presentados como vigentes; la lista
de comandos sin instantánea, que no nombra `finding`, `sync`, `commit` ni
`release`. A verificar con el código delante: si `unrecordedTransitions`
cuenta una línea `[validation] accepted` como transición sin registro y la
pista `gap` la reporta.

**`docs/workflow-hardening.md`.** Nadie lo referencia; dos tests usan su
ruta como nombre de fixture, no su contenido. Nombra `in-validation`,
`blocked`, el DoR (106 veces), cápsulas de roles retirados, la gramática de
Plan por etiquetas, presupuestos en bytes y Prettier.

### Proposal

#### Solución elegida

Reescribir las secciones 5 a 8 y 10 de `INTENT.md` en el vocabulario del
contrato (objetivo y frontera, selección resuelta, hallazgo, fusión como
aceptación, release como única frontera) sin tocar las secciones que siguen
siendo verdad; reescribir `test/intent.test.mjs` como cinco guards
tolerantes; corregir los cuatro puntos de `docs/usage-capture.md` y añadir lo
que la verificación de `gap` diga; borrar `docs/workflow-hardening.md`.
Un change de prosa: `tdd: false`, porque no entrega comportamiento que un
test pueda ejercitar; la rama toca `test/`, así que pasa por revisión.

#### Alternativas descartadas

- **Reescribir `workflow-hardening.md`.** Inviable bajo el hook y sin
  lector.
- **Borrar `INTENT.md` y dejar el contrato como única intención.** El
  contrato dice cómo; `INTENT.md` dice por qué y qué no se hará, y `AGENTS.md`
  y `review.md` lo citan.
- **Poner las cifras del recorte en `INTENT.md`.** Caducan.

#### Escenarios

- **Un agente nuevo lee `INTENT.md`.** Encuentra el ciclo de seis estados, la
  aprobación sobre objetivo y frontera y la aceptación por fusión, sin nada
  que el contrato contradiga.
- **La épica cierra.** `product-principles` e `INTENT.md` dicen lo mismo; la
  épica decide cuál apunta a cuál al reconciliar.

## Specification

## Plan

## Log
- **2026-10-25T17:49:59Z** `[version]` 0.19.0
- **2026-10-25T17:50:04Z** `[note]` tdd: false porque el change entrega prosa (INTENT.md, docs) y guards de test sobre esa prosa, sin comportamiento que un test pueda ejercitar; la rama toca test/, así que pasa por revisión independiente.
- **2026-10-25T18:00:33Z** `[status]` draft → approved (human via conversation)
