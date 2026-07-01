---
id: "20260630-225213"
title: Optimizar señal y política efectiva del contexto dinámico
type: feature
status: done
created: 2026-06-30T22:52:13Z
depends_on: [ "20260701-213931" ]
owner: raruiz-hiberuscom
reviewed: true
---

## Request

Optimizar el contexto dinámico para guiar con más precisión y menos ruido a los
agentes después de que el bootstrap obligatorio haya cargado el core.

Se conserva como invariante el flujo de discovery: un agente de otro proyecto no
conoce ChangeLedger hasta leer el bloque administrado de `AGENTS.md`; ese bloque
le exige ejecutar directamente `changeledger context` y leer el core completo.
Solo después usa `context <modo>` o `context <id>`. Por tanto, este change no hace
autocontenidos los packs incrementales ni introduce `--full`/`--incremental`.

## Investigation

La selección por lifecycle es sólida: todos los estados están mapeados, el modo
por id adjunta el change completo, los fragmentos son deterministas y los tests
rechazan packs ajenos. El core tiene presupuesto de 120 líneas/8192 bytes.

La señal posterior puede mejorar:

- solo el core tiene presupuesto; `spec` compone aproximadamente 259 líneas,
  `implement` 188 y `review` 108 antes de adjuntar un change;
- `review` dedica más de la mitad de su pack a delegación/handoff aunque el
  receptor ya es el reviewer independiente;
- `implement` vuelve a incluir toda la explicación de configuración de readiness,
  aun cuando el change aprobado ya debería haber pasado el gate;
- los packs hablan de `language`, `tdd`, stages, `review_required` y patrones
  configurables, pero no muestran la política efectiva del repositorio/change;
- ante esa ausencia los agentes leen `.changeledger/config.yml` crudo (`cat`),
  cargando comentarios y claves irrelevantes, y deben inferir los defaults de
  las claves ausentes; el core agrava el patrón al decir "narrative content
  follows `.changeledger/config.yml`" sin exponer el idioma efectivo;
- un `depends_on` queda como id crudo: no hay resumen local de título/status ni
  orientación exacta para inspeccionarlo;
- snapshots completos evitan pérdidas, pero no establecen presupuestos ni
  protegen la relación señal/ruido de cada composición;
- claridad del core para modelos diversos: el título "Non-negotiable fast path"
  no describe su contenido (anti-truncado + columna vertebral del workflow);
  varias reglas usan frases compuestas largas que modelos menos capaces parsean
  mal; y la escalada a modos queda implícita en la lista de "Context modes" en
  lugar de una instrucción imperativa (antes de documentar → `context spec`,
  antes de ejecutar → `context implement` o `context <id>`).

## Proposal

Mantener el compilador incremental y derivar una cabecera breve de **Effective
policy** desde `.changeledger/config.yml`. En modo por id incluir como mínimo
idioma, `tdd`, tipo, stages activos, `review_required` e impactos/patrones solo
cuando afecten la tarea. Para dependencias locales, mostrar id, título y status
sin copiar documentos; las dependencias externas permanecen referencias.

El core expone la política transversal mínima (idioma efectivo y `tdd`) en una
línea, resolviendo defaults, y sustituye la remisión genérica al archivo por la
indicación de que la política efectiva la entrega cada contexto: leer
`.changeledger/config.yml` crudo deja de ser necesario para operar.

Clarificar el core sin cambiar reglas: renombrar "Non-negotiable fast path" a un
título literal, convertir la escalada a modos en instrucción imperativa y
reescribir en frases cortas las reglas de oración compuesta larga. Ediciones
editoriales sujetas a la clasificación semántica de CR7: ninguna regla se
pierde ni cambia de significado.

Reducir packs transversales por audiencia sin perder invariantes: el reviewer
recibe independencia, superficie de revisión y handoff necesario, no una guía
general para volver a delegar; implementación recibe la regla TDD efectiva y
los checks accionables, no toda la explicación de autoría. La fuente sigue
fragmentada por una sola responsabilidad.

Definir presupuestos por composición base —excluyendo el change seleccionado,
cuya longitud pertenece al trabajo— y tests semánticos de actionability. Los
hashes continúan detectando cambios no clasificados, pero no sustituyen la
evaluación de redundancia.

## Specification

### CR1 — El bootstrap base-first permanece intacto
- **Given** un repositorio consumidor inicializado
- **When** un agente descubre ChangeLedger mediante `AGENTS.md`
- **Then** debe ejecutar primero `changeledger context` directamente y leer el core completo
- **And** los modos e ids siguen siendo incrementales y no repiten el core

### CR2 — Cada contexto muestra política efectiva mínima
- **Given** una configuración con idioma, `tdd`, tipos, stages, review y readiness propios
- **When** se genera un contexto explícito o por change id
- **Then** incluye un resumen determinista únicamente de los valores que afectan esa tarea
- **And** no obliga al agente a inferir defaults que el repositorio sobrescribió

### CR3 — Context por id resuelve dependencias sin inflar documentos
- **Given** un change con dependencias locales y externas
- **When** se ejecuta `changeledger context <id>`
- **Then** cada dependencia local muestra id, título y status actuales
- **And** no incorpora el cuerpo completo de la dependencia
- **And** las referencias externas se conservan sin fingir resolución local

### CR4 — Review prioriza evidencia de revisión
- **Given** `changeledger context review` o un change `in-review`
- **When** se compone el pack
- **Then** prioriza CRs, Plan, tests, diff, residuos, herramientas y verdicts
- **And** no repite la guía general de delegación que el reviewer no necesita para cumplir su misión
- **And** conserva el triage de fricción necesario al entregar el resultado

### CR5 — Implement conserva actionability con menos repetición
- **Given** `changeledger context implement` o un change aprobado/en progreso
- **When** se compone el pack
- **Then** conserva scope, Git, tareas, TDD efectivo, correcciones y handoff
- **And** evita repetir detalle de autoría/configuración que no cambia la ejecución

### CR6 — Todas las composiciones tienen presupuesto explícito
- **Given** core, modos y overlays sin change seleccionado
- **When** se ejecutan los tests de contexto
- **Then** cada composición cumple límites revisados de líneas y bytes
- **And** el presupuesto excluye únicamente el texto del change seleccionado

### CR7 — Las protecciones prueban semántica y señal
- **Given** fragmentos contractuales versionados
- **When** se añade, mueve o elimina una regla
- **Then** los tests exigen clasificar su ownership y preservación semántica
- **And** detectan packs ajenos, duplicación transversal y crecimiento fuera de presupuesto
- **And** los snapshots no convierten por sí solos el texto existente en diseño óptimo

### CR8 — El core expone la política transversal sin leer config crudo
- **Given** una configuración con idioma y `tdd` distintos de los defaults
- **When** se ejecuta `changeledger context`
- **Then** el core muestra en una línea el idioma efectivo y el valor efectivo de `tdd`, con defaults ya resueltos
- **And** el core indica que cada contexto entrega la política efectiva aplicable, en lugar de remitir a `.changeledger/config.yml`
- **And** el core delimitado permanece dentro de su presupuesto

## Plan

- [x] Diseñar en `src/commands/context.mjs` una cabecera de política efectiva y resumen de dependencias reutilizando config/modelo de repo; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-07-01T22:43:51Z
- [x] Derivar en `src/commands/context.mjs` la línea de política transversal del core y ajustar `templates/contract/core.md` para dejar de remitir al config crudo; verify: `node --test test/context.test.mjs` (CR8) — 2026-07-01T22:43:51Z
- [x] Reorganizar `templates/contract/**` para adelgazar review e implement sin perder reglas propietarias; verify: `node --test test/context.test.mjs` (CR4, CR5, CR7) — 2026-07-01T22:43:51Z
- [x] Clarificar `templates/contract/core.md`: título literal para el fast path, escalada imperativa a modos y frases cortas, preservando semántica; verify: `node --test test/context.test.mjs` (CR7) — 2026-07-01T22:43:51Z
- [x] Definir en `src/commands/context.mjs` y `test/context.test.mjs` presupuestos por modo/overlay separados del change adjunto; verify: `node --test test/context.test.mjs` (CR6, CR7) — 2026-07-01T22:43:51Z
- [x] Actualizar `templates/contract/**` y `test/context.test.mjs` con clasificación explícita de cada regla preservada, movida o retirada; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7) — 2026-07-01T22:43:51Z
- [x] Graduar la arquitectura de `src/commands/context.mjs` y ejecutar el gate completo; verify: `pnpm test` (CR1, CR2, CR3, CR4, CR5, CR6, CR7) — 2026-07-01T23:22:20Z

## Log

- **2026-06-30T22:52:13Z** — Draft creado tras corregir la hipótesis de entrada directa: el bootstrap obliga a cargar el core antes de cualquier modo o id; la optimización se limita a señal posterior y política efectiva.
- **2026-07-01T21:40:28Z** — Añadida dependencia de `#20260701-213931` (capa de entrega: trigger del bootstrap y delimitadores BEGIN/END). Los presupuestos de CR6 deben medirse con los delimitadores ya presentes en la salida.
- **2026-07-01T21:47:48Z** — Ampliado con CR8: el humano reporta que los agentes hacen `cat .changeledger/config.yml` (comentarios y ruido incluidos) para descubrir idioma/`tdd`. El core expondrá la política transversal en una línea y dejará de remitir al archivo crudo; los modos/ids ya la cubrían vía CR2.
- **2026-07-01T21:50:24Z** — Incorporados hallazgos de claridad del core de la evaluación externa: título "Non-negotiable fast path" no literal, frases compuestas densas y escalada a modos implícita. Ediciones editoriales bajo la clasificación semántica de CR7, sin CR nuevo.
- **2026-07-01T21:51:40Z** — status: draft → approved
- **2026-07-01T22:34:08Z** — status: approved → in-progress
- **2026-07-01T22:34:08Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T22:43:07Z** — Presupuestos base elegidos (sin change adjunto): core 120L/8192B, spec 285L/11800B, implement 170L/7300B, review 75L/3200B, release 45L/2200B; overlays blocked 70L/3000B, in-validation 45L/1700B, done 90L/3500B, discarded 40L/1300B. Medidos con delimitadores presentes.
- **2026-07-01T22:43:16Z** — Diseño: cabecera Effective policy derivada de config con defaults resueltos (language=en, tdd=true). Core: linea transversal (language+tdd). Modos: language+tdd. Id: anade review_required(type) y stages(type), mas resumen de dependencias locales (id/titulo/status); refs externas project:id quedan como referencia. Review pack pierde delegation.md (MODE_CONTEXT), conserva review+handoff. Implement pack pierde readiness.md (autoria); la regla TDD efectiva viaja en la cabecera + regla failing-test de implement.md. core.md: titulo literal, escalada imperativa a modos, fin de remision a config crudo (CR7 replaced, semantica preservada).
- **2026-07-01T22:44:10Z** — Tareas 1-6 done. Tarea 7 mezcla dos pasos: (a) ejecutar el gate completo -> hecho, pnpm verify verde (513 tests, lint, check); (b) graduar la arquitectura -> paso post-aceptacion, se difiere al graduate tras done. Se deja la tarea abierta hasta la graduacion; check valida OK.
- **2026-07-01T22:44:31Z** — status: in-progress → in-review
- **2026-07-01T22:48:10Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-01T23:18:02Z** — validation → done (human accepted)
- **2026-07-01T23:22:20Z** — graduado a spec `contract-discovery.md`
