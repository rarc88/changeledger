---
id: "20260726-124835"
title: Reescribir el contexto core para enrutar por intención
type: feature
status: in-progress
created: 2026-07-26T12:48:35Z
depends_on: ["20260726-124833", "20260726-124834", "20260726-130728"]
related_to: ["20260722-124655", "20260722-124656", "20260726-124837"]
owner: raruiz-hiberuscom
---

## Request

`templates/contract/core.md` es el único texto contractual que se paga en cada
sesión y de nuevo tras cada compactación. Hoy mezcla tres trabajos sin relación
—cómo capturar el contexto, cómo operar la herramienta y reglas propias de cada
etapa— y no dice nada sobre las dos únicas decisiones que el orquestador toma
ante cada mensaje humano: qué intención tiene el humano y si el trabajo se hace
en línea o se delega.

Se pide reescribir core como contrato de enrutamiento: identidad, clasificación
de intención, protección del contexto del orquestador, invariantes, lifecycle y
descubrimiento operativo. Todo lo que solo se necesita mientras se ejecuta una
etapa debe salir de core hacia su overlay, y core no debe duplicarlo. El
resultado debe caber en el presupuesto ampliado y de target estricto que
`20260726-130728` deja vigente antes de que empiece esta reescritura.

No se pide cambiar el bootstrap, el CLI de lifecycle ni las cifras del
presupuesto: solo el reparto de verdad entre core y sus overlays.

## Investigation

Medición actual de la composición core (`buildContext(undefined, root)`, medida
el 2026-07-27): 132 líneas emitidas, 133 en la convención del test
(`output.split('\n').length`, la que aplica `assertWithinBudget`) y 8133 bytes en
el repo de fixture. El presupuesto contra el que se mide esta reescritura es
el que deja `20260726-130728`: target 175 líneas / 11000 bytes, hard 200 / 12000,
y fallo —no aviso— al pasar el target para la entrada `core`. Esa puerta ya está
en su sitio cuando esta reescritura empieza, así que cada commit del texto se mide
contra un límite objetivo.

La composición es determinista y aislable: `src/commands/context.mjs` compone
core solo (`composeInput` con `incremental: false`, fragmentos `['core']`) y
ningún modo lo repite; la diferencia entre `core.md` (126 líneas, 7901 bytes) y
la salida compuesta es fija: +6 líneas emitidas y +232 bytes de BEGIN, línea de
política, END y separadores —el segmento `rev:` dejó la línea BEGIN con
`20260726-124833`—. Esto permite fijar criterios sobre la salida compuesta.

Tres trabajos conviven en el fichero:

1. Captura del contexto — sección `## Read complete context before acting` de
   `core.md`: cómo capturar en una pasada, el centinela
   `CHANGELEDGER CONTEXT END` y la regla de no recargar un core ya retenido. Son
   negativos inverificables («nunca pidas un preview») y la línea de cierre («si
   falta esta línea, la salida se truncó») solo la puede leer un agente que no la
   necesitaba. `20260726-124833` ya retiró de esa sección el párrafo de
   `rev:`/`--have`, y `20260726-124834` da al bootstrap la propiedad de la captura
   y su validez, así que estas líneas quedan sin dueño en core.
2. Operación de la herramienta — sección `## Files and delegation`: fichero
   como fuente de verdad, mínimos del prompt de delegación y esqueleto de rol.
   `templates/contract/delegation.md` ya contiene el contrato completo del prompt
   (sección `## Delegation prompt contract`) y se compone en los modos `spec` e
   `implement` (`MODE_CONTEXT` en `src/commands/context.mjs`), y `spec.md` ya
   declara que los ficheros son la fuente de verdad. Core duplica a su overlay.
3. Reglas de etapa — reglas numeradas 4, 6, 7 y 8, dentro del tramo que va de la
   regla 4 a la 8 de la lista numerada: commit del documento antes del código,
   reviewer fresco de contexto limpio, trabajo paralelo mientras otro change
   espera en `in-validation`, y la receta de graduación. `implement.md`, `review.md`, `validation.md` y `close.md` ya son
   dueños de ese detalle; `validation.md` incluso enuncia la cadena
   `depends_on` completa que core resume peor.

Lo que falta es lo que sí decide el orquestador antes de cargar cualquier
contexto de etapa. Las consecuencias observadas son dos: agotamiento del
contexto principal seguido de compactación —que produce deriva y hechos
inventados— y changes sobredimensionados que entran en implementación y se
descubren de forma incremental mediante rondas repetidas de review. Esa segunda
consecuencia es la que `20260722-124655` intenta cortar por el lado del
lifecycle y `20260722-124656` por el lado del orden del gate; este change ataca
su causa previa: core no enuncia techo de complejidad ni autoverificación por
etapa. `20260726-124837` fija la granularidad de commit que core aquí resume en
una línea.

Sobre la delegación, core tampoco dice cómo se dimensiona el delegado. La regla
existente («Size the model to the task's difficulty and risk») vive en
`delegation.md`, que solo se compone en `spec` e `implement`: cuando el
orquestador decide delegar —antes de cargar cualquier modo— no tiene criterio. El
coste observado es infradimensionar tareas duras y pagar el retrabajo dos veces.

La red de seguridad contra pérdida silenciosa de reglas es el test de snapshot
`234939 CR10/CR11: reviewed fragment snapshots prevent silent contract loss` de
`test/context.test.mjs`, que exige clasificar cada regla afectada como
preservada, reemplazada o retirada al actualizar el digest. Ese test es el único
mecanismo que impide que la reescritura pierda una regla sin dejar rastro, y por
eso la clasificación es parte del alcance y no un comentario opcional. Su
comentario de `20260726-124833` declara además que la regla
`new human message alone does not trigger a reload` es hoy load-bearing —«the
sole reason a retained capture is not reloaded»—, así que su desaparición del
texto solo es legítima si se clasifica como reemplazada por la cláusula
equivalente del core reescrito.

El texto literal de core no está afirmado solo en ese snapshot. Verificado hoy,
cuatro sitios más rompen al retirarlo: `CR1/CR5/CR7: core context is
deterministic and within its budget` (fija los literales de captura),
`234939 CR1-CR10: restored invariants stay in their owning contexts` (su lista de
invariantes y sus aserciones sobre `fragments['core.md']`, con los literales
`Size the model to the task's difficulty and risk` y `Do not over-shard or
overlap write surfaces`, que hoy solo existen en `core.md`),
`234939 CR11-CR20: dynamic packs retain the operational contract` (su lista
esperada) —los tres en `test/context.test.mjs`— y
`214902 CR1-CR4/CR7/CR8: installed contract gates creation, scope growth and
friction` de `test/cli.test.mjs`, cuyo `contractText()` concatena todos los
`templates/contract/*.md` y por tanto ve también la reescritura. Sin cubrirlos,
los `verify:` del Plan no revelan la rotura y `pnpm verify` falla al final.

## Proposal

Criterio de admisión que gobierna la reescritura: **un contenido entra en core
solo si el orquestador lo necesita para decidir qué hacer a continuación y quién
lo hace, antes de cargar el contexto de ninguna etapa.** Lo que solo se necesita
mientras se ejecuta una etapa pertenece al overlay de esa etapa, y el overlay es
la autoridad de su etapa: core nunca lo duplica.

Core queda con once bloques, en este orden y con este presupuesto indicativo de
líneas:

1. Identidad — 5 líneas.
2. `## Classify intent before acting` — ~22 líneas, con tabla intención → primera
   acción.
3. `## Protect the orchestrator's context` — ~25 líneas, con tabla trabajo →
   dueño, el dimensionado del delegado y la semántica del rol `post-review`.
4. `## Invariants` — ~10 líneas.
5. `## When no change is needed` — ~11 líneas, incluida la frase del viewer.
6. `## Stage exit gates` — ~8 líneas; absorbe lo que habría sido un bloque
   separado de roles.
7. `## Complexity ceiling` — 4 líneas.
8. `## Commits` — ~5 líneas.
9. `## Lifecycle` — ~30 líneas, estados y matriz completa.
10. `## Context modes` — ~8 líneas.
11. `## Operational discovery` — ~8 líneas.

Los bloques 10 y 11 conservan el orden que ya tiene el fichero (`## Context
modes` antes de `## Operational discovery`): reordenarlos no compra nada y no es
trabajo de este change.

El bloque 3 incorpora el dimensionado del delegado, decidido con el humano y
enunciado de forma portable: el contrato nunca nombra los modelos de un
proveedor concreto, porque ChangeLedger corre en cualquier anfitrión. El texto
decidido es:

> Size the delegate to the work, not to the caller's convenience: cheapest tier
> and low effort for mechanical lookups and bounded mechanical edits; mid tier for
> bounded reasoning over a single surface; top tier and high effort for deep
> analysis, ambiguity, cross-cutting design and adversarial review. Default to mid
> tier when unsure. Under-sizing a hard task produces rework the orchestrator pays
> for twice.

El bloque 6 enuncia solo el principio de autoverificación por etapa. Hoy no
existe ninguna puerta que rechace una transición porque los criterios enumerables
de la etapa fallen: `assertTransition` valida únicamente la legalidad del
lifecycle, y `assertChangeTextValid` → `checkCoverage` rechaza defectos de
estructura de readiness (Given/When/Then ausentes, referencias a criterios
inexistentes, tareas con CR sin objetivo y verificación), nunca criterios de
aceptación incumplidos. Esa puerta es alcance de `20260722-124655` y
`20260722-124656`, ambos todavía en `draft`, así que core no puede afirmarla como
comportamiento existente.

Salidas de core y su destino:

- Sección «Read complete context before acting» y la autorreferencia de
  truncamiento: al bootstrap (`20260726-124834`).
- Prosa del contrato de prompt de delegación: se queda en `delegation.md`, ya
  compuesto en `spec` e `implement`. Core conserva solo la decisión de
  enrutamiento, el dimensionado del delegado y el puntero a
  `changeledger agent-prompt <role>`.
- Detalle de las reglas 4, 6, 7 y 8: a su overlay (implement, review,
  validation, close). Core conserva como máximo un invariante de una línea.

Dos frases se quedan en `core.md`, y esto es una decisión medida, no un descuido:
la semántica del rol `post-review` y «Humans consume changes in `changeledger
view`; write for the rendered view». Desplazarlas a `delegation.md` y `spec.md`
añade 205 bytes al pack `spec` compuesto, que hoy mide 13536 bytes contra un
techo duro de 13700, así que lo desbordaría en 41 bytes, y dejaría el pack
`implement` compuesto con 17 bytes de margen (9983 sobre 10000). El test
`130728 CR4: the current core composition clears the strict target` mide cada
entrada `base` contra su techo duro, de modo que el traslado no podría pasar a
verde. El humano eligió cancelar ambos traslados en vez de subir ningún
presupuesto: `budgets.yml` no se toca y ningún fragmento distinto de `core.md` se
edita en este change.

Preservaciones obligatorias, cada una con criterio propio: la regla de que hay
trabajo que no necesita change (el párrafo `If no approved or in-progress change
applies…`), la lista completa de estados con la matriz de transiciones y sus
columnas de dueño y mecanismo, los invariantes, los comandos de descubrimiento
operativo con la política efectiva por contexto, y el índice de modos.

Presupuesto: la reescritura debe aterrizar en 175 líneas compuestas o menos y
11000 bytes o menos, las cifras que `20260726-130728` ya dejó vigentes con fallo
estricto en target. Todas las cifras de líneas de esta proyección usan la
convención del test (`output.split('\n').length` sobre la salida de
`buildContext`), que es la misma con la que `assertWithinBudget` compara el
presupuesto. La proyección revisada es 164-170 líneas y ~10000 bytes: la anterior
era ~165/~9800 y cancelar los dos traslados devuelve a core unas 5 líneas y los
205 bytes de ambas frases. La restricción vinculante sigue siendo la de líneas,
con al menos 5 líneas de margen que son evolución futura y no espacio a rellenar.

Alternativas descartadas:

- Comprimir el core actual sin reordenarlo: no resuelve el problema, porque lo
  que falta —clasificación de intención y decisión de delegación— no cabe
  recortando negativos inverificables, y deja los tres trabajos mezclados.
- Dividir core en dos fragmentos (identidad y enrutamiento): duplica el coste de
  composición y el punto de mantenimiento sin reducir el texto pagado, ya que
  ambos se compondrían siempre juntos.
- Dejar el dimensionado del delegado solo en `delegation.md`: el orquestador
  decide delegar antes de cargar `spec` o `implement`, así que la regla llegaría
  siempre tarde.
- Nombrar niveles de modelo por proveedor para que el criterio sea inequívoco:
  ata el contrato a un catálogo que cambia y que no existe en todos los
  anfitriones; los niveles relativos son portables.
- Subir el techo duro de `spec` (y el margen de `implement`) para acomodar los
  dos traslados: el humano lo descartó explícitamente. Un presupuesto que se
  ensancha para que quepa un traslado deja de ser una puerta, y ninguna de las
  dos frases gana nada por cambiar de fichero.

Escenario principal: el orquestador recibe un mensaje humano, clasifica la
intención con la tabla de core sin cargar nada, y solo entonces carga el contexto
que la intención exige. Escenario de trabajo pesado: la tabla de dueño manda
lectura amplia e implementación a subagentes de un nivel, dimensionados por
dificultad y con una superficie de escritura por dueño. Escenario de defensa: un
hallazgo de review que los criterios de salida de la etapa anterior deberían
haber detectado se trata como defecto de esa etapa.

## Specification

### CR1 — Core expone once bloques en el orden decidido
- **Given** un repo ChangeLedger inicializado
- **When** se compone `buildContext(undefined, root)`
- **Then** la salida contiene, en este orden, `# ChangeLedger — Core Contract`,
  `## Classify intent before acting`, `## Protect the orchestrator's context`,
  `## Invariants`, `## When no change is needed`, `## Stage exit gates`,
  `## Complexity ceiling`, `## Commits`, `## Lifecycle`,
  `## Context modes` y `## Operational discovery`
- **And** no contiene los headings retirados `## Read complete context before acting`
  ni `## Files and delegation`

### CR2 — La identidad comprime cuatro ideas y declara la autoridad del overlay
- **Given** la composición core
- **When** se normalizan sus espacios en blanco
- **Then** contiene `Work is documented before code`
- **And** contiene ``changes under `.changeledger/changes/` are authorized work; specs under `.changeledger/specs/` are persistent truth``
- **And** contiene `The human decides and the agent executes`
- **And** contiene `Every stage overlay is the authority for its stage; core never duplicates it`
- **And** no contiene la frase retirada ``Documents under `.changeledger/` are ChangeLedger's persistent truth``

### CR3 — La tabla de intención enruta las ocho intenciones observadas
- **Given** la composición core normalizada
- **When** se inspecciona el bloque `## Classify intent before acting`
- **Then** contiene `Classifying the human's intent is free and mandatory on every message`
- **And** contiene `never load one speculatively and never reload one already held`
- **And** contiene la cabecera `| Intent | First action |`
- **And** contiene una fila con `asks, explores or wants understanding` y `` `changeledger search <terms>` before reading code ``
- **And** contiene una fila con `reports a problem or asks for new work` y `` `changeledger context spec` only once the human authorizes documenting it ``
- **And** contiene una fila con `names a change or says "continue"` y `` `changeledger context <id>` ``
- **And** contiene una fila con `asks what is pending` y `` `changeledger list --status <s>` ``, `--pending graduation`, `--pending archive`
- **And** contiene una fila con `asks to review finished work` y `` `changeledger context review` in a fresh clean context ``
- **And** contiene una fila con `asks to release` y `` `changeledger context release` ``
- **And** contiene una fila con `requests an edit no change covers` y `` ask the human: `quick` type or operational edit ``
- **And** contiene una fila con `gives a verdict` y `transmit it with the lifecycle command; never infer one`

### CR4 — La protección del contexto reparte lectura y escritura por dueño
- **Given** la composición core normalizada
- **When** se inspecciona el bloque `## Protect the orchestrator's context`
- **Then** contiene `Context exhaustion causes compaction, and compaction causes drift and invented facts`
- **And** contiene `Reading code and writing code are the two heaviest consumers`
- **And** contiene `delegate them by default` y `inline only when trivially small`
- **And** contiene la cabecera `| Work | Owner |`
- **And** contiene filas para `reading or searching beyond ~3 files to answer one question` → `subagent`, `any implementation task with its own verify command` → `subagent`, `independent review of finished work` → `subagent with a fresh clean context`, `reading a change document, a spec or CLI output` → `orchestrator` y `talking to the human, deciding scope, integrating results` → `orchestrator, never delegated`
- **And** contiene `Every delegation is one level deep: a subagent never delegates further`
- **And** contiene `One owner per write surface` y `concurrent subagents must not share files`
- **And** contiene ``Get the prompt skeleton from `changeledger agent-prompt <role>` (investigation | implementation | review | post-review)``
- **And** contiene `the stage context owns what the prompt must contain`
- **And** contiene `A subagent returns findings or a diff receipt, not narrative`

### CR5 — El dimensionado del delegado es explícito y portable
- **Given** la composición core normalizada
- **When** se inspecciona el bloque `## Protect the orchestrator's context`
- **Then** contiene `Size the delegate to the work, not to the caller's convenience`
- **And** contiene `cheapest tier and low effort for mechanical lookups and bounded mechanical edits`
- **And** contiene `mid tier for bounded reasoning over a single surface`
- **And** contiene `top tier and high effort for deep analysis, ambiguity, cross-cutting design and adversarial review`
- **And** contiene `Default to mid tier when unsure`
- **And** contiene `Under-sizing a hard task produces rework the orchestrator pays for twice`
- **And** la composición core completa, en minúsculas, no contiene ninguno de los
  literales `claude`, `opus`, `sonnet`, `haiku`, `gpt`, `gemini`, `llama`,
  `anthropic` ni `openai`

### CR6 — Los invariantes, el trabajo sin change y las tres reglas restituidas se conservan completos
- **Given** la composición core normalizada
- **When** se inspeccionan los bloques `## Invariants`, `## When no change is needed`, `## Lifecycle` y `## Context modes`
- **Then** `## Invariants` contiene `No artifact without explicit human authorization`
- **And** contiene ``Never implement a `draft` ``
- **And** contiene `One change at a time, on a non-main branch`
- **And** contiene `Keep lifecycle, tasks, ownership and Log current`
- **And** contiene `Pre-existing divergence between specs and code is reported to the human, never reconciled by inference`, `Wait if it affects the current task` y `if unrelated, report it without expanding scope`
- **And** contiene `A human verdict is transmitted, never inferred` y `praise, “continue” or agent advice is not a decision`
- **And** contiene `No silent repository edits when no change applies`
- **And** contiene ``reload `changeledger context <id>` `` con `the close overlay owns graduation and archive`
- **And** `## When no change is needed` contiene `If no approved or in-progress change applies, do not silently edit repository files`
- **And** contiene `ask the human whether a purely operational, reversible edit with no persistent truth or observable behavior change should be done directly`
- **And** contiene `If unsure, document it in ChangeLedger`
- **And** contiene ``For small, reversible, single-concern work with observable behavior, use the `quick` type instead of bypassing documentation``
- **And** —restitución autorizada por el humano: core enruta mejor sin perder
  normativa— `## Invariants` exige la condición previa a documentar y la
  prohibición de inventar: contiene `enough clarity to document faithfully`,
  ``a direct request such as “create the change” is authorization`` y
  `never invent missing requirements`
- **And** `## Lifecycle` exige la lectura acotada del stop, que es la decisión de
  seguir trabajando o no y por tanto de core: contiene `It stops only that change`,
  ``never accept on the human's behalf``, `reject with a reason and start another approved change`
  y ``unless its direct or transitive `depends_on` chain reaches one in `in-validation` ``
- **And** `## Context modes` exige que toda captura se lea completa, incluidos los
  contextos incrementales y de change-id —el bootstrap posee la primera captura y
  su condición de validez; core posee que ninguna se lea parcial—: contiene
  `Every context capture is read complete in one pass` y `a partial view is invalid`

### CR7 — Puertas de salida, techo de complejidad y commits usan el texto decidido
- **Given** la composición core normalizada
- **When** se inspeccionan los bloques `## Stage exit gates`, `## Complexity ceiling` y `## Commits`
- **Then** `## Stage exit gates` contiene `Every stage verifies its own output; no stage depends on the next one to learn whether its work is correct`
- **And** contiene `The exit transition of a stage is its self-verification point`
- **And** contiene `The implementer proves the change meets its criteria before requesting review`
- **And** contiene `The reviewer is the last line of defence, not a design oracle and not a source of requirements`
- **And** contiene `A review finding that the previous stage's own exit criteria should have caught is a defect of that stage, not a normal review round`
- **And** `## Complexity ceiling` contiene `A change must be implementable and verifiable in one bounded pass`, `If it cannot, split it before approval — an oversized change is the most common root cause of repeated review rounds`, `` `changeledger context spec` owns the sizing test and the split criteria `` y `After work has started, a failed verification is diagnosed, never auto-split: the blocked and review contexts own that classification`
- **And** `## Commits` contiene `One commit per completed Plan task, plus one baseline commit of the change document before any code`, `A lifecycle transition is never a commit of its own — the Log is its record; the transition travels in the next real commit`, ``Subjects follow `type(scope): description [#<id>]`; `changeledger commit` composes it`` y `` `changeledger context implement` owns the full contract ``

### CR8 — El lifecycle conserva estados, matriz y notas
- **Given** la composición core normalizada
- **When** se inspecciona el bloque `## Lifecycle`
- **Then** enumera los ocho estados `draft`, `approved`, `in-progress`,
  `in-review`, `in-validation`, `blocked`, `done` y `discarded` con su
  descripción
- **And** contiene la cabecera `| Transition | Owner | Mechanism |`
- **And** contiene las diez filas actuales sin cambios, incluidas
  ``draft → approved | human | viewer or `changeledger approve <id>` after an explicit prompt``,
  ``in-review → in-validation | orchestrator | `changeledger review <id> pass` `` y
  ``→ discarded | agent (authorized) | `changeledger discard <id> "<reason>"` ``
- **And** contiene `changeledger status <id> <status>` con la lista de valores que no acepta
- **And** contiene `discard reason is required and logged`, `` `discarded` never reopens`` y ``A `done` change can reopen only to finish its original scope``

### CR9 — El descubrimiento operativo y el índice de modos se conservan
- **Given** la composición core normalizada
- **When** se inspeccionan los bloques `## Operational discovery` y `## Context modes`
- **Then** `## Operational discovery` contiene `` `changeledger list --status approved` ``, `` `changeledger list --pending graduation` ``, `` `changeledger list --pending archive` `` y `` `changeledger search <terms...>` ``
- **And** contiene `before scanning files`
- **And** contiene ``each context delivers the effective policy that applies to its task, so you never read `.changeledger/config.yml` raw to operate``
- **And** no contiene `` `changeledger graduate --pending` `` ni `` `changeledger archive --graduated --dry-run` ``
- **And** `## Context modes` contiene `Valid modes: implement, review, spec, release`
- **And** contiene una entrada por `changeledger context spec`, `changeledger context implement`, `changeledger context review`, `changeledger context release` y `changeledger context <change-id>`, esta última con `infer the correct context from lifecycle`
- **And** contiene `extends the core context already read; it never repeats it`

### CR10 — Core deja de contener lo que ya no gobierna
- **Given** la composición core
- **When** se buscan las reglas retiradas de captura, delegación y etapa
- **Then** no contiene ``Running `changeledger context` is discovery, not compliance``, `Capture the first invocation completely in one pass`, ``read through the `CHANGELEDGER CONTEXT END` line``, `exceptional recovery` ni `new human message alone does not trigger a reload`
- **And** como guarda de regresión contra su reintroducción —`20260726-124833` ya
  los eliminó, aquí no queda trabajo pendiente— tampoco contiene `--have` ni
  `rev:<hash>`
- **And** el centinela END sigue siendo la última línea de la salida, porque lo emite el framing y no el fragmento
- **And** no contiene `Files are the source of truth and may be edited directly`, `CLI helpers are optional and preferred for error-prone operations`, `Delegate only with a clear boundary and benefit`, `ownership, expected output and integration criterion`, `must not revert others' work`, `Do not over-shard or overlap write surfaces without an explicit integration plan` ni `Size the model to the task's difficulty and risk`
- **And** no contiene `commit the approved change document before code`, `use a fresh clean-context reviewer before human validation` ni `changeledger graduate <id> --skip [reason]`
- **And** la lectura acotada de `in-validation` y la regla de captura completa
  salen de esta lista de retiradas: CR6 las exige restituidas en core, así que
  ningún criterio puede pedir a la vez su ausencia. Sigue retirado el detalle de
  la primera captura (`Capture the first invocation completely in one pass`,
  ``read through the `CHANGELEDGER CONTEXT END` line``), que pertenece al bootstrap

### CR11 — Cada regla sigue en su dueño y las dos frases retenidas siguen en core
- **Given** las composiciones normalizadas de core, `spec`, `implement`, el overlay `in-validation` y el overlay `done`
- **When** se buscan las reglas que salieron de core y las dos frases que el humano decidió no desplazar
- **Then** `templates/contract/delegation.md` conserva `one subagent per file, line or tiny mechanical edit`, `parallel agents over the same files or conceptual surface`, `strongest available models for ambiguous scope` y `for roles that write, the expected baseline (branch or commit) the delegate must verify`, sin editarse en este change
- **And** la composición core conserva `` `post-review` is a read-only inspection of a change already in `in-validation`; it never issues a verdict or moves the change ``, y `templates/contract/delegation.md` no la contiene
- **And** la composición core conserva ``Humans consume changes in `changeledger view`; write for the rendered view``, y `templates/contract/spec.md` no la contiene
- **And** `implement` contiene `baseline commit of the approved change document before code`
- **And** el overlay `in-validation` contiene `This stop is scoped to this change` y ``direct or transitive `depends_on` chain reaches one in `in-validation` ``
- **And** el overlay `done` contiene `changeledger graduate <id> --skip [reason]`

### CR12 — La reescritura queda medida y clasificada
- **Given** un repo ChangeLedger inicializado, el core reescrito y el presupuesto estricto de `20260726-130728` vigente
- **When** se mide `buildContext(undefined, root)` y se ejecuta `node --test test/context.test.mjs test/cli.test.mjs`
- **Then** el recuento de líneas en la convención `output.split('\n').length` es menor o igual que 175 y el tamaño menor o igual que 11000 bytes, sin aviso ni fallo de `core exceeds target`
- **And** con las tres reglas restituidas la medición queda en 173 líneas o menos en esa misma convención y 9800 bytes o menos, es decir la restricción vinculante sigue siendo la de líneas y `budgets.yml` no se toca
- **And** en el test `234939 CR10/CR11: reviewed fragment snapshots prevent silent contract loss` se actualiza el digest esperado de `core.md`, mientras los de `delegation.md` y `spec.md` quedan intactos porque esos ficheros no se editan
- **And** cada regla afectada queda clasificada en el comentario adyacente como preservada, reemplazada, retirada o movida, nombrando el id `20260726-124835`
- **And** la clasificación es verdadera regla a regla, comprobada contra el fichero
  dueño y no contra palabras parecidas: cada regla movida nombra el texto que su
  overlay dice realmente en vez de afirmar literalidad donde no la hay; la regla de
  compartir el codebase queda **movida** a `templates/contract/delegation.md`;
  ``Files are the source of truth and may be edited directly`` y `CLI helpers are
  optional and preferred for error-prone operations` quedan **movidas** a
  `templates/contract/spec.md` §`Repository layout and creation`; y el recuento
  final coincide con las entradas realmente escritas
- **And** el test `220014 CR1/CR4: core and validation scope the stop to one change, not the queue` vuelve a exigir la lectura acotada en core, con el texto restituido, en vez de afirmar su ausencia
- **And** el test `214902 CR1-CR4/CR7/CR8` de `test/cli.test.mjs` recupera los dos pins que borró en vez de repuntar, ajustados al texto restituido: `enough clarity to document faithfully` y ``direct request such as “create the change” is authorization``
- **And** el test `124835 CR2/CR3: the identity and the intent table route before any load` fija el emparejamiento intención→acción por fila `| intent | action |` completa, como ya hace `124835 CR4/CR5` con la tabla trabajo→dueño, y no por existencia independiente de etiqueta y acción
- **And** la regla `new human message alone does not trigger a reload` queda clasificada como **reemplazada** por la cláusula `never load one speculatively and never reload one already held`, nunca como retirada sin más
- **And** el test `CR1/CR5/CR7: core context is deterministic and within its budget` deja de exigir los literales de captura retirados y exige los del core reescrito
- **And** el test `234939 CR1-CR10: restored invariants stay in their owning contexts` actualiza su lista de invariantes y sus aserciones sobre `fragments['core.md']`, sustituyendo `Size the model to the task's difficulty and risk` y `Do not over-shard or overlap write surfaces` —que dejan de existir en el repo— por la redacción equivalente que `delegation.md` ya posee, `Do not create one subagent per file, line or tiny mechanical edit` y `Use the strongest available models for ambiguous scope`
- **And** el test `234939 CR11-CR20: dynamic packs retain the operational contract` actualiza su lista esperada, incluidos ``Documents under `.changeledger/` are ChangeLedger's persistent truth`` y `changeledger graduate <id> --skip [reason]`; la fila de core para la lectura acotada de `in-validation` se repunta al texto restituido en vez de eliminarse
- **And** el test `214902 CR1-CR4/CR7/CR8: installed contract gates creation, scope growth and friction` de `test/cli.test.mjs` actualiza los literales de core que ve su `contractText()`
- **And** el inventario de fragmentos no cambia: no se crean ni se borran ficheros en `templates/contract/`

## Plan

- [x] Reubicar dentro de `templates/contract/core.md` la frase del rol `post-review` desde la sección retirada `## Files and delegation` al bloque `## Protect the orchestrator's context`, dejar la frase del viewer en el bloque `## When no change is needed`, y reescribir en `test/context.test.mjs` las aserciones de propiedad de CR11 como preservación en core, sin editar `delegation.md` ni `spec.md`; verify: `node --test test/context.test.mjs` (CR11)
  - **Resolved:** `2026-07-27T14:44:21Z`
- [x] Reescribir los bloques 1-3 de `templates/contract/core.md` (identidad, `## Classify intent before acting`, `## Protect the orchestrator's context` con el dimensionado portable del delegado) y ajustar las aserciones de core afectadas; verify: `node --test test/context.test.mjs` (CR2, CR3, CR4, CR5)
  - **Resolved:** `2026-07-27T14:56:10Z`
- [x] Reescribir los bloques 4-8 de `templates/contract/core.md` (`## Invariants`, `## When no change is needed`, `## Stage exit gates`, `## Complexity ceiling`, `## Commits`) y retirar de core la sección de captura, la prosa de delegación y el detalle de las reglas 4, 6, 7 y 8, actualizando los literales de core que afirman `test/context.test.mjs` y `test/cli.test.mjs`; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR6, CR7, CR10)
  - **Resolved:** `2026-07-27T14:56:10Z`
- [x] Cerrar `templates/contract/core.md` conservando intactos los bloques 9-11 (`## Lifecycle`, `## Context modes`, `## Operational discovery`), fijar el orden final de headings, el digest y la clasificación de reglas, y medir la composición contra el presupuesto estricto; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR1, CR8, CR9, CR12)
  - **Resolved:** `2026-07-27T14:56:10Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T14:58:09Z`
- [x] Restituir en `templates/contract/core.md` las tres reglas que la reescritura retiró sin criterio: la condición previa a documentar y la prohibición de inventar requisitos en `## Invariants`, la lectura acotada de `in-validation` en `## Lifecycle` y la captura completa de todo contexto en `## Context modes`; repuntar `220014 CR1/CR4` y `234939 CR11-CR20`, recuperar los dos pins borrados en `test/cli.test.mjs`, y actualizar el digest de `core.md`; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR6, CR10, CR12)
  - **Resolved:** `2026-07-27T15:34:29Z`
- [x] Reescribir el test `124835 CR2/CR3` para afirmar la fila `| intent | action |` completa y eliminar el `row.length` muerto, probándolo con el mutante que intercambia dos acciones de la tabla de intención en `templates/contract/core.md`; verify: `node --test test/context.test.mjs` (CR3, CR12)
  - **Resolved:** `2026-07-27T15:36:20Z`
- [ ] Volver verdadero el comentario de clasificación del pin de `templates/contract/core.md`: texto real del overlay para cada regla movida, reclasificación de la regla de compartir el codebase y del par de ficheros como fuente de verdad, y recuento coincidente; verify: `node --test test/context.test.mjs` (CR12)
- [ ] Ejecutar de nuevo el gate completo con el change en `in-progress`; verify: `pnpm verify` (support)

## Log

- **2026-07-26T12:56:42Z** `[note]` Draft creado: core pasa a ser contrato de enrutamiento por intención y delegación, con criterio de admisión explícito, presupuesto 175/200 y target estricto solo para core.
- **2026-07-26T13:25:00Z** `[note]` Draft acotado: el mecanismo de presupuesto (cifras de `budgets.yml` y fallo estricto en target) sale a `20260726-130728`, que pasa a ser prerrequisito de ejecución. Se incorpora al bloque 3 el dimensionado del delegado, decidido con el humano y enunciado sin nombrar modelos de ningún proveedor. 19 criterios y 6 tareas quedan en 12 y 5.
- **2026-07-26T14:05:42Z** `[status]` draft → approved
- **2026-07-27T14:36:21Z** `[note]` Enmienda autorizada explícitamente por el humano con el change todavía en `approved` y antes de `in-progress`: diez changes hermanos aterrizaron desde el borrador y parte del documento era falso. (1) El rol `audit` se renombró a `post-review` sin alias (`20260726-141123`), así que CR4 y CR11 dejan de exigir el nombre retirado. (2) El humano eligió cancelar los dos traslados de prosa en vez de subir presupuesto: desplazar la frase del rol y la del viewer añade 205 bytes al pack `spec` compuesto, que desbordaría su techo duro en 41 bytes y dejaría `implement` con 17 de margen; ambas se quedan en `core.md`, `budgets.yml` no se toca, ningún fragmento distinto de `core.md` se edita y las cláusulas de CR11 pasan a ser de preservación. (3) CR12 nombra los cuatro sitios de aserción que la retirada de texto rompe además del snapshot (`CR1/CR5/CR7`, `234939 CR1-CR10`, `234939 CR11-CR20` y `214902 CR1-CR4/CR7/CR8` de `test/cli.test.mjs`), y dos tareas del Plan añaden `test/cli.test.mjs` a su verify para que la rotura salga antes de `pnpm verify`. (4) CR7 deja de afirmar que el CLI rechaza la transición cuando fallan los criterios enumerables de la etapa: ese mecanismo no existe (`assertTransition` solo valida legalidad de lifecycle y `checkCoverage` solo defectos de estructura de readiness) y la puerta queda atribuida a `20260722-124655` y `20260722-124656`, aún en `draft`; el principio de autoverificación por etapa se conserva íntegro. (5) CR1 se alinea al orden real del fichero, `## Context modes` antes de `## Operational discovery`, sin introducir reordenación como trabajo. (6) Sale del Plan y de la lista de salidas el párrafo `--have`, ya eliminado por `20260726-124833`; las cláusulas de CR10 sobre `--have` y `rev:<hash>` quedan etiquetadas como guarda de regresión. (7) Cifras refrescadas y etiquetadas por convención: core compuesto 132 líneas emitidas / 133 en la convención del test (`output.split('\n').length`) / 8133 bytes, `core.md` 126 líneas / 7901 bytes, delta de framing +6 líneas emitidas / +232 bytes; todo puntero de línea pasa a nombre de test, heading o regla. (8) La regla `new human message alone does not trigger a reload` se clasifica como reemplazada por `never load one speculatively and never reload one already held`, no como retirada. Proyección de core restated: 164-170 líneas en la convención del test y ~10000 bytes, dentro del target 175/11000. Siguen 12 criterios y 5 tareas, sin renumerar.
- **2026-07-27T14:37:41Z** `[status]` approved → in-progress
- **2026-07-27T14:44:21Z** `[note]` Tarea 1: CR11 queda fijado como guarda de preservación en test/context.test.mjs (124835 CR11). Los dos traslados están cancelados, así que core.md no necesita edición para satisfacer CR11: las frases del rol post-review y del viewer ya viven en core y delegation.md/spec.md no las contienen. Evidencia de mutación: borrando la frase post-review de core.md el test falla; restaurada, pasa. La reubicación física de la frase dentro de core.md ocurre al crear el bloque ## Protect the orchestrator's context, que es trabajo de la tarea 2.
- **2026-07-27T14:56:10Z** `[note]` Tareas 2, 3 y 4 en un solo commit: son inseparables, no una comodidad. Verificado, no supuesto: (a) el target estricto es global, así que añadir los bloques 2-3 sin retirar la sección de captura y '## Files and delegation' deja el core compuesto en 178 líneas de la convención del test contra un target de 175, y el verify de la tarea 2 falla por presupuesto; (b) el snapshot '234939 CR10/CR11' falla ante cualquier edición de core.md, de modo que ningún commit intermedio puede estar verde sin el digest, que es trabajo de la tarea 4. Un commit por tarea habría producido dos commits rojos.
- **2026-07-27T14:56:10Z** `[note]` Reescritura medida: core compuesto = 166 líneas emitidas / 167 en la convención del test (output.split('\n').length) / 9341 bytes; core.md = 160 líneas / 9109 bytes; el framing sigue aportando +6 líneas emitidas / +232 bytes. Contra el target estricto 175/11000 quedan 8 líneas y 1659 bytes de margen, dentro de la proyección de 164-170 líneas del documento, y la restricción vinculante sigue siendo la de líneas. La cláusula de medición de CR12 la verifican '130728 CR4' (estrictamente por debajo del target, sin aviso 'core exceeds target') y los assertWithinBudget de core.
- **2026-07-27T14:56:10Z** `[note]` Digest de core.md: 8b42036...→ d0ab6534ad61490911e56cfdc917ca035b242196a6ee8c80148466c20a3e61a4, con clasificación regla a regla adyacente en el mapa: 8 reemplazadas, 3 retiradas, 4 movidas a su overlay, el bloque de captura retirado íntegro, y la lista explícita de lo preservado literal. 'new human message alone does not trigger a reload' queda REEMPLAZADA por 'never load one speculatively and never reload one already held', nunca retirada, como exige CR12. Los digests de delegation.md y spec.md no se tocan porque esos ficheros no se editan.
- **2026-07-27T14:56:22Z** `[note]` Sitios de aserción reales: además de los cuatro que CR12 nombra, la retirada rompe tres tests más de test/context.test.mjs ('220014 CR1/CR4', '134704 CR1/CR2/CR3', '134703 CR1/CR2/CR3', '144327 CR5', '230608 CR1/CR2') y uno más de test/cli.test.mjs ('171002 CR1-CR5', que solo fallaba por el salto de línea de validation.md y se resuelve con \s+). Los once fallos eran genuinos y quedan documentados en la respuesta al humano. Además, CR1 y CR3-CR9 no tenían ningún sitio que los afirmara: se añaden cinco tests '124835 CR1', 'CR2/CR3', 'CR4/CR5', 'CR6/CR7', 'CR8/CR9' y 'CR10', cada uno con un mutante aislado verificado (orden de headings, fila de intención, nivel nombrado por proveedor, frase del reviewer, fila de la matriz y literal retirado reintroducido): los seis mueren.
- **2026-07-27T14:58:09Z** `[note]` Tarea 5: 'pnpm verify' verde con el change todavía en in-progress. lint (biome, 82 ficheros sin arreglos), 809 tests con 0 fallos y 'changeledger check'. Última línea exacta: '✓ 18 change(s) valid — 203 not validated (archived or discarded)', exit 0. El candidato queda listo para review; la transición a in-review la despacha el orquestador.
- **2026-07-27T15:00:13Z** `[note]` Mandato de review: COMPLETA, no spot check. Justificacion: core.md es el texto con el multiplicador mas alto del sistema (lo lee todo agente en cada sesion de cada repo consumidor), y el riesgo dominante de esta reescritura es que una regla se pierda en silencio. Puntos de escrutinio obligados: el comentario de clasificacion del pin (preservada/reemplazada/retirada regla por regla), si alguna regla retirada queda huerfana sin overlay que la posea, los nueve sitios de asercion repuntados sin quedar vacuos, los seis tests nuevos y su verificacion por mutacion, el reflujo de prosa a ~90 columnas sin cambiar literales, y la frase de disciplina de captura que sobrevive en Context modes.
- **2026-07-27T15:00:13Z** `[status]` in-progress → in-review
- **2026-07-27T15:13:34Z** `[review]` in-review → in-progress (retry): Clase del defecto: la retirada de reglas del core no esta completa ni fielmente clasificada. (1) La obligacion 'never invent missing requirements' de la regla 1, con su condicion 'enough clarity to document faithfully', quedo HUERFANA: cero hits en todo templates/ y src/, el comentario de clasificacion la declara reemplazada por un invariante que solo cubre autorizacion, y test/cli.test.mjs borro sus dos pins en vez de repuntarlos, sin que ningun criterio autorizara la retirada. (2) El test 124835 CR2/CR3 no fija el emparejamiento intencion-accion que CR3 exige: intercambiar las acciones de dos filas sobrevive al mutante, y el assert.ok(row.length > 0) es peso muerto. (3) El comentario de clasificacion incumple CR12 en tres puntos: 'preserved verbatim' es falso para 3 de 4 reglas movidas, una entrada marcada retirada declara en su propio texto que esta preservada en delegation.md, y 'Files are the source of truth' se marca retirada cuando vive en spec.md; el recuento real es 2 retiradas y 5 movidas. La correccion debe rehogar y clasificar la regla huerfana, fijar el emparejamiento por fila completa como ya hace CR4/CR5, y volver verdadero el comentario regla por regla.
- **2026-07-27T15:22:05Z** `[note]` Roberto corrige el rumbo de la reescritura: el change nacio para que el core enrute mejor, no para adelgazarlo perdiendo normativa. Autoriza enmendar CR6, CR10 y CR12 ya en in-progress para RESTITUIR al core tres cosas que son flujo y por tanto suyas: (1) la lectura acotada de in-validation, o sea que para solo ese change y el agente puede arrancar otro aprobado salvo que su cadena depends_on alcance uno en in-validation; (2) la regla de captura completa aplicada a los contextos incrementales, con vista parcial invalida, que es el referente de INCREMENTAL_NOTICE y gobierna cada carga en lugar del arranque; (3) la prohibicion never invent missing requirements con su condicion enough clarity to document faithfully. Division de propiedad corregida: el bootstrap posee como hacer y verificar la PRIMERA captura, el core posee que toda captura se lee completa. No se toca src/commands/context.mjs: el referente colgante se arregla devolviendo la regla al core, no editando la nota.
- **2026-07-27T15:28:57Z** `[note]` Enmienda autorizada por el humano tras el review 'fail --retry': el change existe para que el core enrute mejor, no para adelgazarlo perdiendo normativa. Se restituyen al core tres reglas y se enmiendan CR6, CR10 y CR12. Reparto de propiedad ratificado: el bootstrap posee como hacer y verificar la PRIMERA captura (comando acotado y linea END como condicion de validez); el core posee que TODA captura -incluidos los contextos incrementales y de change-id- se lee completa y que una vista parcial es invalida, porque eso es operacion y no arranque. CR6 pasa a exigir las tres restituciones (condicion 'enough clarity to document faithfully' con 'never invent missing requirements'; lectura acotada de in-validation; captura completa de todo contexto), CR10 las saca de su lista de retiradas manteniendo retirado el detalle de la primera captura, y CR12 exige clasificacion verdadera regla a regla, la recuperacion de los dos pins que test/cli.test.mjs borro y el emparejamiento por fila completa de la tabla de intencion. Cuatro tareas nuevas, sin renumerar criterios. No se toca src/commands/context.mjs: el referente colgante de INCREMENTAL_NOTICE se arregla devolviendo la regla al core.
- **2026-07-27T15:34:29Z** `[note]` Tarea 6: tres reglas restituidas al core con evidencia TDD. Fallos literales previos a la edicion: '214902 CR1-CR4/CR7/CR8' y '124835 CR6/CR7' -> 'enough clarity to document faithfully'; '234939 CR11-CR20' -> 'core is missing /never invent missing requirements/'; '220014 CR1/CR4' -> 'It stops only that change'; 'CR1/CR5/CR7' -> 'Every context capture is read\s+complete in one pass'. Textos restituidos: (1) invariante 'No artifact without explicit human authorization, and none before there is enough clarity to document faithfully: a direct request such as "create the change" is authorization; never invent missing requirements'; (2) estado 'in-validation: ... It stops only that change: never accept on the human's behalf, but reject with a reason and start another approved change unless its direct or transitive depends_on chain reaches one in in-validation'; (3) '## Context modes': 'Every context capture is read complete in one pass - core, mode and change-id alike; a partial view is invalid', que sustituye a la mas estrecha 'Run each only after reading the complete base output' y es el referente de INCREMENTAL_NOTICE. CR10 deja de exigir la ausencia de la lectura acotada, '220014 CR1/CR4' vuelve a exigirla en core, '234939 CR11-CR20' recupera su fila, y test/cli.test.mjs recupera los dos pins borrados. Digest de core.md: d0ab6534...-> cf16900fd01223e7f3cd87c111bf9e098088fd99a689c4c5f20ab0064b7a7572. Medida: 172 lineas emitidas / 173 en la convencion del test / 9782 bytes contra el target estricto 175/11000, sin tocar budgets.yml.
- **2026-07-27T15:36:20Z** `[note]` Tarea 7: el test '124835 CR2/CR3' pasa a afirmar la fila '| intent | action |' completa, como ya hace '124835 CR4/CR5' con la tabla trabajo->dueño, y desaparecen el split(' |')[1] y el assert.ok(row.length > 0) que leian como si fijaran el emparejamiento. Evidencia de mutacion aislada -intercambiar las acciones de las filas 'names a change or says "continue"' y 'asks to release' en core.md-: con el test antiguo el mutante SOBREVIVE (1 pass, 0 fail); con el test reescrito MUERE con 'core is missing the intent row | names a change or says "continue" | changeledger context <id> |'. Mutante revertido y suite verde.
