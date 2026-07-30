---
id: "20260730-002730"
title: Los guards de frase se retiran de todos los .md
type: refactor
status: in-review
created: 2026-07-30T00:27:30Z
depends_on: []
related_to: ["20260729-143656", "20260729-162015"]
owner: raruiz-hiberuscom
---

## Request

Decisión de Roberto (2026-07-29, acta §16.1): los guards de obligación a
**nivel de frase** sobre los `.md` se retiran — para todos los `.md` del repo,
que hoy significa `templates/contract/` porque specs, docs y README no tienen
tests. El coste medido por edición de prosa es la mala experiencia que motiva
la decisión: cada reescritura paga retarget de pins exactos, evidencia por
mutante y escrutinio en review. Se quedan: **presupuestos**, **composición
estructural** (fragmentos, headings propios, sentinelas), **barridos de frases
retiradas** (el mecanismo de [#20260729-143656]) y una **docena curada de
guards a nivel de concepto** con regex tolerante a redacción, que cazan la
pérdida de una regla portadora sin fijar su fraseo. Cazar una reformulación
que debilite sin borrar pasa al review del change que toque la prosa.

Fuera de alcance, explícito: los pins del bloque bootstrap publicado
(`AGENTS.md` / `REFERENCE` en `test/contract.test.mjs`) — pinnean una interfaz
publicada a repos consumidores, no prosa interna; y la prosa de los propios
tests (eso lo gobierna la regla de prosa de CH-5a).

## Proposal

**Inventario medido (investigación fresca contra HEAD, cota inferior
verificada a mano + estimación heurística para el resto):**
`test/cli.test.mjs` concentra sus aserciones de prosa del contrato en 7 tests
sobre `contractText()` — 60 asserts: 46 de frase, 9 estructurales, 3 barridos,
2 de concepto. `test/context.test.mjs` tiene ~90 asserts de frase directos más
49 bucles sobre arrays, incluidos los dos mega-arrays: `234939 CR11-CR20` (129
entradas frase-a-pack) y `234939 CR1-CR10` (22 invariantes + listas
kept/moved/seat de `delegation.md`). `test/agent-context.test.mjs` y
`test/agent-prompt.test.mjs` suman ~17 de frase sobre las cápsulas.

**Se retiran** (tests nombrados; la lista completa vive en el inventario y se
verifica al implementar): los dos mega-arrays de `234939`; `162015 CR5` (las 8
cláusulas del contrato de evidencia pinneadas verbatim en dos packs);
`124835 CR11`; `134703 CR1/CR2/CR3`; `141122 CR6`; `105456 CR8 correction`;
`220014 CR1/CR4`; los pins de frase de `020229 CR4`, `122611 CR3` y
`203257 CR7`; el pin de frase-en-sede-única de `194234 CR4`; y todo assert de
frase restante sobre fragmentos servidos, en las cuatro suites.

**Se quedan intactos**: todos los presupuestos (`assertWithinBudget` y los
pins de valor de `195445`/`212043`); el inventario de fragmentos y el barrido
recursivo de frases retiradas (`143656 CR4`); el check estructural
`ownedHeadings` (cada pack contiene su heading y excluye los ajenos — es
anti-duplicación por construcción, sin fijar prosa); los 3 barridos de
`cli.test.mjs`; la fila de la matriz de activación contra `config.yml`
(`141119 CR5` — consistencia entre artefactos, no fraseo); y los sentinelas.

**La docena curada** (una entrada por obligación portadora, regex tolerante:
palabras clave y alternancias, nunca la oración literal):

1. clasificar la intención antes de actuar (core)
2. ningún artefacto sin autorización humana / nunca implementar un draft (core)
3. el veredicto humano se transmite, nunca se infiere (core)
4. un change a la vez en rama no-main (core)
5. el gate del draft: `approve` juzga con severidad de `approved` (readiness)
6. la unidad de commit es la selección resuelta; baseline exactamente uno (core)
7. las transiciones humanas del lifecycle son del humano (core)
8. el gate local corre antes de `in-review`; el revisor es fresco, de contexto
   limpio y solo lee (implement/review)
9. la corrección queda sin commitear hasta confirmación fresca (implement)
10. la regla de sede única en sus dos direcciones (core)
11. el contrato de evidencia llega a spec e implement como sección presente —
    no las 8 cláusulas verbatim (delegation)
12. la gramática de tags del Plan: los cuatro hijos enseñados (spec)

Cada entrada exige doble evidencia al implementar: el mutante que **borra** la
regla de su fragmento pone el guard en rojo (es portadora), y una
**reformulación** que conserva la obligación lo deja en verde (es tolerante).

**Alternativas descartadas.** (a) Retirarlo todo, sin docena curada: reabre la
clase del hallazgo 38 (prosa normativa perdida en silencio), que se fugó tres
veces sin mecanismo y cuyo exploit se probó en vivo. (b) Un meta-guard que
prohíba literales largos en los tests: la ceremonia renacería como guard del
guard, clase del hallazgo 43. (c) Mantener los mega-arrays "porque ya están
escritos": son el coste, no el activo — cada edición de prosa los paga.

**La regla se hace durable en `AGENTS.md`** (petición de Roberto al aprobar):
las notas del proyecto declaran el perímetro de tests sobre prosa del contrato
— presupuestos, composición estructural, barridos de frases retiradas y el set
curado de conceptos, nunca pins de oraciones literales — de modo que un pin
nuevo se rechaza en review con regla citable en vez de re-litigarse. Es la
salida (b) sin su coste: prosa normativa con verificador humano, no guard del
guard.

## Specification

Interfaces externas: ninguna. Superficie enteramente en `test/**` — requiere
`test/**` en `readiness.target_patterns` (edición de config previa, quick
autorizado aparte) para que este documento sea aprobable.

### CR1 — Los tests de frase nombrados dejan de existir
- **Given** la suite tras el change
- **When** se listan los títulos de test de las cuatro suites afectadas
- **Then** los tests nombrados en la Proposal como retirados ya no existen por
  título — en particular `234939 CR11-CR20`, `234939 CR1-CR10`, `162015 CR5`,
  `124835 CR11`, `134703 CR1/CR2/CR3` y `141122 CR6` — y ningún assert de las
  cuatro suites casa una oración literal de más de cinco palabras de un
  fragmento de `templates/contract/`, verificado por barrido manual registrado
  en el Log con método y límite

### CR2 — La docena curada es portadora y tolerante, entrada a entrada
- **Given** cada una de las doce entradas del guard curado
- **When** se borra la regla de su fragmento (mutante) y, por separado, se
  reformula conservando la obligación
- **Then** el borrado pone la entrada en rojo con su mensaje nombrando la
  obligación perdida, y la reformulación la deja en verde — ambas evidencias
  literales por entrada, una a una, nunca agrupadas

### CR3 — Presupuestos, estructura y barridos quedan intactos
- **Given** los mecanismos que la decisión conserva
- **When** corre la suite completa tras el retiro
- **Then** los tests de presupuesto (`195445 CR1/CR2`, `212043 CR1/CR7`,
  `225213 CR6` y los `assertWithinBudget` de packs), el inventario y barrido
  recursivo de `143656 CR4`, el check `ownedHeadings`, los 3 barridos de
  `cli.test.mjs` y `141119 CR5` pasan sin ninguna edición

### CR4 — El coste de editar prosa baja de verdad
- **Given** una reformulación de una oración normativa de `spec.md` que
  conserva la obligación (fixture del mismo texto reescrito)
- **When** corre la suite completa contra el árbol con esa reformulación
- **Then** solo pueden fallar presupuestos si el tamaño excede — ningún test
  de prosa falla; hoy, medido: la misma edición rompe pins de frase en
  `context.test.mjs` y obliga a retargetearlos

### CR5 — El perímetro de guards queda declarado en el contrato del repo
- **Given** `AGENTS.md` tras el change
- **When** se lee su sección de notas del proyecto
- **Then** declara que los tests sobre `templates/contract/` se limitan a
  presupuestos, composición estructural, barridos de frases retiradas y el set
  curado de conceptos, y que un pin de oración literal nueva se rechaza en
  review — verificación por grep registrada en el Log, sin test permanente que
  fije su redacción (sería el pin que la propia regla prohíbe)

## Plan

- [x] Retirar los tests y asserts de frase nombrados en las cuatro suites, dejando intactos presupuestos, estructura y barridos
  - **Target:** `test/context.test.mjs`, `test/cli.test.mjs`, `test/agent-context.test.mjs`, `test/agent-prompt.test.mjs`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs test/agent-context.test.mjs test/agent-prompt.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-07-30T10:27:50Z`
- [x] Escribir el guard curado de doce entradas con su doble evidencia por entrada
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T10:27:50Z`
- [x] Demostrar el coste nuevo con la reformulación de control y registrar el barrido de literales largos
  - **Target:** `test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR4
  - **Resolved:** `2026-07-30T10:27:50Z`
- [x] Declarar el perímetro de tests sobre prosa del contrato en las notas de proyecto de `AGENTS.md`
  - **Target:** `AGENTS.md`
  - **Verify:** verify: grep de la regla sobre `AGENTS.md` registrado en el Log
  - **Criteria:** CR5
  - **Resolved:** `2026-07-30T10:27:50Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo
  - **Resolved:** `2026-07-30T10:27:50Z`

## Log
- **2026-07-30T09:46:33Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T09:48:29Z** `[status]` approved → in-progress
- **2026-07-30T10:28:18Z** `[note]` Selección única resuelta: −622 líneas netas en context.test (3381→2759), −73 en cli.test, +5/+5 tolerantes en las suites de cápsulas, +8 en AGENTS.md. Evidencia: reproduce-first en baseline (reformulación de spec.md rompe el pin 234939 con rojo literal); 18 guards tolerantes — los 12 curados más los 6 del gate de redacción de 185200 CR5, convertidos en vez de borrados — con doble evidencia por entrada (36 mutaciones de una en una: borrado rojo nombrando la obligación, reformulación verde); demo CR4: la misma reformulación pasa la suite entera en el árbol retirado (1004/1004) donde en baseline rompía un pin nombrado. Barrido de literales (método: extractor de literales de las cuatro suites, ventanas de exactamente 6 palabras contra el stream de palabras de cada fragmento, tablas markdown excluidas y contadas aparte): baseline 353 hits / 326 literales → 0.
- **2026-07-30T10:28:19Z** `[note]` Correcciones a cifras del draft, medidas por el implementador: el desglose de los 60 asserts de cli.test pliega los 3 barridos (60 match + 3 doesNotMatch, no 46+9+3+2 exactos); los ~17 de cápsulas son 10 al umbral de 6 palabras; los ~90 directos de context.test no eran recontables como se enunciaron (192 match + 72 doesNotMatch en baseline → 123 + 64). Y la premisa del Request era FALSA: las specs sí tenían un test — 111349 CR6 pinneaba oraciones en español de git-traceability.md; mi investigación lo pasó por alto. Resuelto dentro del alcance decidido (todos los .md): sus 8 pins de presencia retirados con reproduce-first, sus barridos de ausencia conservados y probados no-vacuos con mutante de regresión, retitulado. Además evita la colisión con 20260730-002341, que reescribe esas mismas oraciones en su graduación.
- **2026-07-30T10:28:19Z** `[note]` Decisiones no especificadas del implementador, para el review: (1) los 6 guards de 185200 CR5 convertidos a tolerantes en vez de borrados — no estaban ni en la lista de retiro ni en la de conservación, borrarlos destruía un mecanismo de un día; son 18 tolerantes, no 12; (2) 134703 y 124835 CR10 conservan título recortados — CR1 solo exige la desaparición de seis títulos; (3) anclas de orden convertidas a búsqueda tolerante en vez de borradas; (4) un solape ≥6 palabras deliberado con la spec de git: el literal de ausencia conserva prefijo y sufijo para distinguir enunciar-como-regla de citar-como-retirada. Residuos nombrados: la lista de obligaciones que pasan a descansar solo en review (rama de integración, las siete del pack release, mitad positiva de divergencias, elegibilidad quick, clasificación de relaciones, mecánica de commits, test de granularidad, forma combinada, deber de porqué en handoff, ventana de sucio esperado, redacción individual de las 8 cláusulas de evidencia) — es el trade aceptado de la decisión §16.1.
- **2026-07-30T10:28:19Z** `[note]` Mandato de review, registrado antes de delegar: auditoría del rango sobre la rama principal por revisor fresco top-tier. Puntos de escrutinio: (1) que ningún assert de presupuesto, estructura o barrido se haya perdido en el retiro — CR3 los enumera y el diff es grande (−622); (2) las 4 decisiones no especificadas; (3) la tolerancia real de los 18 guards (muestrear reformulaciones adversariales: ¿una reformulación que DEBILITA la obligación sigue verde? — eso es lo aceptado, confirmar que no hay caso peor: una que la elimina de facto y quede verde); (4) el barrido de 6 palabras y sus exclusiones (tablas); (5) la regla de AGENTS.md contra el CR5; (6) las notas de este Log al estándar del implementador.
- **2026-07-30T10:28:19Z** `[status]` in-progress → in-review
