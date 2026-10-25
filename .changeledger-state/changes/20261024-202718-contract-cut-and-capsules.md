---
id: "20261024-202718"
title: "El contrato baja a diez fragmentos y dos cápsulas: fuera §2.2, el aislamiento de correcciones y graduation-review; el estado global sale del core y nada fuera de .changeledger/ cita al ledger"
type: change
status: done
created: 2026-10-24T20:27:18Z
depends_on:
  - "20261024-202659"
branch: change/20261024-202718
related_to:
  - "20261020-130304"
  - "20261023-181753"
  - "20261024-121022"
  - "20261007-135159"
  - "20260730-183520"
  - "20260729-143656"
  - "20260728-170429"
parent: "20261023-181733"
owner: raruiz-hiberuscom
---

## Request

Tras los dos primeros hijos de la épica, `templates/contract/` tiene 17
fragmentos Markdown más `budgets.yml`, 8.382 palabras y 11.927 tokens del
tokenizador de referencia; `core.md`, lo que carga todo agente en cada
mensaje, pesa 1.892 palabras, y el plan v1.0 (§5) lo quiere en ~960. Las
retiradas de octubre (`20261020-130304`) se autolimitaron a no decidir nada
de producto; los hijos `20261023-181753` y `20261024-121022` retiraron el
Definition of Ready y la matriz por tipo. Lo que queda del §2 es lo que sólo
se podía retirar con eso hecho: las cinco reglas del §2.2, el aislamiento de
correcciones y el delegado `graduation-review` del §2.3 —el primero asignado
al §13.1 y nunca hecho—, los dos fragmentos y seis cápsulas que duplican a
otros, y la semántica de `sync` que el §2.4 saca del core. Y lo que el §6 añade
a cambio: la regla de §6.3, porque la de §6.1 ya está en el core desde
`20261023-181753` y la de §6.2 la trae el hijo `[finding]` del que éste
depende.

El plan trae tres cifras que el código desmiente y que este draft corrige en
vez de heredar: `release.md` no aparece ni en la tabla de nueve fragmentos del
§5 ni en su lista de desaparecidos, así que el recorte deja diez; «8 de las 10
cápsulas» son 6 de 8 desde que `20261020-130304` retiró `audit` y
`post-review`; y el overlay `discarded` no tiene «1.250 tokens» (§2.1) sino
150.

### Objective

El contrato pesa lo que sus obligaciones necesitan y nada que un agente deba
buscar fuera de `.changeledger/` apunta al ledger. Terminado significa que,
medido en `templates/contract/`:

- quedan diez fragmentos: `core`, `spec`, `implement`, `review`, `close`,
  `delegation`, `release`, `global-state` y las dos cápsulas de revisión
  (`agent-contexts/review.md`, `agent-prompts/review.md`); desaparecen
  `handoff.md`, absorbido por `delegation.md`, `discarded.md`, cuyo contenido
  ya está dos veces en el core, y las seis cápsulas de `investigation`,
  `implementation` y `graduation-review`; `agent-context` y `agent-prompt`
  aceptan sólo `review` y la ayuda de la CLI lo dice;
- ninguna de las cinco reglas del §2.2 está en fragmento alguno: el estándar
  de cuantificadores universales con su contabilidad en implementador y
  revisor, «no copiar la checklist de la cápsula», «cifras y números de línea
  como datos a verificar», la restauración de mutantes editando y «cargar
  `context review` una sola vez»; el paso de cargar `context review` en la
  puerta ordenada se queda, sin el «una sola vez»;
- el aislamiento de correcciones no está: tras un `fail`, la corrección es
  una selección resuelta más, committeada antes de volver a `in-review`, y
  el revisor inspecciona de nuevo `baseline..HEAD`; las clases de commit son
  cuatro —Draft, Baseline, Implementation, Handoff—; el tercer round sigue
  devolviendo la decisión al humano;
- el rol `graduation-review` no existe en contrato ni en código
  (`AGENT_ROLES`, `ALLOWED_STATUSES`, ayuda); `close.md` no delega la
  reconciliación a nadie;
- la semántica de `cutover`, `activate` y `sync` vive en `global-state.md`,
  que `changeledger context` compone en el pack core sólo cuando el repo está
  activado, con techo propio en `budgets.yml`; un repo no activado no la
  carga;
- la regla del §6.3 está en vigor en tres sedes: el contrato la enuncia en
  una frase —ningún fichero fuera de `.changeledger/` contiene un id de change
  ni un `CRn`; la referencia va del change al código por `Target`, `Verify` y
  el marcador `[#id]` del commit—; la checklist del revisor verifica el
  comportamiento que la Specification declara y ya no recorre «every `CRn`»
  ni lo busca en los tests; y `hooks/pre-commit` de este repo rechaza una
  línea añadida fuera de `.changeledger/` que contenga un id o un `CRn`,
  nombrando fichero y línea, con el mismo grep corriendo en CI sobre
  `origin/dev...HEAD`; las referencias existentes se quedan como están;
- cada fragmento se reescribe al contenido que el §5 le asigna y cada captura
  —`context`, `context spec|implement|review|release`, el overlay `done` y
  las dos cápsulas— se mide con el tokenizador de referencia; los techos de
  `budgets.yml` bajan a lo medido y `PINNED_CEILINGS` lo refleja; donde una
  captura no alcanza la cifra del §5 sin retirar prosa normativa, el Log
  registra el hueco y la épica decide (AGENTS.md: un techo nunca es una meta);
- cada obligación que el plan conserva (§4) sigue en un fragmento nombrado y
  un grep de la obligación la encuentra ahí; los tests sobre el contrato son
  sólo de los cuatro tipos que AGENTS.md permite, los que pinan prosa
  retirada, fragmentos o roles borrados se retiran, y los estructurales se
  reapuntan al inventario nuevo;
- `README.md`, `CONTRIBUTING.md` y la ayuda de la CLI describen esta forma:
  dos roles de cápsula menos, sin aislamiento de correcciones, con la regla de
  §6.3 y el hook.

### Frontier

**Entra.** `templates/contract/**` y `templates/contract/budgets.yml`;
`src/commands/context.mjs` (`MODE_CONTEXT`, `STATUS_CONTEXT`, la composición
condicional de `global-state` y `packBudget`); `src/commands/agent-context.mjs`
(`AGENT_ROLES`, `ALLOWED_STATUSES`) y `src/commands/agent-prompt.mjs`;
`bin/changeledger.mjs` (ayuda de `agent-context`, `agent-prompt`, `context` y
los ocho ejemplos de ayuda que llevan un id, que pasan a un marcador);
`hooks/pre-commit`, un script bajo `scripts/` o `hooks/` que recibe `--cached`
o un rango, y el job de `.github/workflows/ci.yml` que lo ejecuta;
`README.md`, `CONTRIBUTING.md`; y los tests de esas superficies:
`test/context.test.mjs`, `test/contract.test.mjs`,
`test/agent-context.test.mjs`, `test/agent-prompt.test.mjs`,
`test/search.test.mjs`, `test/cli.test.mjs`, `test/cli-bin.test.mjs` y
`test/lifecycle.test.mjs` en los casos que pinan prosa, fragmentos, roles o
techos retirados (inventario en Investigation), más el test del hook.

**Queda fuera.** El mecanismo `[finding]` y sus tres frases de contrato, que
trae el hijo del que éste depende; `src/check.mjs`, que no lee el árbol
fuente (§6.3); el viewer; las opciones del §12 —`delegation.md` dentro del
core y la tabla de clases de commit—, que el humano decide con la medida en
la mano; `INTENT.md` y `docs/`, que son otro hijo; las specs, que reconcilia
la épica; el bootstrap de `AGENTS.md` y su `head -400`; los hooks de los repos
consumidores: ChangeLedger no empaqueta `hooks/`, así que la obligación va en
el contrato y este repo es la implementación de referencia que el README
enseña a copiar.

**Pre-autorizado.** Retirar cada test que sólo pine una frase retirada, un
fragmento o rol borrado o el techo de una entrada que desaparece, nombrándolo
en el Log; bajar techos y añadir la entrada de `global-state`; reapuntar los
tests estructurales de composición e inventario; reescribir los ejemplos de
ayuda con ids a un marcador; enmendar la Specification en `in-progress`
cuando el código desmienta lo previsto, registrándolo en el Log. Si cambia el
objetivo o la frontera, se vuelve al humano.

### Decisiones de forma que el plan deja abiertas

1. **`release.md` sobrevive y son diez fragmentos.** Sólo lo carga `context
   release`, pesa 214 palabras y ningún otro fragmento puede absorberlo sin
   cargar la release en el core.
2. **La viñeta de criterios de `spec.md` cae con el §2.2.** «A criterion that
   quantifies universally either covers its whole domain or narrows to what it
   verifies» es el mismo estándar aplicado a los CRs; lo que queda como regla
   de falsabilidad es «every `Then` states a fact measured at writing time».
3. **`global-state.md` se compone por activación.** `loadRepo` ya sabe si el
   repo tiene ref de estado; es el único «cuando aplica» que el código puede
   decidir sin configuración nueva. Un repo activado ve el core más
   `global-state`, con sus dos techos sumados en la línea `BEGIN`; uno no
   activado descubre `cutover` por `changeledger help`.
4. **Sin aislamiento, la re-revisión es una revisión.** La regla «una review
   de confirmación falla sólo por el defecto nombrado» se va con el bloque;
   el mandato del prompt, que ya existe, es como el orquestador acota una
   re-revisión si quiere.
5. **El hook mira líneas añadidas, no ficheros.** `git diff --cached -U0`
   filtrado por `^+`, patrones `\b\d{8}-\d{6}\b` y `\bCR\d+\b`, exentos
   `.changeledger/`, `.changeledger-state/` y `templates/contract/spec.md`
   (sus ejemplos de gramática). `docs/` no está exento: la narrativa cita
   changes por título o por `changeledger search`. Un test nuevo se nombra por
   el comportamiento que prueba, no por `<id> CRn`; la trazabilidad del change
   al test la lleva `Verify` de la tarea.
6. **`delegation.md` lleva el contrato de prompt escrito.** Sin esqueletos de
   `investigation` e `implementation`, los ítems que todo prompt declara
   —objetivo, frontera y ficheros, baseline a verificar, comando de
   verificación, formato de vuelta y la prohibición de delegar más— se
   enumeran ahí, en las ~200 palabras del §5 que absorben el triaje del
   handoff.
7. **Lo que no cabe se registra, no se recorta.** Sin las opciones del §12, el
   core difícilmente baja de ~1.700 palabras: la mayor parte de su peso está
   en el bloque de commits (392) y el ciclo (303), que el plan conserva. El
   Log mide el hueco por fragmento y la épica decide si abre el §12.

### Investigation

Mapa medido en `dev` (`3e1f23de`) por una investigación delegada de sólo
lectura, con el tokenizador pinado (`gpt-tokenizer`, `o200k_base`).

**Inventario y capturas.** Palabras por fragmento: `core` 1.892, `spec` 1.375,
`implement` 1.346, `review` 621, `close` 682, `delegation` 208, `handoff`
140, `discarded` 31, `release` 214, cápsulas 1.873 en ocho ficheros. Capturas
contra techo (tokens/líneas): `context` 2.687/2.750 y 209/275; `spec`
2.382/2.400; `implement` 2.484/2.500; `review` 1.106/1.150; `release`
432/500; overlay `done` 1.129/1.150; `discarded` 133/150; bloque
`core-commits` 549/600; `agent-prompt graduation-review` 527/600. Secciones
del core: Classify 171 palabras, Protect 288, Invariants 181, When no change
104, Exit gates 87, Ceiling 64, Commits 392, Lifecycle 303, Context modes 32,
Synchronizing 99, Discovery 112. `packBudget(mode)` publica sólo
`base[mode]` en la línea `BEGIN`; no existe ningún asiento de composición
condicional: `MODE_CONTEXT` y `STATUS_CONTEXT` son listas fijas y el último
filtro condicional, `fragmentsForType`, cayó con el readiness.

**Dónde está cada regla del §2.2.** Cuantificadores: `implement.md` «##
Evidence obligations» (lista de frases cuantificadas con el comando que
ejecutó su borde; corregir acota o borra), `review.md` (puntos de escrutinio;
«a universal quantifier … whose falsifying edge was not executed as a defect
that fails the review»), `agent-contexts/graduation-review.md` y la viñeta de
criterios de `spec.md`; pinadas por `DELEGATION_OBLIGATIONS` 2-5, 7 y 8 y
`DRAFTING_OBLIGATIONS` 2. «No copiar la checklist»: `review.md`, sin pin.
«Cifras como datos»: `implement.md`, sin pin. Mutantes: `implement.md`, sin
pin individual, pero el guard 11 exige ≥ 8 cláusulas en esa sección, que
quedarían en 6. «Una sola vez»: paso 6 de la puerta ordenada de
`implement.md` y «never reload one already held» del core; el regex de
`134702/122950 CR1/CR2` pina los nueve pasos en orden.

**Aislamiento de correcciones.** `implement.md` «## Correction isolation»
entero; `core.md` la clase **Correction** y «one more per confirmed
correction»; `review.md` «A pass leaves the change done … unless it confirms
uncommitted correction … A confirmation review fails only for the named
defect». Pins: guard 9, `DELEGATION_OBLIGATIONS` 6 y 9, `164620 CR3`, y un
comentario en `cli.test.mjs`. `graduation-review`: `close.md` (delegar antes
del primer `--into`), `core.md` (lista de roles), `agent-context.mjs`
(`AGENT_ROLES`, `ALLOWED_STATUSES`), `agent-prompt.mjs`, ayuda de `bin`, dos
plantillas; pins en `agent-context.test` (`152555 CR1/CR2/CR7`, regexes de
roles retirados), `agent-prompt.test` (`ROLES`, `152555 CR3`, CR3, CR4),
guards 18 y 19, `144327 CR5`, `cli-bin 134716 CR2` y `lifecycle 152555 CR8`.

**`handoff.md` y `discarded.md`.** El primero (140 palabras) lo componen
`implement` y `review`; pinado por `ownedHeadings` (`234939`) y `225213
CR4/CR5/CR7`. El segundo duplica `core.md` («terminal tombstone; never reopen
it», «The discard reason is required and logged … `discarded` never reopens»);
lo compone `STATUS_CONTEXT.discarded`, tiene techo `overlays.discarded` y
pins en `210543 CR2/CR8/CR9`, `225213 CR6`, `PINNED_CEILINGS`, `143656 CR4`
(inventario exacto de fragmentos: nueve de primer nivel y cuatro roles por
grupo) y `cli.test 171002`.

**`sync`.** `core.md` «## Synchronizing the global state» (99 palabras) más
la frase del ciclo «A branch that lands after the graduation is stamped by the
next `changeledger sync`» y el comando en `implement.md`; pinado por el guard
15, que exige las cuatro ideas en `pack('core')`, y por `124835 CR1`, que
pina los doce `##` del core en orden y su cuenta exacta.

**Sedes de las obligaciones conservadas (§4).** Revisión independiente:
`review.md`, fila del core, paso 7 de la puerta (guard 8). Aprobación humana:
core (matriz, guards 2 y 7) y `spec.md` (`approve` exige Objective y Frontier,
guard 5). Un concern con frontera: core (`181753 CR7`). Nunca en integración
ni release: `implement.md` (guards 20 y 22). Trazabilidad: core «## Commits».
Toda selección committeada antes de la revisión: core e `implement.md`
(`164620 CR2`). TDD: `implement.md` y la cápsula de implementación, que
desaparece —la frase se queda en `implement.md`. Reproducir el defecto y test
en rojo: `implement.md`. Graduación: `close.md` (guards 13 y 19). Un nivel de
delegación y un dueño por superficie: core y `delegation.md`. Taxonomía de
fallos: `review.md` (`CLASSIFICATION_OBLIGATIONS`). Triaje: `handoff.md`.
Tercer round y modelo de confianza: `review.md` (guard 14).

**Tests sobre el contrato.** `context.test.mjs` 175 casos en ejecución (131
declaraciones), `contract.test.mjs` 43, `agent-context.test.mjs` 26,
`agent-prompt.test.mjs` 12, `search.test.mjs` 16, más pins en `cli.test.mjs`
(`171002`, `214902`), `cli-bin.test.mjs` y `lifecycle.test.mjs`. Por tipo:
presupuestos (~25), composición estructural (~40, con `143656 CR4`, `124835
CR1-CR9`, la puerta ordenada y la matriz), barridos de frases retiradas
(~45), guards de concepto (21 `CONCEPT_GUARDS`, 6 `DRAFTING_OBLIGATIONS`, 9
`DELEGATION_OBLIGATIONS`, 1 `CLASSIFICATION_OBLIGATIONS`) y comportamiento de
comando, que no cambia. Fuera de los cuatro tipos: `20261020-130304 CR6`
pina dos frases literales de `implement.md` sobre la gramática de eventos, y
`20260728-170429 CR2/CR6` pina el párrafo de presupuestos de `AGENTS.md`.

**Referencias fuera de `.changeledger/` (§6.3).** Líneas con id de change o
`CRn`: `src` 144 (todas comentarios, cero literales de código; `agent.mjs`
26, `check.mjs` 20); `bin` 10, ocho de ellas ejemplos de ayuda con un id
(`changeledger context <id real>` y similares); `templates` 5, todas
ejemplos de gramática en `spec.md`; `hooks` 0; `test` 3.654 líneas en 53 de
67 ficheros —1.854 de 2.002 declaraciones `test(` llevan id o `CRn` en el
nombre—; `docs` 118, casi todas en `workflow-hardening.md`; README,
CONTRIBUTING, AGENTS e INTENT ninguna. El incentivo que el plan nombra está
en `agent-contexts/review.md` («inspect the selected change, every `CRn`,
every Plan task, tests, the actual diff») y en `agent-prompts/review.md`
(«per-criterion PASS/FAIL»); ningún test pina «every `CRn`». El hook
`hooks/pre-commit` corre `lint-staged`, `pnpm test` y `check`, no lee el
índice él mismo, no está activado en este checkout (`core.hooksPath` sin
fijar; `CONTRIBUTING.md` documenta cómo) y `hooks/` no va en `files` de
`package.json`. CI ejecuta `pnpm verify` tras `activate` y `register`.

**Changes relacionados.** `20261007-135159` escribió el estándar de
cuantificadores que este change retira; `20260730-183520` hizo condicional
la checklist de la cápsula del revisor; `20260729-143656` sustituyó los pins
de hash por guards de obligación; `20260728-170429` creó los presupuestos en
tokens; `20261020-130304` fue el recorte anterior y retiró `audit` y
`post-review`.

### Proposal

#### Solución elegida

**Recorte por retirada, no por síntesis.** Cada fragmento pierde primero las
reglas que el §2 nombra —cuantificadores y su contabilidad, checklist,
cifras, mutantes, «una sola vez», aislamiento de correcciones,
`graduation-review`— y después se reescribe a la densidad del §5 sin soltar
ninguna obligación del §4; la Specification lista, por fragmento, qué sale y
a dónde va lo que se queda. `handoff.md` entra en `delegation.md` como triaje
de dos líneas que apunta a `[finding]`; `discarded.md` desaparece y
`STATUS_CONTEXT.discarded` deja de componer nada; `global-state.md` nace con
el texto de `sync` y la frase del ciclo, y `context` lo añade al pack core
cuando `loadRepo` devuelve estado.

**Cápsulas.** Se borran seis; `AGENT_ROLES` queda en `['review']`; la
cápsula del revisor pierde «every `CRn`» y gana «el comportamiento que la
Specification declara, en el diff y en los tests que lo prueban»; el
esqueleto de revisión conserva el mandato y la lista de puntos de escrutinio
que no sea la de frases cuantificadas.

**§6.3.** Una frase en `implement.md` («Git protects traceability»), el hook
con un script `--cached` o `<rango>` que CI ejecuta sobre `origin/dev...HEAD`
y un test que lo prueba en un repo de pruebas con una línea añadida con id,
otra con `CRn` y otra limpia en `spec.md`.

**Tests.** Los pins de prosa retirada se retiran con nombre en el Log; los
estructurales (`143656 CR4`, `124835 CR1`, `ownedHeadings`, `PINNED_CEILINGS`,
la puerta ordenada) se reapuntan; el guard 11 pasa a exigir las cláusulas
que sobreviven; ningún pin literal nuevo.

#### Alternativas descartadas

- **Un hijo por área (contrato, cápsulas, §6.3).** El inventario de
  fragmentos y roles es un solo test (`143656 CR4`) y las cápsulas se citan
  desde `core.md`, `review.md` y `close.md`: separarlas deja dos changes
  tocando los mismos tests y fragmentos.
- **Meter aquí `[finding]`.** Cuatro superficies —prosa, tests, código del
  Log, hook— en una pasada; el mecanismo tiene revisión propia y la frase que
  lo nombra sólo puede escribirse cuando existe.
- **Componer `global-state.md` en `implement` y `review` en vez del core.**
  `sync` al abrir sesión es el primer punto estratégico y vive en el core; lo
  que aplica no es el modo sino el repo.
- **Mantener `graduation-review` para la épica.** Es el delegado que el §2.3
  retira; la reconciliación de la épica la revisa el humano en el PR, y la
  observación D7 del hijo anterior (changes sólo de specs sin revisión) sigue
  abierta con él.
- **Meter el grep en `changeledger check`.** El plan lo excluye: obligaría a
  la herramienta a leer el árbol fuente de cada repo.

#### Escenarios

- **El día después.** Un agente abre sesión en un repo activado y lee el core
  con `global-state`; en uno no activado, sin él. Implementa, falla la
  revisión, committea la corrección como una selección más, vuelve a
  `in-review` y delega otra revisión completa. Encuentra algo fuera de la
  frontera y lo registra con `changeledger finding`. Nombra un test por lo
  que prueba; si escribe `CR3` en un comentario, el hook rechaza el commit
  nombrando fichero y línea.
- **Una captura no alcanza el §5.** El Log registra fragmento, cifra medida
  y objetivo; la épica decide si abre el §12 o corrige el objetivo. Nada se
  retira para caber.
- **Un test pina una frase que se reescribe.** Si es de los cuatro tipos, se
  reapunta; si es un pin literal, se retira y el Log lo nombra.

## Specification

Escrita en `in-progress` con el código delante (`dev` en `b1bc5493`, con
`[finding]` ya fusionado). Las sedes: `MODE_CONTEXT`, `STATUS_CONTEXT`,
`packBudget` y `composeResult` en `src/commands/context.mjs`; `AGENT_ROLES` y
`ALLOWED_STATUSES` en `src/commands/agent-context.mjs`, reutilizados por
`src/commands/agent-prompt.mjs`; los techos en `templates/contract/budgets.yml`
y `PINNED_CEILINGS` en `test/context.test.mjs`; la medida de tokens en
`test/budget-support.mjs`. «No contiene» se verifica con barridos tolerantes
a la redacción sobre todo `templates/contract/` recursivo, como `143656 CR4`.
Los mensajes de error son literales.

### CR1 — El inventario queda en diez fragmentos
- **Given** `templates/contract/`
- **When** se listan sus ficheros Markdown recursivamente
- **Then** son exactamente `close.md`, `core.md`, `delegation.md`, `global-state.md`, `implement.md`, `release.md`, `review.md`, `spec.md`, `agent-contexts/review.md` y `agent-prompts/review.md`, más `budgets.yml`
- **And** no existen `handoff.md`, `discarded.md`, `agent-contexts/graduation-review.md`, `agent-contexts/implementation.md`, `agent-contexts/investigation.md`, `agent-prompts/graduation-review.md`, `agent-prompts/implementation.md` ni `agent-prompts/investigation.md`
- **And** el inventario pinado en `143656 CR4` de `test/context.test.mjs` dice eso mismo

### CR2 — La composición no carga lo que ya no existe
- **Given** `MODE_CONTEXT` y `STATUS_CONTEXT` en `src/commands/context.mjs`
- **When** se componen los modos y los estados
- **Then** `spec` compone `spec` y `delegation`; `implement` compone `implement` y `delegation`; `review` compone sólo `review`; `release` sólo `release`; `done` compone el overlay `close`
- **And** `changeledger context <id>` de un change `discarded` compone el core y el documento sin overlay, con `mode: discarded` en la línea `BEGIN` y sin entrada propia en `budgets.yml`
- **And** los encabezados poseídos (`ownedHeadings` de `234939`) son: `spec` → `# Authoring a Change`, `# Economical Delegation`; `implement` → `# Implementing an Approved Change`, `# Economical Delegation`; `review` → `# Independent Review`; ninguno lleva `# Handoff Triage` ni `# Discarded — Terminal`

### CR3 — El estado global se carga sólo en un repo activado
- **Given** `templates/contract/global-state.md` con la semántica de `cutover`, `activate` y `sync`
- **When** `changeledger context` (sin argumento) se ejecuta en un repo recién iniciado y en el mismo repo tras `changeledger cutover`
- **Then** la primera captura no contiene `cutover`, `activate` ni `sync` fuera de la tabla de intención, y la línea `BEGIN` publica `lines:<n>/<base.core.lines>`
- **And** la segunda captura contiene el texto de `global-state.md` después del core, antes del `END`, y publica `lines:<n>/<base.core.lines + overlays.global-state.lines>`
- **And** `core.md` no tiene la sección `## Synchronizing the global state` ni la frase del ciclo sobre la rama que aterriza tras la graduación; ambas viven en `global-state.md`, igual que el comando `changeledger sync [--status]` que `implement.md` listaba
- **And** el guard 15 de `CONCEPT_GUARDS` exige sus cuatro ideas —puntos estratégicos, mismo documento → humano, nunca bloquea, adopción por `cutover`— en `global-state.md`, y `124835 CR1` pina once `##` en el core, sin «Synchronizing»

### CR4 — Sólo queda el rol review
- **Given** `AGENT_ROLES` en `src/commands/agent-context.mjs`
- **When** `changeledger agent-context investigation <id>`, `changeledger agent-context implementation <id>`, `changeledger agent-context graduation-review <id>`, `changeledger agent-prompt investigation`, `changeledger agent-prompt implementation` y `changeledger agent-prompt graduation-review`
- **Then** cada uno sale 1: la CLI lo rechaza en el dominio cerrado del argumento con `Allowed choices are review.` y las funciones `buildAgentContext` y `buildAgentPrompt` con `Unknown role "<rol>" — valid roles: review`
- **And** `changeledger agent-context review <id>` y `changeledger agent-prompt review` siguen produciendo su cápsula y su esqueleto dentro del techo `agent`
- **And** la ayuda de `agent-context` y `agent-prompt` lista sólo `review` y no nombra `investigation`, `implementation` ni `graduation-review`; `core.md` remite a `changeledger agent-prompt review` y a ningún otro rol
- **And** los tests `152555 CR1/CR2/CR3/CR7` y `152555 CR8` que ejercitan `graduation-review` se retiran con nombre en el Log; `144327 CR7` (guards de rol), `144327 CR8`, `212043 CR6`, `CR3` y `CR4` de `agent-prompt.test.mjs` y `134716 CR2` de `cli-bin.test.mjs` se reapuntan a un solo rol

### CR5 — Las cinco reglas del §2.2 no están en ningún fragmento
- **Given** `templates/contract/` recursivo
- **When** se barren los fragmentos
- **Then** ninguno contiene, con tolerancia a la redacción: `quantif` (el estándar de cuantificadores y su contabilidad, incluida la viñeta de criterios de `spec.md`), `copy its checklist` / `Do not copy`, `figures, line numbers`, `Mutate one thing` / `restore it by editing`, `once; do not reload` / `never reload one already held`
- **And** el paso de la puerta ordenada de `implement.md` que carga `changeledger context review` sigue existiendo sin la cláusula «una sola vez», y el regex de `134702/122950 CR1/CR2` se reapunta a él
- **And** `DELEGATION_OBLIGATIONS` pierde las filas 2, 3, 4, 5, 7 y 8 y `DRAFTING_OBLIGATIONS` la fila 2, nombradas en el Log; el guard 11 exige por patrón las seis obligaciones de evidencia que sobreviven —disciplina de alcance con residuales nombrados, reproducir el defecto, test en rojo antes del arreglo, informar de una instrucción contraria al contrato, parar ante un alcance mayor, listar las decisiones no especificadas— y ya no cuenta cláusulas

### CR6 — Una corrección es una selección resuelta más
- **Given** `core.md`, `implement.md` y `review.md`
- **When** se barren
- **Then** ninguno contiene `Correction isolation`, `uncommitted correction`, `kept uncommitted`, `left uncommitted`, `confirmation review` ni `confirms it`
- **And** el bloque `## Commits` del core declara cuatro clases —Draft, Baseline, Implementation, Handoff— y dice que una corrección tras `fail` o tras un rechazo humano es un commit de implementación más, committeado antes de volver a `in-review`; `review.md` dice que una re-revisión inspecciona `baseline..HEAD` de nuevo bajo el mandato declarado y conserva el tope del tercer round y el modelo de confianza (guard 14)
- **And** el guard 9 pasa a exigir «la corrección se committea antes de volver a in-review»; `DELEGATION_OBLIGATIONS` pierde las filas 6 y 9; `164620 CR3` se reapunta a que `review.md` no declara clases de commit; `CONTRIBUTING.md` no describe el aislamiento

### CR7 — graduation-review no existe
- **Given** `templates/contract/`, `src/`, `bin/` y `test/`
- **When** se busca `graduation-review`
- **Then** no aparece en ningún fragmento ni en `src/commands/agent-context.mjs`, `src/commands/agent-prompt.mjs` ni `bin/changeledger.mjs`; `close.md` no delega la reconciliación y dice que la revisa el humano al fusionar
- **And** los guards 18 y 19 y `144327 CR5` se retiran con nombre en el Log; `lifecycle.test.mjs` `152555 CR8` se retira

### CR8 — delegation.md absorbe el triaje y el contrato de prompt
- **Given** `templates/contract/delegation.md`
- **When** se compone `context implement` y `context spec`
- **Then** `delegation.md` lleva una sección de triaje con las cuatro salidas —necesario al change: Specification, Plan y Log; paso operativo: ejecutarlo; fuera del objetivo o la frontera: `changeledger finding <id>`; demasiado vago: mencionarlo sin fichero— y la regla de no mezclar concerns ni retener una entrega lista
- **And** su contrato de prompt enumera los ítems que todo prompt declara: por qué se delega, objetivo y frontera, ficheros que posee, baseline a verificar, comando de verificación, formato de vuelta y la prohibición de delegar de nuevo; no remite a un esqueleto para roles que no existen
- **And** `templates/contract/review.md` no contiene el triaje; `225213 CR4/CR5/CR7` se reapuntan

### CR9 — discarded y su overlay desaparecen
- **Given** `budgets.yml` y `bin/changeledger.mjs`
- **When** se leen
- **Then** `budgets.yml` no tiene `overlays.discarded` y `PINNED_CEILINGS` tampoco; la ayuda de `context` nombra el overlay `close` y no «overlays such as close and discarded»
- **And** `core.md` sigue diciendo que `discarded` es terminal y nunca se reabre (`171002` de `cli.test.mjs` pasa); `210543 CR2/CR8/CR9` y `225213 CR6 overlays` se reapuntan a `done`

### CR10 — El contrato enuncia la regla del §6.3 y la cápsula deja de recorrer CRn
- **Given** `implement.md` y `agent-contexts/review.md`
- **When** se componen `context implement` y `agent-context review <id>`
- **Then** `implement.md` contiene la regla, con tolerancia a la redacción: ningún fichero fuera de `.changeledger/` contiene un id de change ni un `CRn`; la referencia va del change al código por `Target`, `Verify` y el marcador `[#id]`; un test se nombra por lo que prueba
- **And** `agent-contexts/review.md` no contiene `every \`CRn\`` y dice que el revisor verifica el comportamiento que la Specification declara contra el diff y los tests, sin buscar ids de criterio en el código; `agent-prompts/review.md` conserva la evidencia por criterio
- **And** un guard nuevo de `CONCEPT_GUARDS` exige la regla en `implement.md` y su ausencia en `spec.md` y `core.md`

### CR11 — El hook rechaza una línea añadida con referencia al ledger
- **Given** `hooks/no-ledger-refs.sh`, invocado por `hooks/pre-commit` antes de `pnpm test` con `--cached` y por `.github/workflows/ci.yml` con `origin/dev...HEAD` en `pull_request`
- **When** en un repo de pruebas se añade a `src/x.mjs` la línea `// see CR3` y se ejecuta `hooks/no-ledger-refs.sh --cached` con el fichero en el índice
- **Then** imprime `src/x.mjs:1: ledger reference outside .changeledger/: CR3` y sale 1
- **And** una línea añadida con `20261024-202718` en `src/y.mjs` sale 1 con el id como coincidencia; la misma línea en `.changeledger/changes/z.md`, en `.changeledger-state/changes/z.md` o en `templates/contract/spec.md` sale 0; una línea ya existente con `CR1` cuyo fichero recibe otra línea limpia sale 0 (sólo líneas `+`, `-U0`); con un rango `<base>...HEAD` en vez de `--cached` inspecciona los commits del rango con las mismas reglas; sin nada que inspeccionar sale 0
- **And** `hooks/pre-commit` ejecuta el script antes de `pnpm test` y `ci.yml` lo ejecuta en el job `verify` tras `pnpm install` sólo cuando el evento es `pull_request`; un test de `test/` ejecuta el script en un repo de pruebas y prueba cada uno de esos casos

### CR12 — Ningún ejemplo de ayuda lleva un id
- **Given** `bin/changeledger.mjs`
- **When** se ejecuta `changeledger <cmd> --help` para cada comando registrado
- **Then** ninguna salida contiene una secuencia `\d{8}-\d{6}`; los ejemplos usan `<id>` o `<epic-id>`
- **And** los dos comentarios de `bin/changeledger.mjs` que citan un id se quedan como están

### CR13 — Los techos siguen a lo medido y sólo bajan
- **Given** `budgets.yml` y `PINNED_CEILINGS`
- **When** se miden las capturas con `test/budget-support.mjs` en este repo activado y en el fixture recién iniciado, al cerrar la implementación
- **Then** cada entrada que sobrevive es la mayor medida redondeada a la decena superior, con `lines = tokens / 10`, y no supera su valor en `b1bc5493`; `overlays.global-state` es una entrada nueva medida igual; `agent` se mide sobre las dos cápsulas que quedan; `blocks.core-commits` se mide sobre el bloque de cuatro clases
- **And** el Log registra, por fragmento, palabras medidas frente a la cifra del §5 del plan y el hueco cuando lo hay

### CR14 — Las obligaciones conservadas del §4 siguen encontrables
- **Given** `CONCEPT_GUARDS`, `DELEGATION_OBLIGATIONS` y `CLASSIFICATION_OBLIGATIONS` tras el recorte
- **When** se ejecuta `test/context.test.mjs`
- **Then** un guard por patrón encuentra cada obligación en su sede: revisión independiente con contexto limpio (`review.md`), aprobación humana sobre objetivo y frontera (`core.md`, `spec.md`), un concern con frontera pre-autorizada (`core.md`), nunca en integración ni release (`implement.md`), trazabilidad `[#id]` y `check --commits` (`core.md`), toda selección committeada antes de delegar la revisión (`core.md`), TDD rojo-verde (`implement.md`), reproducir el defecto y mostrar el test en rojo (`implement.md`), graduación y reconciliación (`close.md`), un nivel de delegación y un dueño por superficie (`core.md`, `delegation.md`), taxonomía de fallos (`review.md`), triaje (`delegation.md`), tercer round y modelo de confianza (`review.md`)
- **And** ningún test nuevo pina una frase literal de un fragmento

### CR15 — README, CONTRIBUTING y ayuda describen la forma nueva
- **Given** `README.md`, `CONTRIBUTING.md` y `changeledger context --help`
- **When** se leen
- **Then** README y CONTRIBUTING no nombran `investigation`, `implementation` ni `graduation-review` como roles, ni el aislamiento de correcciones; CONTRIBUTING documenta el hook `no-ledger-refs.sh`, la regla del §6.3 y que los tests se nombran por comportamiento; README explica que un repo consumidor copia el script en su propio pre-commit porque `hooks/` no se empaqueta
- **And** `test/contract.test.mjs` lo verifica con barridos y guards tolerantes, como `20261024-121022 CR18`

### CR16 — El día después
- **Given** un repo de pruebas recién iniciado
- **When** `changeledger context` y `changeledger context implement` se leen, se delega con `changeledger agent-prompt review` y `agent-context review <id>` sobre un change en `in-review`, y el hook corre sobre un commit limpio y otro con `CR2` en un comentario
- **Then** las capturas caben en sus techos y no contienen ninguna frase retirada por CR5–CR7, la cápsula y el esqueleto se producen, el commit limpio pasa y el sucio sale 1 nombrando fichero, línea y coincidencia

## Plan

- [x] Retirar los roles `investigation`, `implementation` y `graduation-review`: `AGENT_ROLES`, `ALLOWED_STATUSES`, ayuda de `agent-context` y `agent-prompt`, borrado de las seis cápsulas y sus tests
  - **Target:** `src/commands/agent-context.mjs`, `src/commands/agent-prompt.mjs`, `bin/changeledger.mjs`, `templates/contract/agent-contexts/`, `templates/contract/agent-prompts/`, `test/agent-context.test.mjs`, `test/agent-prompt.test.mjs`, `test/cli-bin.test.mjs`, `test/lifecycle.test.mjs`
  - **Verify:** `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs test/cli-bin.test.mjs test/lifecycle.test.mjs`
  - **Criteria:** CR4, CR7
  - **Resolved:** `2026-10-25T16:58:37Z`
- [x] Ejemplos de ayuda sin ids
  - **Target:** `bin/changeledger.mjs`, `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR12
  - **Resolved:** `2026-10-25T16:58:37Z`
- [x] Composición: `handoff` y `discarded` fuera de `MODE_CONTEXT` y `STATUS_CONTEXT`, `global-state.md` compuesto por activación con su techo, ayuda de `context`
  - **Target:** `src/commands/context.mjs`, `templates/contract/global-state.md`, `templates/contract/budgets.yml`, `bin/changeledger.mjs`, `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs test/contract.test.mjs`
  - **Criteria:** CR2, CR3, CR9
  - **Resolved:** `2026-10-25T16:58:38Z`
- [x] Recorte de prosa por fragmento: `core`, `spec`, `implement`, `review`, `close`, `delegation` (absorbe `handoff`) y la cápsula de revisión; borrado de `handoff.md` y `discarded.md`; barridos y guards reapuntados
  - **Target:** `templates/contract/*.md`, `templates/contract/agent-contexts/review.md`, `templates/contract/agent-prompts/review.md`, `test/context.test.mjs`, `test/contract.test.mjs`, `test/cli.test.mjs`, `test/search.test.mjs`
  - **Verify:** `node --test test/context.test.mjs test/contract.test.mjs test/cli.test.mjs test/search.test.mjs`
  - **Criteria:** CR1, CR5, CR6, CR7, CR8, CR10, CR14
  - **Resolved:** `2026-10-25T16:58:39Z`
- [x] Hook `no-ledger-refs.sh`, `pre-commit` y CI, con su test
  - **Target:** `hooks/no-ledger-refs.sh`, `hooks/pre-commit`, `.github/workflows/ci.yml`, `test/no-ledger-refs.test.mjs`
  - **Verify:** `node --test test/no-ledger-refs.test.mjs`
  - **Criteria:** CR11
  - **Resolved:** `2026-10-25T16:58:39Z`
- [x] README y CONTRIBUTING
  - **Target:** `README.md`, `CONTRIBUTING.md`, `test/contract.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR15
  - **Resolved:** `2026-10-25T16:58:40Z`
- [x] Medir, bajar techos y registrar palabras por fragmento frente al §5
  - **Target:** `templates/contract/budgets.yml`, `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR13
  - **Resolved:** `2026-10-25T16:58:40Z`
- [x] El día después, de punta a punta
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR16
  - **Resolved:** `2026-10-25T16:58:41Z`
- [x] Suite completa, lint y `check` antes de pedir la revisión
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-25T16:58:51Z`

## Log
- **2026-10-24T20:27:18Z** `[version]` 0.19.0
- **2026-10-25T16:12:04Z** `[status]` draft → approved (human via conversation)
- **2026-10-25T16:12:08Z** `[status]` approved → in-progress
- **2026-10-25T16:12:08Z** `[branch]` set: change/20261024-202718 (auto)
- **2026-10-25T16:14:20Z** `[note]` Specification y Plan escritos en in-progress con el código delante (dev b1bc5493). Decisiones no fijadas por el Request: global-state.md se compone en el pack core cuando loadRepo devuelve estado, con entrada overlays.global-state en budgets.yml y la línea BEGIN sumando ambos techos; un change discarded compone core y documento sin overlay; el script del hook vive en hooks/no-ledger-refs.sh, acepta --cached o un rango, y CI lo corre sólo en pull_request contra origin/dev...HEAD; los ejemplos de ayuda con id pasan a <id>; la cápsula de revisión conserva la evidencia por criterio y pierde el recorrido de «every CRn».
- **2026-10-25T16:26:40Z** `[note]` Enmienda de CR4 con el código delante: closedArgument hace que commander rechace el rol antes de la función, así que la CLI sale 1 con «Allowed choices are review.» y el mensaje «Unknown role» es el de las funciones. Selección de roles entregada: AGENT_ROLES ['review'], seis cápsulas borradas, ejemplos de ayuda con <id>; agent-context review exige ahora el id del change por delante. Tests retirados con nombre: 152555 CR1/CR2/CR7 y 20260808-151641 R1 y 144327 CR7 (investigation) en agent-context.test; 152555 CR3 en agent-prompt.test; 152555 CR8 en lifecycle.test. Selección del hook entregada: hooks/no-ledger-refs.sh, pre-commit, paso de CI sólo en pull_request y fuera de Windows, test propio, README y CONTRIBUTING. Consecuencia del hook que el Request no explicitó: los tests nuevos que necesiten un «### CR1» o un id en un fixture lo ensamblan (p. ej. CR${n}) porque el grep mira sus líneas añadidas; convención a confirmar por el humano en el PR.
- **2026-10-25T16:58:42Z** `[note]` Recorte entregado. Palabras por fragmento (antes → después, objetivo §5): core 1885→1633 (~960); spec 1375→1318 (~690); implement 1346→1007 (~500); review 621→538 (~450); close 682→612 (~350); delegation 208→268 con el triaje absorbido (~200); global-state 116 (~165); release 214; cápsula de revisión 254→261 (~150); esqueleto de revisión 268→221 (~150). Total 7016→6188; el hueco frente al §5 queda para la épica (opciones del §12). Techos (mayor medida entre fixture y este repo, decena superior): core 2380/238, spec 2380/238, implement 1960/196, review 820/82, release 440/44, agent 380/38, overlays.done 1030/103 (sin los bloques de dependencias y relaciones, que son del change), overlays.global-state 160/16, core-commits 510/51. Decisiones del implementador: activación detectada con repoIsActivated en vez de loadRepo para que un documento malformado no bloquee el bootstrap; delegation.md remite «al esqueleto de revisión» sin nombrar el comando, que sólo nombra core; el invariante «No silent repository edits» sale del listado porque la sección «When no change is needed» lo enuncia; con el aislamiento cae también «run context <id> after a fail». Tests retirados: guards 18 y 19; DELEGATION_OBLIGATIONS filas 2–9; DRAFTING_OBLIGATIONS fila 2. Renombrado: «124835 CR1 twelve blocks» → «core exposes its eleven blocks». Commits: dos selecciones; roles y contrato viajan juntos porque comparten bin/changeledger.mjs, test/context.test.mjs, test/contract.test.mjs y test/cli-bin.test.mjs.
- **2026-10-25T16:58:52Z** `[status]` in-progress → in-review
- **2026-10-25T16:58:56Z** `[note]` Mandato de revisión: auditoría completa del rango b1bc5493..cd5ace84 (dos commits) contra CR1–CR16, con las decisiones no especificadas de los tres delegados como puntos de escrutinio.
- **2026-10-25T17:10:59Z** `[review]` in-review → in-progress: Ronda 1: D1 el paso de CI diffea contra origin/<base_ref> y no contra origin/dev, así que un PR dev→main fallaría con 608 referencias existentes; D2 el hook ignora las líneas añadidas en ficheros renombrados (--diff-filter=AM); D3 el techo agent 380 queda por debajo de la cápsula medida en este repo (385); D4 agent-context investigation sin id devuelve «missing required argument» y no el mensaje de dominio cerrado que CR4 fija. Residuo: README [id] opcional, prefijos de diff configurables en el hook, sobreafirmación en delegation.md, dos comentarios rancios, Log impreciso sobre 144327 CR5. Clase: enumeración incompleta dentro de la estrategia verificada.
- **2026-10-25T17:12:42Z** `[note]` Corrección de la ronda 1: CI diffea contra origin/dev (README y CONTRIBUTING lo dicen); el hook acepta renombrados (--diff-filter=AMR) y fija prefijos a/ b/ con --no-ext-diff, con dos tests nuevos (renombrado; diff.noprefix) que fallan sin cada arreglo; techo agent 390/39 medido también en este repo (385) con el comentario corregido; CR4 enmendado para que cada invocación del rol retirado lleve id, porque la aridad se valida antes que el dominio; README exige <id> en agent-context review; delegation.md deja de afirmar que el esqueleto materializa todos los ítems; comentarios rancios de cli.test y context.test corregidos. Precisiones al Log anterior: 144327 CR5 fue reapuntado, no retirado; 20260809-113242 CR3 pasó a llamarse «agent-context uses the activated config policy»; el arreglo de ruta en test/view.test.mjs es consecuencia necesaria de la cápsula borrada y lo hizo el orquestador. Mandato de la segunda revisión: los cuatro defectos y el residuo nombrados, y cualquier regresión de la corrección.
- **2026-10-25T17:12:44Z** `[status]` in-progress → in-review
- **2026-10-25T17:17:48Z** `[review]` in-review → done (delegated subagent, clean context)
