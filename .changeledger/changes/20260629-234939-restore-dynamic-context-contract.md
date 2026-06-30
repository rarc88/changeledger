---
id: "20260629-234939"
title: Restaurar invariantes del contrato en el contexto dinámico
type: feature
status: done
created: 2026-06-29T23:49:39Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Al sustituir el contrato monolítico de `templates/AGENTS.md` por contexto dinámico
se redujo correctamente el coste de contexto, pero también desaparecieron
invariantes que guiaban el comportamiento de los agentes. Desde entonces los
agentes reciben instrucciones distintas en delegación, manejo del worktree,
correcciones rechazadas, autoría de changes y transiciones de lifecycle.

Objetivo autorizado: rescatar del contrato anterior todo lo importante, justo y
necesario para recuperar el comportamiento esperado, sin volver a cargar el
monolito completo ni duplicar reglas entre fragmentos.

## Investigation

Baseline comparado: `templates/AGENTS.md` en
`ef62393becbebbbec0c9b003803e139ebcab0c2e` frente a los fragmentos actuales de
`templates/contract/` y las composiciones de `src/commands/context.mjs`.

- El contrato anterior medía 540 líneas / 30.053 bytes. Los diez fragmentos
  actuales suman 333 líneas / 15.209 bytes. Reducirlo era parte del objetivo, por
  lo que la diferencia de tamaño no demuestra por sí sola una pérdida.
- Se conservaron los gates principales: autorización humana, prohibición de
  implementar drafts, trazabilidad change→código, lifecycle, review independiente,
  validación humana, graduación y Definition of Ready.
- Se añadieron protecciones valiosas que no estaban en el baseline: lectura
  completa sin truncar, contexto incremental explícito, discovery operacional y
  clasificación de preparación rutinaria de releases.
- Se perdieron reglas con efecto observable: no duplicar verdad entre stages;
  root cause obligatorio en bugs y foco de auditoría en audits; uso de Mermaid
  cuando un diagrama explica mejor; libertad de editar los archivos fuente sin
  convertir los helpers CLI en obligatorios; disciplina general de delegación,
  ownership e integración; respuesta concreta ante un worktree con cambios
  ajenos; commit de una corrección rechazada después de su validación; y el límite
  entre review independiente y herramientas especializadas de seguridad/lint.
- `blocked`, `in-validation` y un review fallido pueden devolver el change a
  `in-progress`, pero sus overlays no ordenan recargar `context <id>`. Como el
  contexto incremental del estado anterior no incluye `implement` ni
  `readiness`, el agente puede reanudar con instrucciones incompletas.
- `test/context.test.mjs` prueba presupuesto, determinismo, headings y frases
  seleccionadas, pero no mantiene un inventario de invariantes ni comprueba que
  cada comportamiento contractual importante aparezca en el modo que lo usa.

La causa no es el modelo de contexto dinámico, sino haber tratado la migración
como una reducción textual sin una matriz explícita de paridad semántica.

La validación humana rechazó el primer intento y aportó una segunda auditoría
completa contra `.tmp/OLD_AGENTS.md`. Hallazgos adicionales confirmados:

- `spec` perdió el comando canónico `changeledger new`, los helpers de autoría y
  detalles operativos de owner, ids y lenguaje.
- La gramática de tareas quedó sin la advertencia crítica sobre `verify:` después
  de `(CRn) —`, sin explicar cómo el parser identifica el bloque final de
  criterios y con una definición demasiado breve de `(support)`.
- `readiness` conserva la idea general, pero perdió ejemplos concretos de
  verificaciones aceptables, el propósito del split documentador/implementador y
  cuándo `tdd: false` es apropiado.
- `implement` perdió el formato canónico de commit, la razón de los commits
  intermedios y parte de la precisión de aislamiento de correcciones.
- La delegación táctica se redujo a una frase: desaparecieron fronteras buenas,
  criterios por etapa, selección concreta de modelos y antipatrones.
- `close` perdió `reviewed: true`, su significado, el marcador de graduación y
  comandos de inspección/archivo útiles.
- El primer intento agravó el problema al interpretar “una fuente” como “ninguna
  elaboración contextual”: una regla puede resumirse en core y desarrollarse en
  un fragmento compartido sin duplicar fuentes divergentes.

Los outputs actuales son 129 líneas para `spec`, 80 para `implement` y 25 para
`review`. El contexto dinámico debe reducir carga seleccionando el pack correcto,
no vaciando de detalle el pack seleccionado.

## Proposal

Tratar `.tmp/OLD_AGENTS.md` como baseline de migración y clasificar cada bloque:

1. **Conservar con igual precisión operativa.** Reglas, ejemplos canónicos,
   antipatrones, razones que evitan una decisión errónea y comandos propios de la
   etapa deben aparecer en el output dinámico donde el agente los necesita.
2. **Reemplazar explícitamente.** Reglas cuyo mecanismo cambió —por ejemplo el
   symlink `.changeledger/AGENTS.md` sustituido por `changeledger context`— se
   mapean a la protección nueva equivalente y no se restauran literalmente.
3. **Retirar justificadamente.** Solo se excluyen detalles obsoletos o puramente
   descriptivos que ya no guían una acción; cada exclusión queda cubierta por una
   decisión comprobable, no por “parecía redundante”.

Organizar el contrato por responsabilidad, sin imponer brevedad a los packs:

- `core.md`: gates universales, lifecycle, discovery y un índice breve de reglas
  transversales. Conserva el presupuesto de 120 líneas / 8192 bytes.
- `spec.md`: autoría completa — comando `new`, metadata, stages, CRs, gramática
  exacta de tareas, ids, lenguaje, helpers y ejemplos buenos/malos.
- `readiness.md`: intención del split documentador/implementador, criterios
  test-grade, verificaciones concretas, patrones configurables y `tdd: false`.
- `implement.md`: scope, Git/worktree, formato de commits, granularidad,
  actualización continua, TDD, correcciones y handoff.
- Nuevo `delegation.md`: guía táctica compartida por `spec`, `implement` y
  `review`; una sola fuente detallada compuesta donde aplica. El core puede
  resumirla sin competir con ella.
- `review.md`: independencia, superficie exacta de revisión, herramientas
  especializadas, verdicts y retry.
- `close.md`: persistent truth, `reviewed: true`, graduación/skip, markers,
  archive/unarchive e inspección.
- Overlays y `release.md`: conservar sus reglas específicas actuales y recuperar
  solo detalle relevante del baseline.

La regresión se prueba sobre outputs completos, no contando frases sueltas. Los
tests deben exigir ejemplos literales cuando su forma es parte del contrato
(`changeledger new`, commit, tareas correctas/incorrectas), confirmar composición
del fragmento compartido y demostrar que ninguna etapa vuelve a quedarse sin su
guía accionable.

Alternativas descartadas:

- Restaurar el monolito como fuente paralela: elimina el beneficio dinámico y
  permite divergencia.
- Mantener packs mínimos y remitir todo a `help`: el CLI explica sintaxis, no el
  razonamiento, los antipatrones ni cuándo usar cada operación.
- Prohibir toda repetición semántica: confunde una fuente detallada compartida
  con un resumen contextual y vuelve ambiguos los modos.

## Specification

### CR1 — Autoría conserva verdad y semántica por tipo
- **Given** el contexto completo de `changeledger context spec`
- **When** un agente documenta un feature, bug o audit
- **Then** el output ordena mantener cada dato en un solo stage y enlazarlo desde otros
- **And** exige root cause en Investigation para bugs y análisis central en Investigation para audits
- **And** Proposal conserva alternativas descartadas y escenarios

### CR2 — Visuales solo cuando mejoran la explicación
- **Given** el contexto completo de `changeledger context spec`
- **When** una relación, flujo o arquitectura se entiende mejor visualmente que con prosa
- **Then** el output indica usar un bloque Mermaid cuya fuente textual permanece en el change

### CR3 — Delegación transversal económica y con ownership
- **Given** el contexto completo de `changeledger context`
- **When** un agente considera delegar investigación, especificación, implementación o verificación
- **Then** el output exige una frontera y beneficio claros, ownership, resultado esperado y criterio de integración
- **And** prohíbe sobre-fragmentar, solapar escrituras sin plan o revertir cambios ajenos
- **And** indica dimensionar el modelo según dificultad y riesgo

### CR4 — Worktree ajeno requiere decisión humana
- **Given** `changeledger context implement` y un worktree con cambios no relacionados
- **When** el agente se prepara para implementar un change aprobado
- **Then** el output le prohíbe incluirlos silenciosamente y le ordena pedir al humano elegir entre stash, commit, ignorar o incluir

### CR5 — Corrección rechazada se confirma antes del commit
- **Given** un change rechazado por el humano que vuelve de `in-validation` a `in-progress`
- **When** el agente prepara una corrección
- **Then** `changeledger context implement` exige mantenerla sin commit y sin mezclar otro trabajo hasta confirmación humana
- **And** tras la aceptación exige graduar o registrar skip y commitear la corrección con su verdad de ledger

### CR6 — Review usa herramientas especializadas sin duplicarlas
- **Given** el contexto completo de `changeledger context review`
- **When** el reviewer necesita evidencia de lint, SAST o seguridad profunda
- **Then** el output permite ejecutar la herramienta dedicada y registrar su resultado
- **And** declara que ChangeLedger no reimplementa esos analizadores

### CR7 — Volver a in-progress recarga el pack correcto
- **Given** un change `blocked`, `in-validation` o `in-review`
- **When** una resolución, rechazo humano o review `fail --retry` lo mueve a `in-progress`
- **Then** el overlay correspondiente ordena ejecutar `changeledger context <id>` antes de modificar implementación
- **And** la nueva salida contiene `Mode: implement`, `# Implementing an Approved Change` y `# Definition of Ready`

### CR8 — Archivos fuente y helpers mantienen su frontera
- **Given** el contexto completo de `changeledger context`
- **When** un agente debe actualizar lifecycle, tareas, ownership o Log
- **Then** el output declara que los archivos son la fuente de verdad y pueden editarse directamente
- **And** presenta los comandos CLI como helpers preferibles para operaciones propensas a error, no como requisito exclusivo

### CR9 — La restauración conserva el presupuesto dinámico
- **Given** todos los invariantes rescatados
- **When** se genera `changeledger context` sin argumentos
- **Then** la salida es determinista y no supera 120 líneas ni 8192 bytes UTF-8
- **And** los packs pueden ser detallados sin duplicar fuentes divergentes

### CR10 — Cobertura operacional impide otra pérdida silenciosa
- **Given** los outputs completos de core, modos y overlays
- **When** se elimina un comando, ejemplo, antipatrón o regla rescatada del output que la necesita
- **Then** `node --test test/context.test.mjs` falla identificando la conducta ausente y el contexto esperado

### CR11 — Baseline clasificado sin pérdidas implícitas
- **Given** los bloques del contrato en `.tmp/OLD_AGENTS.md`
- **When** se revisa la migración al contrato dinámico
- **Then** cada bloque está conservado con precisión equivalente, reemplazado por el mecanismo nuevo o retirado por una razón explícita
- **And** el symlink, `register` para relink y referencias a `.changeledger/AGENTS.md` se clasifican como obsoletos y no reaparecen en el contrato vigente

### CR12 — Autoría usa comandos y metadata exactos
- **Given** el output completo de `changeledger context spec`
- **When** un agente crea o interpreta un change
- **Then** ve literalmente `changeledger new <type> <slug> "<title>"`, `changeledger check [id]`, `changeledger list` y `changeledger show`
- **And** conoce asignación, fallback, override y ausencia de `owner`
- **And** conoce la derivación UTC del id, el slug inglés y la diferencia completa entre estructura inglesa y contenido localizado

### CR13 — Gramática de tareas explica parser y antipatrones
- **Given** el output completo de `changeledger context spec`
- **When** un agente redacta Plan
- **Then** ve ejemplos pending, done y blocked con target, `verify:`, `(CRn)` y sufijo en el orden parseable
- **And** ve el ejemplo inválido `Update src/app/foo.ts (CR1) — verify: pnpm test` y por qué el parser descarta esa evidencia
- **And** entiende que solo el bloque final `(CRn)` aporta trazabilidad y que menciones previas son prosa
- **And** `(support)` queda reservado a trabajo sin comportamiento observable, con ejemplos, sin checks de readiness y nunca sustituye un CR de implementación

### CR14 — Readiness exige evidencia concreta
- **Given** el output de `changeledger context spec` o `changeledger context implement`
- **When** `tdd: true`
- **Then** explica que el change debe permitir implementar sin redefinir qué probar
- **And** exige valores concretos, efectos exactos, errores literales y un CR por edge case
- **And** muestra verificación mediante test colocalizado, directorio convencional, comando concreto o `verify: manual ...`
- **And** reserva `tdd: false` para repos exploratorios

### CR15 — Git conserva trazabilidad accionable
- **Given** el output completo de `changeledger context implement`
- **When** un agente implementa y commitea
- **Then** ve literalmente `feat(scope): description [#20260629-234939]` como patrón canónico
- **And** sabe commitear unidades verificadas antes de mezclar otra tarea, change o edición de la misma superficie
- **And** sabe no reconstruir diffs mixtos al final y registrar cualquier commit combinado inevitable

### CR16 — Delegación recupera guía táctica completa
- **Given** los outputs `spec`, `implement` y `review`
- **When** un agente decide delegar
- **Then** recibe el mismo fragmento detallado con fronteras buenas: pregunta de investigación, módulo, package, test area, migración o verificación
- **And** distingue exploración paralela, diseño ambiguo, writes disjuntos y review independiente
- **And** evita un subagente por archivo o cambio mecánico, solapes sin integración y coordinación sin beneficio
- **And** usa modelos fuertes para ambigüedad, arquitectura, seguridad y review difícil, y modelos suficientes baratos para inventarios, búsquedas y trabajo mecánico
- **And** cada prompt fija motivo, ownership, output, dificultad e integración y prohíbe revertir trabajo ajeno

### CR17 — Review mantiene instrucciones específicas
- **Given** `changeledger context review`
- **When** un reviewer independiente evalúa trabajo
- **Then** ve clean context, modelo proporcionado a la dificultad, CRs, Plan, tests, diff y residue
- **And** ve herramientas especializadas y los tres comandos literales `pass`, `fail --retry` y `fail --block`
- **And** entiende que tipos sin review pasan directamente a validación

### CR18 — Cierre explica persistent truth y reviewed
- **Given** un change `done`
- **When** se genera su contexto de cierre
- **Then** explica que specs no tienen lifecycle y muestra frontmatter `title`, `updated`, `tags`
- **And** explica `reviewed: true` tanto para graduación como para skip y cómo se deriva el vínculo desde Log
- **And** incluye graduate nuevo, `--into`, `--skip`, `--pending`, archive/unarchive y list/show

### CR19 — Lifecycle conserva actores y descarte
- **Given** el core y los overlays de lifecycle
- **When** un agente interpreta una transición o descarte
- **Then** distingue movimientos del agente y del humano, razón obligatoria de descarte y preservación de dependencias
- **And** mantiene done/discarded terminales y exige un change nuevo para reconsideración

### CR20 — Contexto dinámico selecciona detalle, no lo elimina
- **Given** el fragmento compartido de delegación y los packs detallados
- **When** se genera `context spec`, `implement` o `review`
- **Then** cada output contiene la guía detallada que usa esa etapa sin cargar packs ajenos
- **And** el core sigue dentro de presupuesto y ningún output operativo depende de `.tmp/OLD_AGENTS.md`

## Plan

- [x] Restaurar en `templates/**` (`templates/contract/core.md`) la frontera archivos/CLI y la disciplina transversal de delegación; verify: `node --test test/context.test.mjs` (`test/**`) (CR3, CR8, CR9) — 2026-06-29T23:57:14Z
- [x] Restaurar en `templates/**` (`templates/contract/spec.md`) fuente única entre stages, semántica de bug/audit/Proposal y criterio Mermaid; verify: `node --test test/context.test.mjs` (`test/**`) (CR1, CR2, CR9) — 2026-06-29T23:57:14Z
- [x] Completar en `templates/**` (`templates/contract/implement.md`) el manejo del worktree ajeno y cierre de correcciones rechazadas; verify: `node --test test/context.test.mjs` (`test/**`) (CR4, CR5, CR9) — 2026-06-29T23:57:14Z
- [x] Completar en `templates/**` (`templates/contract/review.md`, `blocked.md` y `validation.md`) el límite de herramientas y la recarga tras volver a `in-progress`; verify: `node --test test/context.test.mjs` (`test/**`) (CR6, CR7, CR9) — 2026-06-29T23:57:14Z
- [x] Blindar los outputs de `templates/**` con la matriz de invariantes y casos por modo/lifecycle en `test/**` (`test/context.test.mjs`), conservando determinismo y presupuesto; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8, CR9, CR10) — 2026-06-29T23:57:14Z
- [x] Ejecutar el gate completo del repositorio; verify: `pnpm verify` (support) — 2026-06-29T23:57:50Z
- [x] Clasificar el baseline y convertir la auditoría exhaustiva en expectativas de `test/context.test.mjs` sobre `templates/**`; verify: `node --test test/context.test.mjs` (`test/**`) (CR10, CR11, CR20) — 2026-06-30T10:16:36Z
- [x] Restaurar autoría, metadata, ids, lenguaje, helpers y gramática completa de tareas en `templates/**` (`spec.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR1, CR2, CR12, CR13) — 2026-06-30T10:16:36Z
- [x] Restaurar intención TDD y formas concretas de evidencia en `templates/**` (`readiness.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR14) — 2026-06-30T10:16:36Z
- [x] Restaurar Git, commits intermedios y aislamiento completo en `templates/**` (`implement.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR4, CR5, CR15) — 2026-06-30T10:16:36Z
- [x] Crear `templates/**` (`delegation.md`) y componerlo desde `src/**` (`src/commands/context.mjs`) en spec, implement y review; verify: `node --test test/context.test.mjs` (`test/**`) (CR3, CR16, CR20) — 2026-06-30T10:16:37Z
- [x] Restaurar detalle específico de review y cierre en `templates/**` (`review.md`, `close.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR6, CR17, CR18) — 2026-06-30T10:16:37Z
- [x] Completar actores/discard en `templates/**` (`core.md`, overlays) sin exceder presupuesto; verify: `node --test test/context.test.mjs` (`test/**`) (CR7, CR9, CR19, CR20) — 2026-06-30T10:16:37Z
- [x] Ejecutar el gate completo y comprobar que no reaparece el modelo de symlink; verify: `pnpm verify` (support) — 2026-06-30T10:16:37Z
- [x] Compartir triage de handoff y completar los tres orígenes de bloqueo en `templates/**` (`handoff.md`, `blocked.md`) y `src/**` (`context.mjs`); verify: `node --test test/context.test.mjs` (`test/**`) (CR10, CR11, CR19, CR20) — 2026-06-30T10:24:39Z
- [x] Restaurar separación de concerns y crecimiento de alcance en autoría dentro de `templates/**` (`spec.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR10, CR11, CR12, CR20) — 2026-06-30T10:24:39Z
- [x] Precisar el handoff JSON de release y la semántica literal de graduación en `templates/**` (`release.md`, `close.md`); verify: `node --test test/context.test.mjs` (`test/**`) (CR10, CR11, CR18, CR20) — 2026-06-30T10:24:39Z
- [x] Blindar los outputs de `templates/**` ampliando la matriz operacional de `test/**` (`context.test.mjs`) y ejecutar el gate completo; verify: `pnpm verify` (CR10, CR11, CR20) — 2026-06-30T10:24:39Z
- [x] Materializar en `test/**` (`context.test.mjs`) la matriz exhaustiva de subbloques y exclusividad de todos los packs de `templates/**`; verify: `node --test test/context.test.mjs` (CR10, CR11, CR20) — 2026-06-30T10:31:22Z
- [x] Cerrar en `test/**` (`context.test.mjs`) toda eliminación silenciosa mediante snapshots normalizados y nombrados de cada fragmento de `templates/**`; verify: mutation test + `node --test test/context.test.mjs` (CR10, CR11, CR20) — 2026-06-30T10:35:39Z
- [x] Componer el triage compartido de `templates/**` (`handoff.md`) también en review desde `src/**` (`context.mjs`) y fijar su ownership en `test/**`; verify: `node --test test/context.test.mjs` (CR10, CR11, CR17, CR20) — 2026-06-30T10:44:06Z

## Log

- **2026-06-29T23:49:39Z** — Draft creado tras autorización humana para rescatar los invariantes importantes sin restaurar el monolito.
- **2026-06-29T23:54:08Z** — status: draft → approved
- **2026-06-29T23:55:36Z** — status: approved → in-progress
- **2026-06-29T23:55:36Z** — owner → Roberto Ruiz (auto)
- **2026-06-29T23:57:50Z** — Implementación completada: matriz de invariantes en verde; pnpm verify pasa con 470 tests y 141 changes válidos; core 100 líneas / 4860 bytes.
- **2026-06-29T23:57:55Z** — status: in-progress → in-review
- **2026-06-30T00:00:58Z** — review → in-progress (retry): CR9 mantiene delegación duplicada en review.md y CR10 no prueba ownership exclusivo, aislamiento completo de correcciones ni implement+readiness tras reentrada.
- **2026-06-30T00:02:37Z** — Corrección de review: delegación transversal queda solo en core; matriz ampliada para ownership exclusivo, aislamiento completo de correcciones y reentrada implement+readiness desde blocked, validation y review.
- **2026-06-30T00:02:37Z** — status: in-progress → in-review
- **2026-06-30T00:04:24Z** — review → in-progress (retry): CR9 aún duplica model sizing entre core.md y review.md; la matriz de ownership no detecta esa duplicación.
- **2026-06-30T00:05:02Z** — Segunda corrección de review: model sizing eliminado de review y añadido al test de ownership exclusivo de delegación.
- **2026-06-30T00:05:02Z** — status: in-progress → in-review
- **2026-06-30T00:06:38Z** — review → in-progress (retry): CR9/CR10 verifican ownership solo en seis outputs y omiten release, close y discarded; debe cubrir todos los fragmentos fuente.
- **2026-06-30T00:07:36Z** — Tercera corrección de review: ownership de delegación ahora se verifica escaneando todos los fragmentos de templates/contract, incluidos release, close y discarded.
- **2026-06-30T00:07:37Z** — status: in-progress → in-review
- **2026-06-30T00:09:34Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-30T10:04:52Z** — validation → in-progress (human rejected): El objetivo era segmentar, organizar y eliminar ambigüedades o redundancias sin perder la precisión operativa ni nada importante del contrato antiguo. La restauración actual sigue siendo incompleta y demasiado resumida.
- **2026-06-30T10:16:51Z** — Segunda implementación tras rechazo humano: baseline completo reclasificado; packs spec/readiness/implement/review/close ampliados; delegation compartido; outputs conservan comandos, ejemplos, antipatrones y reasoning operativo. pnpm verify pasa con 471 tests y 141 changes válidos; core 102 líneas / 5056 bytes.
- **2026-06-30T10:16:51Z** — status: in-progress → in-review
- **2026-06-30T10:20:13Z** — review → in-progress (retry): Paridad incompleta: matriz CR10 parcial; spec no separa concerns; blocked no compone triage ni cubre impedimento externo/review escalation; release omite JSON handoff; close omite marcador graduado a spec y origen Specification/Proposal.
- **2026-06-30T10:24:51Z** — Corrección exhaustiva: matriz CR10 ampliada; separación de concerns restaurada en spec; triage compartido por implement/blocked; bloqueo cubre tarea, impedimento externo y escalación de review; release JSON y graduación precisados literalmente.
- **2026-06-30T10:25:14Z** — status: in-progress → in-review
- **2026-06-30T10:28:58Z** — review → in-progress (retry): CR10/CR11 incompletos: la matriz no ancla todos los subbloques operativos, omite outputs validation/discarded y no verifica ausencia de packs ajenos por modo.
- **2026-06-30T10:31:29Z** — Segunda corrección exhaustiva: matriz ampliada a todos los subbloques operativos y a los nueve packs; validation/discarded incluidos; cada modo prueba sus fragmentos propietarios y rechaza packs ajenos. pnpm verify: 471 tests y 141 changes válidos.
- **2026-06-30T10:31:46Z** — status: in-progress → in-review
- **2026-06-30T10:34:29Z** — review → in-progress (retry): CR10/CR11: mutation testing eliminó write for the rendered view y never invent missing requirements sin hacer fallar context.test; falta protección completa contra eliminación silenciosa.
- **2026-06-30T10:35:44Z** — Cierre de CR10/CR11: snapshots SHA-256 normalizados y nombrados cubren el inventario completo de fragmentos; cualquier eliminación o alteración silenciosa falla indicando el pack que debe reclasificarse. Matriz semántica legible permanece como diagnóstico fino. pnpm verify: 472 tests y 141 changes válidos.
- **2026-06-30T10:36:01Z** — status: in-progress → in-review
- **2026-06-30T10:39:03Z** — review → in-progress (retry): CR11: spec conserva slug inglés pero omitió la restricción kebab ASCII del baseline; el snapshot congeló esa pérdida sin justificarla.
- **2026-06-30T10:40:25Z** — El reviewer retiró el último FAIL: ni el baseline en ef62393 ni .tmp/OLD_AGENTS.md contienen kebab/ASCII; solo exigen slug inglés y explícito, ya cubierto. Relectura completa no halló otra omisión.
- **2026-06-30T10:40:40Z** — status: in-progress → in-review
- **2026-06-30T10:43:20Z** — review → in-progress (retry): CR11/CR20: review no compone Handoff Triage aunque el baseline exige clasificar fricción antes de entregar al humano un resultado completado o bloqueado.
- **2026-06-30T10:44:12Z** — Triage de handoff compuesto también en review: el reviewer que entrega un resultado completado recibe la misma clasificación de fricción que implement y blocked; matriz de packs actualizada. pnpm verify: 472 tests, 141 changes válidos.
- **2026-06-30T10:44:44Z** — status: in-progress → in-review
- **2026-06-30T10:48:03Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-30T15:26:26Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-30T15:28:42Z** — validation → done (human accepted)
- **2026-06-30T15:35:02Z** — graduado a spec `contract-discovery.md`
- **2026-06-30T15:35:24Z** — archived
