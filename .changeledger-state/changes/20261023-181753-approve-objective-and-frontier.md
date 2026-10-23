---
id: "20261023-181753"
title: "El humano aprueba objetivo y frontera; Specification y Plan nacen en in-progress y el Definition of Ready se retira"
type: feature
status: in-progress
created: 2026-10-23T18:17:53Z
depends_on: []
branch: feature/20261023-181753
related_to:
  - "20260726-141121"
  - "20260726-141122"
  - "20260729-185200"
  - "20261001-155216"
  - "20261002-113320"
  - "20261020-172221"
parent: "20261023-181733"
owner: raruiz-hiberuscom
---

## Request

### Objective

El humano aprueba de un change dos cosas: el objetivo, qué problema se resuelve
y qué significa terminado, y la frontera, qué superficie entra, qué queda fuera
y qué queda pre-autorizado dentro. Specification y Plan se escriben ya en
`in-progress`, con el código delante, y no vuelven a pasar por aprobación:
reescribirlos durante la implementación es el comportamiento esperado y git ya
versiona el documento (plan v1.0, §3).

Con la puerta movida, el Definition of Ready deja de tener sentido: hoy
`changeledger approve` rechaza un draft cuya Specification no es test-grade o
cuyo Plan no nombra objetivo y verificación según `readiness.*_patterns`, y
eso obliga a planificar antes de investigar, que es la causa medida de que el
50 % de los changes de producto se desvíen (§3). El DoR se retira entero: el
fragmento `readiness.md`, el motor de readiness y cobertura de `check`, las
claves `readiness.*` de la configuración, la severidad de `approve` sobre
ellos y el formulario del viewer que los edita (§2.3, §9.3).

La regla de alcance que hoy obliga a discutir qué es «material» se sustituye
por el test falsable del §3.1 —entra lo que tiene que ser cierto para que el
objetivo aprobado se cumpla; sale lo que, si no se hace, deja el objetivo
cumplido igual— y por la frontera pre-autorizada del §3.2 (§6.1).

Terminado significa que un draft con sólo `## Request` —objetivo y frontera—
se aprueba, que un change aprobado escribe su Specification y su Plan en
`in-progress` sin que ninguna sede de escritura lo rechace, que la salida a
`in-review` exige que ambos existan, que ningún camino de la CLI, el viewer o
el contrato nombra el Definition of Ready, y que el test-first sigue siendo
obligación del implementador (§15.3), no puerta de admisión.

### Frontier

**Entra.** `src/commands/agent.mjs` (la sede `approved` de `statusMutation`,
`assertStagesNotEmpty`, la sede `in-review`); `src/change.mjs` (lectura de las
subsecciones del Request); `src/check.mjs` (`checkCoverage`, `readinessConfig`,
`readinessHint`, `namesTargetAndVerification`, el motor de patrones
`matchesAnyReadinessPattern`/`readinessGlob`, `checkReadinessConfig`);
`src/config-migration.mjs` (`addReadinessSection`, `removeStaleReadinessComment`
en `migrateToV4`); `templates/config.yml` y la config de este repo, en la ref de
estado y su espejo; `src/viewer/domain.mjs` (`PATCH_ALLOWED`,
`applyReadinessPatch`) y `src/viewer/public/app.js` y `view-parts.js` (el
fieldset «Definition of Ready» y el texto de `approvalPanel`);
`src/commands/context.mjs` (`MODE_CONTEXT.spec`, `fragmentsForType`);
`templates/contract/readiness.md`, `core.md`, `spec.md`, `implement.md`,
`handoff.md`, `agent-contexts/review.md`, `agent-contexts/implementation.md`
y `budgets.yml`; `README.md`; los tests que prueban cada una de esas
superficies, listados en Investigation.

**Queda fuera.** La matriz de tipos, `review_required` y `tdd` por tipo, las
etapas y el resto de claves de configuración (§13.2, otro hijo de la épica);
el estándar de cuantificadores universales y el resto del recorte del contrato
(§13.3); el evento `[finding]` y la prohibición de referencias fuera de
`.changeledger/` (§6.2, §6.3); `INTENT.md` y `docs/` (hijo de documentación de
la épica); las specs `readiness`, `validation`, `lifecycle`,
`contract-discovery`, `architecture`, `viewer`, `git-traceability` y
`data-model`, cuyos párrafos que este change vuelve falsos están listados en
Investigation y los reconcilia la épica al cerrar.

**Pre-autorizado.** Retirar cada test que sólo prueba el DoR o su prosa
(inventario en Investigation); bajar el techo `base.spec` de `budgets.yml` a
lo medido; retirar `readiness` de la config de este repo con ruptura limpia y
sin migración nueva. Si el código desmiente algo de la Specification durante la
implementación, se enmienda y se registra en el Log; si cambia el objetivo o
la frontera, se vuelve al humano.

## Investigation

Mapa de las superficies, medido en `dev` tras la 0.19.0 (investigación
delegada, lectura sin escritura).

**La puerta de aprobación.** `statusMutation` en `src/commands/agent.mjs`, rama
`newStatus === 'approved'`, es la única sede: valida el texto previo al cambio
con `assertChangeTextValid(config, name, text, { asStatus: 'approved' })`, que
proyecta `check` a severidad de error sobre readiness y cobertura, y después
`assertStagesNotEmpty(config, text)` (`src/check.mjs`), que exige que toda
etapa semántica activa tenga cuerpo: hoy un draft con Specification o Plan
vacíos recibe `cannot approve: "## Specification", "## Plan" are empty`. El
viewer (`changeStatusImpl` en `src/viewer/domain.mjs`) y `changeledger approve`
pasan por la misma sede. La transición a `in-review` repite
`assertChangeTextValid` sobre el texto previo, en `in-progress`, así que
readiness y cobertura vuelven a ser errores ahí; `approved → in-progress` sólo
llama a `assertImplementationBranch`.

**El motor de readiness.** `checkCoverage(c, fm, active, config, { warn, err,
asStatus })` en `src/check.mjs` corre si `effectiveTdd(config, type)` está
encendido y el status juzgado es `draft` (warning), `approved` o `in-progress`
(error). Emite cinco diagnósticos: `${cr.id} is not test-grade: missing
Given/When/Then`, `Plan task references unknown criterion "${cr}"`, `Plan task
for ${cr} must name target and verification (${hint})`, `${cr} is not covered
by any Plan task` y `Plan task "${label}" references no criterion`. Lo
sostienen `isSupportTask`, `namesTargetAndVerification`, `readinessConfig`
(defaults `src/**` y `test/**`), `readinessHint`, `formatPatterns`,
`matchesAnyReadinessPattern`, `readinessPatternMatches`, `readinessGlob` y
`escapeRegExp`; `checkConfig` valida la sección con `checkReadinessConfig`
(`config "readiness" must be a mapping`, `config "readiness.${key}" must be a
list`, `config "readiness.${key}" entries must be non-empty strings`). La
sección ocupa unas 150 líneas de las 1.300 del fichero. `effectiveTdd` y
`stagesRequiredByReview` quedan: la política `tdd=on|off` del contexto y la
revisión por tipo son del hijo de tipos y config.

**Configuración y migración.** `templates/config.yml` publica `tdd: true` y el
bloque `readiness` con `target_patterns: ["src/**"]` y `verification_patterns:
["test/**"]`; la config de este repo declara ocho y siete patrones. No hay
lista blanca de claves: `checkConfig` sólo valida las que conoce y una clave
desconocida se ignora en silencio, así que una config consumidora que conserve
`readiness:` sigue siendo válida sin migración. `migrateToV4` en
`src/config-migration.mjs` copia la sección desde la plantilla con
`templateSection('readiness')`, que lanza `templates/config.yml declares no
"readiness" section to migrate from` si la plantilla la pierde: retirarla de
la plantilla obliga a retirar ese paso. `SUPPORTED_SCHEMA_VERSION` es 6 y no
cambia.

**Viewer.** `PATCH_ALLOWED` incluye `'readiness'` y `applyReadinessPatch`
escribe los dos patrones; una clave fuera de la lista se salta con `continue`.
`app.js` dibuja el fieldset con `<legend>Definition of Ready</legend>` y las
áreas «Target patterns (one per line)» y «Verification patterns (one per
line)», y el checkbox «TDD mode (require test-grade criteria)».
`approvalPanel` en `view-parts.js` se muestra para todo `draft` con el texto
«Review the proposal, then approve it to make this change ready for
implementation.» y el botón `Approve`; no muestra diagnósticos de readiness.

**Contrato y composición.** `templates/contract/readiness.md` son 376 palabras
y define los cinco puntos del DoR; `MODE_CONTEXT.spec` en
`src/commands/context.mjs` compone `['spec', 'delegation', 'readiness']` y
`fragmentsForType` retira `readiness` cuando el tipo no activa `specification`
o su `tdd` efectivo está apagado. Frases que este change reescribe, con su
fragmento: en `core.md`, el invariante «One concern per change. … if related
work materially expands observable scope, get explicit human authorization
before adding it», la descripción de `draft` («documentation awaiting human
approval») y la de `approved`; en `spec.md`, «`Support` … needs no CR or
target/verification readiness checks» y la ausencia de toda mención al
objetivo y la frontera fuera del párrafo de la épica; en `implement.md`,
«Follow the Specification exactly: the approved change governs the code…» y el
paso 3 de la puerta de revisión «the transition itself refuses a candidate
whose readiness is invalid»; en `handoff.md`, «Independent, too large or
materially broader: keep it outside the change»; en
`agent-contexts/implementation.md`, «follow the selected change's Specification
and Plan exactly»; en `agent-contexts/review.md`, «that implementation did not
drift from the authorized document». Ningún fragmento del pack `spec` contiene
el «sizing test» que el techo de complejidad de `core.md` le atribuye: hueco
previo, fuera de esta frontera, se reporta.

**Tests que caen o cambian.** `test/check.test.mjs` (unos 37 casos de readiness
y cobertura; 12 aserciones sobre `must name target and verification`, 7 sobre
`references unknown criterion`, 5 sobre `is not covered by any Plan task`, 4
sobre `references no criterion`, 3 sobre `is not test-grade`),
`test/agent.test.mjs` (9: `185200 CR1/CR2`, `213633 CR1/CR2`, `124656 CR3`,
`125139 CR1/CR7`, `161655 CR5`, `20261001-155216 CR10`), `test/cli.test.mjs`
(5, entre ellos `141122 CR2` y `124656 CR3`), `test/cli-bin.test.mjs` (1),
`test/config-migration.test.mjs` (4: `183807 CR3`, `141122 CR4/CR5`),
`test/lifecycle.test.mjs` (1), `test/view.test.mjs` (2),
`test/viewer-metadata.test.mjs` (7) y en `test/context.test.mjs` los pins
`234939` (owned headings del pack `spec`), `141121 CR2/CR3/CR4`, `002730`,
`113320 CR4`, `185200 CR5` (dos obligaciones con dueño `readiness.md`),
`143656 CR4` (inventario de fragmentos), `203257 CR7` y el guard de concepto 5
(«`approve` judges the draft at `approved` severity and refuses an unready
one»). El guard de concepto 2 («a draft is never executed») y el 7 (el humano
posee `draft → approved`) siguen siendo verdad y se conservan.

**Changes relacionados.** `20261020-172221` introdujo la épica «aprobada sobre
objetivo y frontera» en prosa; este change le da forma estructural y la
extiende a todo tipo. `20260726-141121`, `20260726-141122`, `20260729-185200` y
`20261002-113320` construyeron la composición de `readiness` y los pins que
aquí se retiran; son contexto, no prerrequisito.

## Proposal

### Solución elegida

**Objetivo y frontera con forma.** `## Request` lleva dos subsecciones de
nivel tres con heading fijo en inglés, `### Objective` y `### Frontier`, en
cualquier tipo. Son estructura, como los `### CRn` de Specification, y por eso
`approve` puede juzgarlas sin leer prosa: rechaza un draft al que le falte una
o la tenga vacía, con el mismo molde que hoy usa para las etapas. Nada más se
exige al aprobar: Investigation, Proposal, Specification y Plan pueden estar
vacíos. Otros `###` dentro del Request siguen siendo prosa libre.

**La puerta de readiness desaparece; queda la integridad.** `checkCoverage`
pierde los cuatro diagnósticos de readiness y cobertura. Sobrevive uno, que
no es readiness sino una referencia rota, igual que una etapa desconocida:
una tarea cuyo `Criteria` cita un `CRn` que la Specification no declara es un
error en cualquier estado, también en `draft`. `readinessConfig`,
`readinessHint`, `namesTargetAndVerification`, el motor de patrones y
`checkReadinessConfig` se borran; `Support` deja de necesitar exención porque
ya no hay de qué eximirlo, y sigue siendo gramática legal del Plan.

**La salida a `in-review` es el gate del implementador.** Cada etapa verifica
su propia salida (core): el paso a `in-review` exige que toda etapa activa
entre `specification` y `plan` tenga cuerpo y que Specification declare al
menos un `### CRn`, con `cannot request review: …` y el documento intacto.
Sustituye a la revalidación de readiness que esa transición hacía hoy.

**Configuración.** `readiness` sale de `templates/config.yml` y de la config
de este repo. `migrateToV4` deja de copiar la sección y de borrar el comentario
antiguo; una config consumidora que la conserve se ignora como cualquier clave
desconocida, sin error, sin warning y sin migración: ruptura limpia (§2.3).
`tdd` se queda tal cual, con su comentario reescrito para que no prometa un
DoR que ya no existe.

**Viewer.** El fieldset «Definition of Ready» y `applyReadinessPatch`
desaparecen; `readiness` sale de `PATCH_ALLOWED` y un PATCH que la traiga se
ignora como hoy se ignora cualquier clave fuera de la lista. El panel de
aprobación dice lo que el humano aprueba: el objetivo y la frontera.

**Contrato.** `readiness.md` se borra y `MODE_CONTEXT.spec` compone `spec` y
`delegation`; `fragmentsForType` pierde la condición sobre `readiness`.
`spec.md` gana la regla de las dos subsecciones y la de que Specification y
Plan nacen en `in-progress` y no vuelven a aprobación; `core.md` cambia el
invariante de alcance por el test del §3.1 con la frontera pre-autorizada del
§3.2 y describe `draft` como objetivo y frontera a la espera del humano;
`implement.md` deja de mandar «seguir la Specification exactamente» y pasa a
decir que el objetivo y la frontera aprobados gobiernan, que Specification y
Plan son el contrato del implementador, escritos con el código delante y
reescritos cuando el entendimiento mejora, con el Log diciendo por qué, y
describe la puerta de `in-review` nueva; `handoff.md` y las dos cápsulas
siguen la misma regla. La obligación test-first se queda donde está, en
`implement.md`. El techo `base.spec` baja a lo medido. Ninguna obligación que
no sea el DoR desaparece: cada frase retirada nombra su nuevo hogar en el Log.

**Lo que se queda fuera a propósito.** `tdd` como política, `review_required`
y las etapas por tipo: cambiarlos aquí mezclaría este concepto con el del
siguiente hijo. Las specs que este change vuelve falsas (`readiness` entera y
los párrafos listados en Investigation) las reconcilia la épica al cerrar,
como `assertParentOwnsGraduation` impone; mientras tanto el Log de este change
las nombra como divergencia conocida.

### Alternativas descartadas

- **Mantener el DoR como warning en vez de borrarlo.** Es la mitad del camino:
  la prosa seguiría enseñando a escribir Specification y Plan antes de
  aprobar, y `check` seguiría cargando 150 líneas y 37 tests para avisar de
  algo que ya no es una puerta. El plan lo retira por decisión (§2.3).
- **Objetivo y frontera como campos del frontmatter.** Serían dos textos
  largos en YAML, ilegibles en el viewer y fuera del Request, donde el humano
  los lee. Las subsecciones viven donde se leen y `check` las encuentra igual.
- **Dos changes, uno para la puerta y otro para el DoR.** Son bilaterales:
  aprobar sin Specification es imposible mientras readiness sea error en
  `approved`, y retirar readiness sin mover la puerta deja `approve` exigiendo
  cuerpo a etapas que ya no juzga nadie.
- **Exigir las subsecciones sólo a los tipos con `specification`.** Añade una
  excepción por tipo justo cuando el plan quiere que el tipo deje de decidir
  el ceremonial (§15.1); dos líneas más en un `quick` cuestan menos que la
  regla.

### Escenarios

- **El día después.** El humano pide un trabajo; el agente redacta un draft con
  Request, objetivo y frontera, y lo que de Investigation y Proposal ayude a
  decidir; el humano aprueba; el agente crea la rama, pasa a `in-progress`,
  investiga con el código delante y escribe Specification y Plan con `edit`,
  implementa con test-first, pide revisión, y la revisión juzga los criterios
  que el implementador escribió contra el objetivo que el humano aprobó.
- **Una Specification que cambia durante la implementación.** El implementador
  la reescribe con `edit`, el Log registra qué y por qué, y nadie vuelve a
  aprobar nada; si lo que cambia es el objetivo o la frontera, se para y se
  vuelve al humano.
- **Un repo consumidor con `readiness:` en su config.** Actualiza la CLI y nada
  cambia para él: la clave se ignora, `check` no la nombra, y sus drafts
  pendientes se aprueban cuando el Request declare objetivo y frontera.

## Specification

### CR1 — Un draft con objetivo y frontera se aprueba sin Specification ni Plan
- **Given** un change de tipo `feature` en `draft` cuyo `## Request` contiene `### Objective` y `### Frontier` con cuerpo y cuyas etapas `## Investigation`, `## Proposal`, `## Specification` y `## Plan` están vacías
- **When** se ejecuta `changeledger approve <id>`
- **Then** el status pasa a `approved`, el comando termina con exit 0 y el Log registra `[status]` draft → approved (human via conversation)
- **And** `changeledger check` no reporta ningún error ni warning sobre ese change

### CR2 — Sin objetivo o sin frontera no hay aprobación
- **Given** un draft cuyo `## Request` tiene cuerpo pero carece de `### Frontier`
- **When** se ejecuta `changeledger approve <id>`
- **Then** falla con exit distinto de 0 y el mensaje `cannot approve: "### Frontier" is missing`, y el documento queda byte-idéntico
- **And** un draft con las dos subsecciones presentes pero vacías falla con `cannot approve: "### Objective", "### Frontier" are empty`
- **And** un draft con `## Request` vacío falla con `cannot approve: "## Request" is empty`, como hoy
- **And** la misma negativa se obtiene por el viewer, cuya transición `draft → approved` pasa por la misma sede

### CR3 — La readiness deja de juzgarse en todo estado
- **Given** un change en `draft`, otro en `approved` y otro en `in-progress`, los tres con una Specification cuyo `### CR1 — x` es prosa sin pasos Given/When/Then, un Plan con una tarea sin `Target`, `Verify` ni `Criteria` y un segundo `### CR2` sin tarea que lo cite
- **When** se ejecuta `changeledger check`
- **Then** no reporta ninguna línea que contenga `is not test-grade`, `must name target and verification`, `is not covered by any Plan task` ni `references no criterion` para ninguno de los tres
- **And** `changeledger approve` sobre el primero termina con exit 0

### CR4 — Una referencia a un criterio inexistente es un error en cualquier estado
- **Given** un change en `draft` cuyo Plan tiene una tarea con `- **Criteria:** CR9` y cuya Specification no declara `### CR9`
- **When** se ejecuta `changeledger check`
- **Then** reporta el error `Plan task references unknown criterion "CR9"` sobre ese change, no un warning
- **And** el mismo documento en `in-progress` y en `done` recibe el mismo error

### CR5 — La salida a in-review exige Specification con criterios y Plan
- **Given** un change `feature` en `in-progress` con `## Specification` vacía y `## Plan` con una tarea
- **When** se ejecuta `changeledger status <id> in-review`
- **Then** falla con exit distinto de 0 y el mensaje `cannot request review: "## Specification" is empty`, y el documento queda byte-idéntico
- **And** con Specification que tiene cuerpo pero ningún `### CRn`, falla con `cannot request review: "## Specification" declares no criterion`
- **And** con `## Specification` y `## Plan` ambas vacías falla con `cannot request review: "## Specification", "## Plan" are empty`
- **And** con al menos un `### CR1` y un Plan con cuerpo, el status pasa a `in-review` y el comando termina con exit 0

### CR6 — La configuración pierde readiness con ruptura limpia
- **Given** `templates/config.yml` y la config autoritativa de este repo en la ref de estado
- **When** se lee cada una
- **Then** ninguna contiene la clave `readiness` ni la frase `Definition of Ready`, y `tdd: true` sigue declarado en ambas
- **And** `changeledger check` sobre un repo cuya config conserva un bloque `readiness:` con patrones no reporta ningún error ni warning sobre la config
- **And** `changeledger config migrate` sobre una config de esquema 3 produce una config sin clave `readiness`, sin la línea de cambio `added readiness section` y sin la línea `removed stale commented-out readiness block`
- **And** `src/check.mjs` no exporta ni define `readinessConfig`, `readinessHint`, `namesTargetAndVerification`, `matchesAnyReadinessPattern`, `readinessGlob` ni `checkReadinessConfig`

### CR7 — El contrato publica el modelo nuevo y entierra el antiguo
- **Given** los contextos `changeledger context`, `context spec`, `context implement` y los `agent-context implementation` y `agent-context review`
- **When** se componen
- **Then** ningún fragmento bajo `templates/contract/` contiene `Definition of Ready`, `readiness`, `test-grade` ni `materially expands observable scope`, y `templates/contract/readiness.md` no existe
- **And** `context spec` no contiene el heading `# Definition of Ready` y sí una frase que nombra `### Objective` y `### Frontier` como subsecciones del Request que `approve` exige
- **And** `context spec` enuncia que Specification y Plan se escriben en `in-progress` y no vuelven a aprobación, con un patrón tolerante a la redacción: `/Specification and Plan[^.]{0,80}in-progress/` y `/(never|not|no)[^.]{0,40}(re-?approv|return[^.]{0,20}approval)/i`
- **And** `context` (core) enuncia el test de alcance con un patrón tolerante: `/must be true[^.]{0,60}objective/i` y `/(pre-?authori[sz]ed|frontier)/i`
- **And** `context implement` enuncia que el objetivo y la frontera aprobados gobiernan y que la transición a `in-review` exige Specification y Plan, con `/objective and frontier/i` y `/in-review[^.]{0,80}(Specification|Plan)/`
- **And** cada contexto cabe en su techo de `budgets.yml`, con `base.spec` bajado a lo medido en el mismo change y pinneado en `test/context.test.mjs`

### CR8 — El viewer deja de editar el DoR y dice qué se aprueba
- **Given** el viewer sirviendo este repo
- **When** se abre el formulario de configuración y el detalle de un `draft`
- **Then** el formulario no contiene ningún fieldset con legend `Definition of Ready` ni las áreas `Target patterns (one per line)` y `Verification patterns (one per line)`, y la etiqueta del checkbox de `tdd` no contiene `test-grade`
- **And** un PATCH de configuración que trae `readiness` deja la config igual que la deja un PATCH sin claves aceptadas: sin la clave y sin más diferencia que la re-serialización que todo PATCH aceptado aplica hoy
- **And** el panel de aprobación del draft contiene el texto `Review the objective and the frontier, then approve them: Specification and Plan are written during implementation.` y el botón `Approve`

### CR9 — El flujo completo del día después, de punta a punta por la CLI
- **Given** un repo de prueba activado con la config de la plantilla
- **When** se crea un `feature` con `new --from` cuyo documento sólo tiene `## Request` con `### Objective` y `### Frontier` y las demás etapas vacías; se aprueba con `approve`; se pasa a `in-progress` con `status`; se escribe con `edit <id> --from` una Specification con `### CR1` en forma Given/When/Then y un Plan con una tarea que cita CR1; se marca la tarea con `task <id> done 1`; se pasa a `in-review` con `status`; y se cierra con `review <id> pass`
- **Then** cada comando termina con exit 0, el Log del change registra en orden las transiciones draft → approved, approved → in-progress, in-progress → in-review e in-review → done, y `changeledger check` termina en verde
- **And** la escritura con `edit` en `in-progress` no es rechazada por `introducedErrors` aunque la Specification y el Plan estuvieran vacíos antes

### CR10 — README describe la puerta nueva
- **Given** `README.md`
- **When** se lee
- **Then** no contiene `Definition of Ready` ni `test-grade`, y la frase que describe la aprobación dice que el humano aprueba el objetivo y la frontera del draft antes de la implementación

### CR11 — Los tests del DoR se retiran y los de la integridad se quedan
- **Given** la suite tras el change
- **When** se ejecuta `pnpm test`
- **Then** pasa completa, ningún test afirma la presencia de `must name target and verification`, `is not test-grade`, `is not covered by any Plan task`, `references no criterion`, `added readiness section` ni `readiness.target_patterns` (una comprobación de ausencia sí puede nombrarlos), y los tests que afirman `references unknown criterion` siguen existiendo con la severidad de CR4
- **And** los guards de concepto de `test/context.test.mjs` «a draft is never executed» y «the human owns the human lifecycle transitions» siguen pasando sin cambio

## Plan

- [ ] Leer `### Objective` y `### Frontier` del Request y sustituir en la sede `approved` de `statusMutation` la exigencia de etapas con cuerpo por la de las dos subsecciones
  - **Target:** `src/change.mjs`, `src/commands/agent.mjs`, `src/check.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Retirar de `checkCoverage` los diagnósticos de readiness y cobertura, el motor de patrones y `checkReadinessConfig`, dejando la referencia rota como error en todo estado
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR3, CR4
- [ ] Añadir a la sede `in-review` de `statusMutation` la exigencia de Specification con criterio y Plan con cuerpo
  - **Target:** `src/commands/agent.mjs`, `src/check.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR5
- [ ] Retirar `readiness` de la plantilla, de la migración a v4 y de la config de este repo en la ref de estado y su espejo
  - **Target:** `templates/config.yml`, `src/config-migration.mjs`, `.changeledger/config.yml`
  - **Verify:** `node --test test/config-migration.test.mjs test/cli.test.mjs`
  - **Criteria:** CR6
- [x] Quitar del viewer el fieldset del DoR, `applyReadinessPatch` y la clave en `PATCH_ALLOWED`, y reescribir el texto del panel de aprobación
  - **Target:** `src/viewer/domain.mjs`, `src/viewer/public/app.js`, `src/viewer/public/view-parts.js`
  - **Verify:** `node --test test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-23T22:40:17Z`
- [x] Borrar `readiness.md`, recomponer el pack `spec`, reescribir las frases del contrato listadas en Investigation con el modelo nuevo y bajar `base.spec` a lo medido
  - **Target:** `templates/contract/`, `src/commands/context.mjs`, `templates/contract/budgets.yml`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-23T22:46:18Z`
- [ ] Reescribir en README la frase del DoR y la de la aprobación
  - **Target:** `README.md`, `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR10
- [ ] Escribir el test del flujo completo por la CLI
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR9
- [ ] Retirar los tests del DoR del inventario de Investigation y reetiquetar los que sobreviven
  - **Target:** `test/`
  - **Verify:** `pnpm test`
  - **Criteria:** CR11
- [ ] Pasar el gate completo y anotar en el Log las specs que quedan en divergencia hasta que la épica reconcilie
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-23T18:17:53Z** `[version]` 0.18.0
- **2026-10-23T22:18:59Z** `[status]` draft → approved (human via conversation)
- **2026-10-23T22:28:26Z** `[version]` 0.18.0 → 0.19.0
- **2026-10-23T22:28:26Z** `[status]` approved → in-progress
- **2026-10-23T22:28:26Z** `[branch]` set: feature/20261023-181753 (auto)
- **2026-10-23T23:06:45Z** `[note]` Enmiendas de la Specification en in-progress, dentro de la frontera pre-autorizada: CR8 ya no exige config byte-idéntica ante un PATCH con readiness porque todo PATCH aceptado del viewer re-serializa el YAML (padding de flujo en las listas), medido por la selección de viewer; ahora exige el mismo resultado que un PATCH sin claves aceptadas. CR11 precisa que lo prohibido es afirmar la presencia de los diagnósticos retirados: CR3 necesita nombrarlos en una comprobación de ausencia.
