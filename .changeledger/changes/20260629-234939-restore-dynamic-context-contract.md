---
id: "20260629-234939"
title: Restaurar invariantes del contrato en el contexto dinámico
type: feature
status: in-review
created: 2026-06-29T23:49:39Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
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

## Proposal

Restaurar una versión concisa de cada invariante, con un único fragmento dueño:

1. `core.md` conserva reglas transversales: los archivos son la verdad y los
   helpers CLI son opcionales; delegar es decisión del agente cuando existe una
   frontera y beneficio claros; no se sobre-fragmenta ni se solapan superficies
   de escritura sin integración explícita; el prompt delegado fija ownership,
   resultado e integración y prohíbe revertir trabajo ajeno; el modelo se
   dimensiona al riesgo y dificultad.
2. `spec.md` recupera reglas de autoría: una verdad vive en un stage y se enlaza
   desde los demás; Investigation documenta root cause para bugs y constituye el
   análisis central para audits; Proposal incluye alternativas descartadas y
   escenarios; Mermaid se usa cuando comunica relaciones o flujos mejor que
   prosa.
3. `implement.md` concreta el worktree sucio: detenerse y pedir al humano decidir
   entre stash, commit, ignorar o incluir antes de mezclar cambios ajenos. También
   completa la corrección tras rechazo humano: mantenerla aislada hasta
   confirmación y, al aceptar, graduar/skip y commitear corrección + ledger.
4. `review.md` conserva la independencia y aclara que SAST, seguridad profunda y
   lint pertenecen a herramientas dedicadas; el reviewer puede ejecutarlas y
   registrar evidencia, pero ChangeLedger no las reimplementa.
5. `blocked.md`, `validation.md` y `review.md` ordenan ejecutar de nuevo
   `changeledger context <id>` inmediatamente después de una transición que vuelva
   a `in-progress`, antes de modificar implementación.

Mantener el presupuesto actual del core (máximo 120 líneas y 8192 bytes) y no
reintroducir explicaciones históricas, detalles de UI ni catálogos de comandos
que pueden descubrirse mediante `changeledger help`.

Añadir en `test/context.test.mjs` una matriz pequeña de invariantes rescatados:
cada entrada identifica el output (`core`, modo o lifecycle), una expresión
semántica estable y la conducta protegida. La matriz es una barrera de regresión,
no un segundo contrato textual ni un snapshot de redacción completa.

Alternativas descartadas:

- Restaurar `templates/AGENTS.md`: recupera contenido pero elimina el beneficio
  del contexto dinámico y crea otra fuente susceptible de divergir.
- Copiar todo el baseline a los fragmentos: conserva explicaciones y detalles ya
  obsoletos, aumenta tokens y contradice el alcance “justo y necesario”.
- Confiar solo en revisión manual: permitió la pérdida original y no evita
  regresiones futuras.

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
- **And** ningún fragmento duplica literalmente una regla cuyo dueño está en otro fragmento

### CR10 — Matriz de invariantes impide otra pérdida silenciosa
- **Given** la matriz de invariantes contractuales en `test/context.test.mjs`
- **When** se elimina o mueve una regla rescatada fuera del output que la necesita
- **Then** `node --test test/context.test.mjs` falla identificando la conducta ausente y el contexto esperado

## Plan

- [x] Restaurar en `templates/**` (`templates/contract/core.md`) la frontera archivos/CLI y la disciplina transversal de delegación; verify: `node --test test/context.test.mjs` (`test/**`) (CR3, CR8, CR9) — 2026-06-29T23:57:14Z
- [x] Restaurar en `templates/**` (`templates/contract/spec.md`) fuente única entre stages, semántica de bug/audit/Proposal y criterio Mermaid; verify: `node --test test/context.test.mjs` (`test/**`) (CR1, CR2, CR9) — 2026-06-29T23:57:14Z
- [x] Completar en `templates/**` (`templates/contract/implement.md`) el manejo del worktree ajeno y cierre de correcciones rechazadas; verify: `node --test test/context.test.mjs` (`test/**`) (CR4, CR5, CR9) — 2026-06-29T23:57:14Z
- [x] Completar en `templates/**` (`templates/contract/review.md`, `blocked.md` y `validation.md`) el límite de herramientas y la recarga tras volver a `in-progress`; verify: `node --test test/context.test.mjs` (`test/**`) (CR6, CR7, CR9) — 2026-06-29T23:57:14Z
- [x] Blindar los outputs de `templates/**` con la matriz de invariantes y casos por modo/lifecycle en `test/**` (`test/context.test.mjs`), conservando determinismo y presupuesto; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8, CR9, CR10) — 2026-06-29T23:57:14Z
- [x] Ejecutar el gate completo del repositorio; verify: `pnpm verify` (support) — 2026-06-29T23:57:50Z

## Log

- **2026-06-29T23:49:39Z** — Draft creado tras autorización humana para rescatar los invariantes importantes sin restaurar el monolito.
- **2026-06-29T23:54:08Z** — status: draft → approved
- **2026-06-29T23:55:36Z** — status: approved → in-progress
- **2026-06-29T23:55:36Z** — owner → Roberto Ruiz (auto)
- **2026-06-29T23:57:50Z** — Implementación completada: matriz de invariantes en verde; pnpm verify pasa con 470 tests y 141 changes válidos; core 100 líneas / 4860 bytes.
- **2026-06-29T23:57:55Z** — status: in-progress → in-review
