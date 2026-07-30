---
id: "20260722-124655"
title: El fallo se clasifica por clase antes de corregirse
type: feature
status: in-validation
created: 2026-07-22T12:46:55Z
depends_on: []
related_to:
  - "20260726-124836"
  - "20260726-194220"
  - "20260727-194234"
  - "20260730-183520"
owner: raruiz-hiberuscom
---

## Request

Reescritura total de este draft por decisión de Roberto (2026-07-30): el diseño
original —un contador que bloqueaba al segundo rechazo— murió porque congela
casos legítimos, y `20260727-194234` es el contraejemplo medido: dos rondas de
la misma clase de defecto (residuos de un reemplazo global), la segunda con
mandato mínimo, y el change salió bien — un contador lo habría bloqueado.

Lo que sí falta, y es lo que este change escribe: **tras un fallo diagnosticado
—veredicto `fail` del revisor o rechazo humano en `in-validation`— nadie exige
clasificarlo antes de corregir**. Hoy ambos caminos reciben el mismo parche
local iterando sobre el último hallazgo. El coste medido de no clasificar:
`20260726-124836` gastó 6 rondas, 5 de ellas correcciones flojas sucesivas
sobre el mismo guard — cada ronda arreglaba la instancia señalada y daba la
clase por cerrada.

Diseño decidido por Roberto (2026-07-30, cuatro decisiones):

1. El contrato nombra la **clasificación como paso obligatorio**, y las salidas
   amplias como ilustración no exhaustiva, no como enum cerrado.
2. El **rechazo humano** en `in-validation` recibe la misma clasificación.
3. La **sede de la taxonomía es `blocked.md`** — el core ya le atribuye esa
   propiedad; los demás fragmentos apuntan sin repetir.
4. **Solo prosa y guards, sin mecanismo**: ni contador, ni episodios, ni
   métricas nuevas.

## Investigation

Investigación delegada fresca contra HEAD (2026-07-30):

- **El ancla del core ya existe**: *"After work has started, a failed
  verification is diagnosed, never auto-split: the blocked and review contexts
  own that classification"* (`core.md`, sección *Complexity ceiling*). Este
  change cumple esa promesa; el core no se toca.
- **El split de veredictos ya tiene forma de clasificación**: `fail --retry` =
  *"fixable defect inside the authorized contract"*, `fail --block` =
  *"correction requires scope or product judgment"* (`review.md`). El paso de
  clasificar se engancha ahí sin vocabulario nuevo.
- **`blocked.md` hoy son 12 líneas sin taxonomía** — solo distingue
  "resoluble dentro del alcance autorizado" de "exige juicio de alcance o
  producto". Presupuesto medido: 445/1250 tokens, 45/125 líneas — 805 tokens de
  holgura. **Ningún guard pinnea su contenido** (solo el inventario estructural
  nombra el fichero): coste de re-pin cero.
- **`validation.md` describe el rechazo sin clasificación**: *"Rejection
  requires a reason and returns the same change to `in-progress`"* y ordena
  actualizar Specification/Plan según haga falta. Su párrafo no está pinneado;
  las dos filas de la tabla de transiciones del core que citan `validation`
  sí lo están (`test/context.test.mjs`, pins de la matriz) y no se tocan.
- **`implement.md` queda excluido a propósito**: está a ~125 tokens de su techo
  y su párrafo de corrección lleva la frase de la vuelta a `in-review` recién
  pinneada por `20260730-183520`. La clasificación no necesita sede ahí: ocurre
  antes de iterar, y el camino de corrección ya remite al contexto que toque.
- **Precedentes que fijan las salidas como reales**: `20260726-194220` usó
  extensión con re-aprobación tras un rechazo humano (Log del 2026-07-26:
  Roberto rechazó, se extendió el alcance con criterios nuevos y re-aprobación,
  y una fuga salió como change propio — extensión y partición en un mismo
  caso), sin que el contrato nombrara ninguna de las dos. `20260727-194234`
  fija el caso contrario: dos rondas de la misma clase son corrección normal.
- **Guards colindantes que la implementación no puede romper**, verificados:
  el guard de concepto 8 (gate antes de in-review + revisor fresco read-only,
  regexes sobre el pack de review), y la entrada del cuantificador del revisor
  en `DELEGATION_OBLIGATIONS`, cuyo comentario documenta un falso positivo ya
  vivido con la línea *"fixable defect inside the authorized contract"* — la
  prosa nueva de review.md debe redactarse sin re-crear ese solape.
- Presupuestos de las otras sedes: `base.review` 971/2500, overlay
  `in-validation` 398/1250 — holgura amplia en ambas.
- Relacionados declarados: `20260726-124836` (el coste de no clasificar),
  `20260726-194220` y `20260727-194234` (los dos precedentes),
  `20260730-183520` (la vuelta a in-review que este change no debe duplicar).
  Todos cerrados → `related_to`.

## Proposal

**`blocked.md` gana la taxonomía** (sede única, con el margen y el coste de
re-pin cero verificados): tras un fallo diagnosticado —veredicto del revisor o
rechazo humano— la corrección empieza clasificando el hallazgo por clase:

- **Enumeración incompleta dentro de una estrategia ya verificada** →
  corrección normal: retry local sobre el mismo diff, barriendo la clase
  completa del defecto, no la instancia señalada. Legítima en cualquier número
  de rondas mientras la clase se sostenga.
- **Clase nueva de defecto** — el hallazgo revela una dimensión que la
  estrategia verificada no cubría → parar y decidir con el humano entre las
  salidas amplias, ilustradas y no exhaustivas: rediseño dentro del mismo
  alcance, extensión con re-aprobación, partición en changes menores, o
  descarte.

**`review.md` apunta**: junto a los veredictos `fail`, una frase — el hallazgo
se clasifica antes de elegir `--retry` o `--block`, y la taxonomía la posee el
contexto de blocked. Redactada sin solapar el regex documentado del falso
positivo.

**`validation.md` apunta igual**: el rechazo humano se clasifica antes de
iterar, mismo puntero. Su párrafo no tiene pin; las filas de la matriz del core
no se tocan.

Guards: una entrada nueva de obligación por sede tocada (tolerante a redacción,
doble evidencia fragmento + captura compuesta), siguiendo el mecanismo vigente.

Excluido con nombre: mecanismo de conteo o episodios (decisión 4 — el contador
original congelaba a `194234`); métricas por change (`reviewRetryCount` sigue
agregado repo-wide; exponerlo sería alcance nuevo sin coste medido);
`implement.md` y `core.md` como superficies (razones arriba).

Escenarios: (1) revisor reporta un residuo más de la clase ya corregida — el
implementador clasifica «enumeración incompleta», barre la clase entera y
vuelve, cuarta ronda legítima; (2) revisor reporta que el protocolo entero
tiene una dimensión sin cubrir — clase nueva: se para, el humano elige entre
rediseño/extensión/partición/descarte y el Log registra la decisión; (3)
Roberto rechaza en `in-validation` por deuda que el change no cubría — misma
clasificación: extensión con re-aprobación, el precedente exacto de `194220`.

## Specification

### CR1 — blocked.md posee la taxonomía de clasificación
- **Given** la captura compuesta de un change en `blocked`
- **When** el agente la carga para resolver el impedimento
- **Then** contiene la clasificación por clase: enumeración incompleta dentro
  de una estrategia verificada → corrección normal sin límite de rondas
  mientras la clase se sostenga; clase nueva de defecto → decisión humana
  entre salidas ilustradas como no exhaustivas (rediseño en el mismo alcance,
  extensión con re-aprobación, partición, descarte)
- **And** un guard tolerante con doble evidencia — fragmento
  `templates/contract/blocked.md` y captura compuesta de un fixture en
  `blocked` — falla nombrando la sede si la obligación desaparece

### CR2 — El veredicto del review clasifica antes de corregir
- **Given** el pack compuesto por `buildContext('review', root)`
- **When** el orquestador va a registrar un veredicto `fail`
- **Then** contiene la obligación de clasificar el hallazgo antes de elegir
  `--retry` o `--block`, con la taxonomía apuntada a la sede de blocked, sin
  repetirla
- **And** un guard tolerante con doble evidencia la fija, y los guards
  existentes sobre el pack de review (concepto 8 y la entrada del cuantificador
  del revisor) siguen verdes sin editarse

### CR3 — El rechazo humano recibe la misma clasificación
- **Given** la captura compuesta de un change en `in-validation`
- **When** el humano rechaza con motivo y el agente retoma
- **Then** el overlay obliga a clasificar el rechazo igual que un veredicto de
  review — mismo par de clases, mismo puntero a la sede de blocked — antes de
  iterar la implementación
- **And** un guard tolerante con doble evidencia la fija, y los pins de la
  matriz de transiciones del core quedan intactos sin editarse

## Plan

- [x] Escribir la taxonomía en blocked.md y su guard de doble evidencia
  - **Target:** `templates/contract/blocked.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-30T21:00:30Z`
- [x] Añadir la obligación de clasificar junto a los veredictos de review.md,
  sin solapar el regex del falso positivo documentado
  - **Target:** `templates/contract/review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T21:00:30Z`
- [x] Añadir la clasificación del rechazo humano en validation.md y su guard
  - **Target:** `templates/contract/validation.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-07-30T21:00:30Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T21:00:30Z`

## Log
- **2026-07-30T20:15:55Z** `[note]` Reescritura total sobre investigación fresca por decisión de Roberto (2026-07-30): muere el contador — congelaba el caso legítimo de 194234 — y entra la clasificación por clase con las cuatro decisiones registradas en el Request. El contenido anterior queda en la historia de git de este fichero.
- **2026-07-30T20:45:37Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T20:45:58Z** `[status]` approved → in-progress
- **2026-07-30T21:00:31Z** `[note]` Selección única resuelta. Los 15 patrones probados rojos individualmente contra los fragmentos sin editar (los 8 de blocked también contra handoff.md, que viaja en el mismo overlay y ya decía 'classify friction'); delete y reword-mutante por guard; la restricción del falso positivo de CR2 verificada por conteo de matches de los 10 patrones existentes que leen review.md, idénticos antes y después. Presupuestos tras el cierre: blocked 592/1250, in-validation 433/1250, base.review 1000/2500. Decisiones no especificadas del implementador para el review: colocación de la taxonomía entre diagnóstico y resolución con alcance explícito al fallo diagnosticado; 'The number of rounds does not close this path' en vez de 'no se cuentan rondas' (para no leer como prohibición de reviewRetryCount); review.md apunta sin nombrar las dos clases (sede única); el punto y coma de validation.md partido para ordenar clasificación antes de iteración; los cuatro exits NO pinneados como lista ordenada (declarados no exhaustivos — pinnearlos cobraría retarget a una reescritura legítima); tabla hermana CLASSIFICATION_OBLIGATIONS por fixtures de status. Observación del implementador, registrada sin actuar: el implementador de un barrido post-retry nunca ve la taxonomía en su propia cápsula (el pack de in-progress no compone blocked.md) — coherente porque la clasificación es del orquestador en el momento del veredicto; si muerde, es follow-up con coste medido.
- **2026-07-30T21:01:02Z** `[status]` in-progress → in-review
- **2026-07-30T21:01:02Z** `[note]` Mandato del review, declarado antes de delegar: la superficie que el change gobierna — los tres fragmentos tocados y su tabla de guards contra los 3 CR; los puntos de escrutinio son las 6 decisiones no especificadas y la deformación de las cuatro decisiones de Roberto del Request.
- **2026-07-30T21:15:49Z** `[review]` in-review → in-progress (retry): D1: dos patrones de review satisfechos por prosa preexistente de handoff.md en la captura compuesta (evidencia única); D2: mitades de orden unidireccionales y comentario que afirma reword-mutantes no ejecutados
- **2026-07-30T21:23:46Z** `[status]` in-progress → in-review
- **2026-07-30T21:23:46Z** `[note]` Mandato del review de confirmación, declarado antes de delegar: spot check del diff nombrado — la corrección sin commitear (solo la tabla CLASSIFICATION_OBLIGATIONS de test/context.test.mjs, +38/−15) sobre el HEAD actual; la implementación revisada vive en 4f27f42b y tres commits externos posteriores (viewer, otro colaborador) no tocan las superficies del change (git log vacío sobre ellas). Escrutinio: que ambas mitades de la doble evidencia carguen peso (co-traveller handoff.md incluido) y que los espejos after/once no introduzcan falso positivo nuevo.
- **2026-07-30T21:31:41Z** `[review]` in-review → in-progress (retry): patrón puntero de la fila validation con la misma fragilidad coattail que D1 cerró en review (latente: validation compone sola) y el comentario afirma 'each alternative run three ways' falsificado para ese patrón — enumeración incompleta dentro de estrategia verificada, corrección normal
- **2026-07-30T21:31:41Z** `[note]` Dogfood registrado: este retry se clasificó con la taxonomía que el propio change escribe — enumeración incompleta (la estrategia de anclaje está verificada; el barrido dejó una instancia, el puntero de validation), no clase nueva. Nota de proceso: el revisor de confirmación restauró un mutante con git checkout -- pese al mandato de restaurar editando; el árbol final quedó limpio (verificado: delta de 2 paths), la disciplina no.
- **2026-07-30T21:35:46Z** `[status]` in-progress → in-review
- **2026-07-30T21:35:46Z** `[note]` Mandato del review de confirmación (3ª), declarado antes de delegar: spot check del diff nombrado — la tabla corregida (+52/−16). Semántica del mandato, explícita en el prompt: recomendar fail solo si el defecto nombrado no quedó cerrado o la corrección introdujo regresión; hallazgos latentes o adyacentes se reportan como follow-ups sin tumbar la ronda — el orquestador los juzga.
- **2026-07-30T21:39:34Z** `[review]` in-review → in-validation (delegated subagent, clean context)
