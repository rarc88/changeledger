---
id: "20261025-174959"
title: "INTENT.md y docs describen el flujo que el contrato sirve: sin validación humana, sin bloqueo, sin correcciones aisladas; el acta de julio se retira"
type: change
status: done
created: 2026-10-25T17:49:59Z
depends_on: []
archived: true
reviewed: true
branch: change/20261025-174959
related_to:
  - "20261023-181753"
  - "20261024-121022"
  - "20261024-202659"
  - "20261024-202718"
parent: "20261023-181733"
owner: raruiz-hiberuscom
tdd: false
release_impact: none
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

Escrita en `in-progress` con el código delante (`dev` en `2f481a54`). Las
comprobaciones sobre prosa son barridos y guards tolerantes a la redacción,
nunca pins de frase literal (AGENTS.md). Verificado antes de escribir:
`unrecordedTransitions` en `src/usage-analysis.mjs` filtra por tipo `status`,
`review` y `validation` sin mirar `outcome`, así que la línea `[validation]
accepted (merged <sha>)` que `graduate` y `sync` escriben sin instantánea
cuenta en la pista `gap`; es un desajuste de código fuera de esta frontera y
queda registrado como hallazgo (CR5).

### CR1 — INTENT.md cuenta el ciclo vigente
- **Given** `INTENT.md` tras el cambio
- **When** se leen las secciones del flujo y las reglas generales
- **Then** contiene, con tolerancia a la redacción: que el humano aprueba el objetivo y la frontera de un draft y que Specification y Plan se escriben en `in-progress` con el código delante; que la revisión independiente existe cuando la rama toca código fuera del ledger y no según el tipo; que la aceptación es la fusión de la rama en la de integración y que una entrega vuelve a `in-progress` con razón; que una corrección tras un `fail` o un rechazo se committea como una selección resuelta más y se revisa de nuevo; que la unidad de commit es la selección resuelta; que sólo una release registrada es irreversible; que un hallazgo fuera de la frontera se registra con `changeledger finding` y lo promueve el humano; que `discarded` es terminal
- **And** no contiene `bloqueado`, `validación humana`, `sin commit`, `frontera durable`, `provisional`, `algunos tipos de change` ni `ampliación material`

### CR2 — Lo que sigue siendo verdad no cambia
- **Given** `git diff origin/dev -- INTENT.md`
- **When** se inspecciona
- **Then** las secciones «Propósito», «1. Conversación primero», «2. Creación del borrador», «Estado global» y «Filtros de evolución del producto» no tienen líneas cambiadas, y la frase «**Commit es confianza.** ChangeLedger no defiende contra quien ya puede escribir en el repositorio…» sigue idéntica, porque `review.md` cita ese modelo de confianza y un guard de `test/context.test.mjs` lo exige
- **And** `INTENT.md` no contiene ninguna cifra de palabras, fragmentos, tipos o estados del contrato

### CR3 — El test de INTENT guarda obligaciones, no frases
- **Given** `test/intent.test.mjs`
- **When** se ejecuta contra `INTENT.md` nuevo y contra `git show origin/dev:INTENT.md`
- **Then** pasa contra el nuevo y falla contra el antiguo, con cinco guards tolerantes: el humano aprueba objetivo y frontera; la aceptación es la fusión en integración; una entrega vuelve a `in-progress` con razón; sólo una release registrada es irreversible; `discarded` es terminal
- **And** ningún guard pina una frase completa, el nombre del test describe la obligación y ninguna línea añadida lleva un id de change ni un `CRn`

### CR4 — usage-capture.md dice qué toma instantánea hoy
- **Given** `docs/usage-capture.md`
- **When** se leen las secciones de instantáneas, del registro y del análisis
- **Then** los escritores de instantánea son la creación (`new`, `apply` con `target: "new"`), `status`, `approve`, `review`, `discard`, `status --human` al devolver una entrega, una transición del viewer y una entrada `status` de `apply`; `validation` y `reopen` no aparecen como comandos; dice que `[validation] accepted (merged <sha>)`, escrito por `graduate` y `sync`, no toma instantánea; el campo `event` de un registro nuevo es `created | status | review` y `validation` sólo aparece en registros anteriores; un veredicto fallido es `[review] in-review → in-progress` o `[status] done → in-progress`, y los bordes `in-review → blocked` e `in-validation → in-progress` sólo clasifican registros de ledgers anteriores; la lista de comandos sin instantánea nombra `finding`, `sync`, `commit` y `release` o se enuncia como regla positiva
- **And** la versión pinada de ccusage, el tiempo límite, los mensajes de aviso, los grupos de `--by` y las pistas de `analyze` no cambian, porque coinciden con el código

### CR5 — La pista gap se documenta como es y el desajuste queda registrado
- **Given** la sección de `gap` de `docs/usage-capture.md`
- **When** se lee
- **Then** dice que la pista cuenta también las líneas `[validation] accepted`, en cualquier disposición, porque hoy el análisis filtra por tipo de evento y no por resultado
- **And** el Log de este change registra con `changeledger finding` el desajuste, nombrando `unrecordedTransitions` y la condición que lo corrige (`outcome !== 'accepted'`), para que el humano lo promueva si quiere

### CR6 — El acta de julio desaparece sin dejar referencias
- **Given** la rama del change
- **When** se lista `docs/` y se buscan referencias
- **Then** `docs/workflow-hardening.md` no existe; `docs/changeledger-v1-plan.md` y `docs/usage-capture.md` sí; `grep -rn "workflow-hardening" README.md AGENTS.md CONTRIBUTING.md INTENT.md src/ bin/ docs/` no devuelve nada; las dos apariciones en `test/cli.test.mjs` y `test/cli-bin.test.mjs` son nombres de fichero de fixtures temporales, que no leen el fichero real, y se quedan

### CR7 — Ninguna línea añadida cita al ledger
- **Given** los commits de la rama
- **When** `sh hooks/no-ledger-refs.sh origin/dev...HEAD`
- **Then** sale 0 sin salida

### CR8 — El día después
- **Given** la rama con todo lo anterior
- **When** `pnpm verify` y `node bin/changeledger.mjs context`
- **Then** la suite pasa entera, `check` es verde y la captura del core no cambia de tamaño, porque `INTENT.md` y `docs/` no forman parte del contrato

## Plan

- [x] Reescribir en `INTENT.md` las secciones 3 a 10 del flujo y las reglas generales en el vocabulario del contrato, sin tocar propósito, conversación, creación, modelo de confianza, estado global ni filtros
  - **Target:** `INTENT.md`
  - **Verify:** `node --test test/intent.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-25T18:10:04Z`
- [x] Reescribir `test/intent.test.mjs` como cinco guards tolerantes, rojos contra el `INTENT.md` de `origin/dev`
  - **Target:** `test/intent.test.mjs`
  - **Verify:** `node --test test/intent.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-25T18:10:05Z`
- [x] Corregir `docs/usage-capture.md`: escritores de instantánea, campo `event`, bordes de `rework`, comandos sin instantánea y la pista `gap`; registrar el hallazgo sobre `unrecordedTransitions`
  - **Target:** `docs/usage-capture.md`
  - **Verify:** `grep -n "reopen\|validation\b" docs/usage-capture.md`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-10-25T18:10:06Z`
- [x] Borrar `docs/workflow-hardening.md` y comprobar que nada lo referencia
  - **Target:** `docs/workflow-hardening.md`
  - **Verify:** `grep -rn "workflow-hardening" README.md AGENTS.md CONTRIBUTING.md INTENT.md src/ bin/ docs/`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-25T18:10:06Z`
- [x] Hook sobre la rama, suite completa y `check` antes de pedir la revisión
  - **Support:**
  - **Verify:** `sh hooks/no-ledger-refs.sh origin/dev...HEAD && pnpm verify`
  - **Criteria:** CR7, CR8
  - **Resolved:** `2026-10-25T18:10:07Z`

## Log
- **2026-10-25T17:49:59Z** `[version]` 0.19.0
- **2026-10-25T17:50:04Z** `[note]` tdd: false porque el change entrega prosa (INTENT.md, docs) y guards de test sobre esa prosa, sin comportamiento que un test pueda ejercitar; la rama toca test/, así que pasa por revisión independiente.
- **2026-10-25T18:00:33Z** `[status]` draft → approved (human via conversation)
- **2026-10-25T18:00:37Z** `[status]` approved → in-progress
- **2026-10-25T18:00:37Z** `[branch]` set: change/20261025-174959 (auto)
- **2026-10-25T18:02:03Z** `[finding]` unrecordedTransitions en src/usage-analysis.mjs cuenta la línea [validation] accepted (merged <sha>) como transición sin registro de uso, así que la pista gap de analyze sobrecuenta en un ledger activado; la condición que lo corrige es filtrar outcome !== 'accepted' junto al tipo. Fuera de esta frontera por decisión del Request.
- **2026-10-25T18:10:08Z** `[note]` Selección entregada: INTENT.md secciones 3–10 y reglas generales reescritas por el orquestador en el vocabulario del contrato; test/intent.test.mjs con cinco guards tolerantes (cuatro rojos contra el INTENT.md de origin/dev; «discarded es terminal» ya era verdad); docs/usage-capture.md corregido con respaldo de código línea a línea; docs/workflow-hardening.md borrado (2.195 líneas, sin referencias). CR5 enmendado: el sello de aceptación se escribe en las dos disposiciones, no sólo en un ledger activado. Residuales: la cadena de la pista rework en usage-analysis.mjs sigue diciendo «after a failed review or validation»; apply no toma instantánea en un lote vacío y el doc sólo nombra el dry-run.
- **2026-10-25T18:10:09Z** `[status]` in-progress → in-review
- **2026-10-25T18:10:14Z** `[note]` Mandato de revisión: auditoría completa del rango 2f481a54..HEAD (un commit) contra CR1–CR8.
- **2026-10-25T18:19:26Z** `[review]` in-review → in-progress: Ronda 1: CR3 — los guards 1, 2 y 3 de test/intent.test.mjs se satisfacen sin su obligación (los encabezados sin punto cruzan al [^.]* y la frase del fail de revisión satisface al guard de la entrega devuelta); corrección: [^.\n] y anclar el guard 3 en «entreg». Menores en la misma ronda: usage-capture describe done → in-progress sólo como rechazo humano cuando la clave no distingue al actor; INTENT.md dice que la re-revisión inspecciona todo lo entregado (es bajo el mandato declarado), que graduación y archivo se deshacen por su documentación (el archivo borra la rama local y eso no se deshace) y que el marcador va siempre en el asunto (con dos changes va en el cuerpo); la retrospectiva es tras el cierre; el hijo sí registra --skip. Clase: enumeración incompleta dentro de la estrategia verificada.
- **2026-10-25T18:20:28Z** `[note]` Corrección de la ronda 1: guards con [^.\n] (un encabezado sin punto ya no presta palabras a la frase siguiente) y el guard de la entrega devuelta anclado en «entreg»; cada uno de los tres falla contra su mutante y cuatro fallan contra el INTENT.md de origin/dev. INTENT.md: la re-revisión es bajo el mandato declarado y sólo si la rama toca código; la graduación se vuelve a resolver y el archivo se deshace en el documento pero no devuelve la rama borrada; el marcador va en el cuerpo cuando varios changes comparten commit; el hijo de una épica registra un skip; la retrospectiva es tras el cierre. usage-capture: done → in-progress es cualquier devolución de una entrega, la registre el humano o el agente. Precisión al hallazgo F1: el sello de aceptación se escribe en las dos disposiciones, no sólo en un ledger activado. Mandato de la segunda revisión: los defectos nombrados y cualquier regresión de la corrección.
- **2026-10-25T18:20:29Z** `[status]` in-progress → in-review
- **2026-10-25T18:24:49Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-25T18:25:18Z** `[note]` Tras el pass, reajuste de ancho a 80 columnas de los dos párrafos de docs/usage-capture.md que la corrección dejó con líneas largas (observación cosmética del revisor); sólo saltos de línea, sin cambio de contenido, committeado como cierre.
- **2026-10-25T18:25:19Z** `[graduation]` skipped: hijo de la épica 20261023-181733: la épica reconcilia product-principles.md (duplica los filtros de INTENT.md) y usage.md al cerrar
- **2026-10-25T18:50:02Z** `[finding]` Test intermitente en CI (Ubuntu, Node 24): el guard «an unprobeable path keeps its cached name and the listing completes» de test/registry.test.mjs asume que listProjects conserva el orden de registro, pero recorre Object.entries(readRegistry()) y una clave numérica se enumera primero; init genera project_id con randomBytes(5) en hex, que sale todo dígitos ~0,9 % de las veces (en el fallo, 1717083302). Arreglo: ordenar explícitamente en listProjects o no depender del orden en el test.
- **2026-10-25T19:25:52Z** `[archive]` archived
- **2026-10-25T19:30:56Z** `[finding]` 1 promoted #20261025-174739
- **2026-10-25T19:30:56Z** `[finding]` 2 promoted #20261025-174739
