---
id: "20261007-135159"
title: Cerrar en una ronda las correcciones de prosa
type: feature
status: in-progress
created: 2026-10-07T13:51:59Z
depends_on: []
branch: feature/20261007-135159
related_to: ["20260730-165310", "20261002-133728", "20261002-140038"]
owner: rarc88
---

## Request

Las rondas de revisión se van sobre todo en prosa. En `20261002-133728`, las
rondas 3 a 6 fallaron sólo por frases de `docs/usage-capture.md`. En
`20261002-140038`, `changeledger analyze` atribuye un 24 % de los tokens del
change a `rework`, y las rondas 2 y 3 fallaron por afirmaciones de docs y
comentarios que un caso desmentía. En la ronda 3 de ese change, la corrección
de un comentario volvió a afirmar más de lo que el test cubría. Se pide ajustar el
contrato para que una corrección de prosa cierre el hallazgo en una ronda, y
medir el efecto con `changeledger analyze`.

Queda fuera de este change relajar la regla del revisor sobre cuantificadores
universales o cambiar el límite de rondas.

## Investigation

`templates/contract/implement.md` obliga a todo implementador o corrector:
«Deliverable prose — test comments and Log notes — that quantifies universally
(…) has the edge that would falsify it executed before it is written, or is
narrowed to the incident actually observed». La lista nombra comentarios de
test y notas del Log, pero no la documentación ni los comentarios de código,
que es donde fallaron las rondas observadas. `templates/contract/review.md`
hace fallar la revisión por un cuantificador universal en prosa entregable
cuyo borde no se ejecutó, y limita la confirmación al defecto nombrado o a una
regresión de la corrección. Ningún fragmento dice qué debe hacer una
corrección de prosa, y el corrector suele reescribir la frase con otra
afirmación, que el revisor siguiente vuelve a desmentir. Los paquetes de
`templates/contract/agent-contexts/` y `agent-prompts/` no contienen estas
reglas. Presupuestos en `templates/contract/budgets.yml`: `implement` 3000
tokens y 300 líneas, `review` 2500 y 250.

Interfaces externas: ninguna.

## Proposal

Dos ajustes en `templates/contract/implement.md`, dentro de las obligaciones
de evidencia que lleva todo prompt de implementador o corrector:

- La obligación sobre cuantificadores universales cubre toda la prosa
  entregable: documentación, comentarios de código y de test, y notas del Log.
- Una corrección de un hallazgo sobre prosa acota o borra la frase a lo que se
  ejecutó; nunca la sustituye por otra afirmación universal.

Y una obligación de entrega: el informe del implementador o corrector lista
cada frase con cuantificador universal que añadió o reescribió, junto al
comando que ejecutó su borde. El orquestador pasa esa lista al revisor.

Alternativas descartadas: quitar la regla del revisor, que dejaría pasar
afirmaciones falsas a las specs y la documentación; y prohibir los
cuantificadores en prosa, que no se puede comprobar y empobrece la
documentación.

## Specification

### CR1 — La obligación de prosa cubre la documentación y los comentarios de código
- **Given** `changeledger context implement`
- **When** se lee la obligación sobre cuantificadores universales en prosa entregable
- **Then** nombra la documentación y los comentarios de código, además de los comentarios de test y las notas del Log

### CR2 — Una corrección de prosa acota o borra
- **Given** `changeledger context implement`
- **When** se leen las obligaciones de un corrector
- **Then** una corrección de un hallazgo sobre prosa acota o borra la frase y no introduce otra afirmación universal

### CR3 — El informe lista las frases cuantificadas
- **Given** `changeledger context implement`
- **When** se leen las obligaciones de entrega de un implementador o corrector
- **Then** su informe lista cada frase con cuantificador universal que añadió o reescribió, con el comando que ejecutó su borde

### CR4 — El contexto sigue dentro de su presupuesto
- **Given** `templates/contract/budgets.yml`
- **When** se ejecutan los tests de presupuesto
- **Then** `implement` sigue dentro de sus límites sin retirar prosa normativa

### CR6 — El prompt de revisión lleva la lista de frases cuantificadas
- **Given** `changeledger context review`
- **When** se lee lo que el prompt de revisión añade a la cápsula del revisor
- **Then** incluye la lista de frases con cuantificador universal que el implementador o corrector informó, como puntos de escrutinio

### CR5 — El primer uso real
- **Given** el siguiente change de este repo con un hallazgo de revisión sobre prosa
- **When** el orquestador delega la corrección y la confirmación
- **Then** el informe del corrector lista las frases cuantificadas que tocó con su borde ejecutado, el prompt de confirmación lo incluye y `changeledger analyze <id>` registra los tramos `rework` de ese ciclo

## Plan

- [x] Escribir guardas de concepto, tolerantes a la redacción, para las tres obligaciones
  - **Target:** `test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-07T16:35:09Z`
- [x] Redactar las obligaciones en el fragmento de implementación
  - **Target:** `templates/contract/implement.md`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-07T16:35:09Z`
- [x] Probar y redactar en el fragmento de revisión que el prompt lleva la lista de frases cuantificadas
  - **Target:** `templates/contract/review.md, test/context.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-07T16:37:32Z`
- [ ] Recorrer el primer uso real en el siguiente hallazgo sobre prosa
  - **Target:** `templates/contract/implement.md`
  - **Verify:** verify: manual — informe del corrector, prompt de confirmación y `changeledger analyze <id>`
  - **Criteria:** CR5
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-07T16:37:33Z`

## Log
- **2026-10-07T13:51:59Z** `[version]` 0.18.0-dev
- **2026-10-07T15:03:05Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T16:27:18Z** `[status]` approved → in-progress
- **2026-10-07T16:27:18Z** `[branch]` set: feature/20261007-135159 (auto)
- **2026-10-07T16:35:01Z** `[note]` El orquestador corrige el Plan y añade CR6: la tarea 1 apuntaba a test/contract.test.mjs pero las guardas de concepto sobre fragmentos viven en test/context.test.mjs, y la Proposal ya decía que el orquestador pasa al revisor la lista de frases cuantificadas sin que ningún criterio lo cubriera; CR6 lo lleva a review.md.
- **2026-10-07T16:35:10Z** `[note]` Tareas 1 y 2 (subagente, top tier): la viñeta de prosa entregable de implement.md nombra documentación, comentarios de código y de test y notas del Log, añade que corregir un hallazgo sobre prosa acota la frase a lo ejecutado o la borra sin sustituirla por otra afirmación universal, y que el informe lista cada frase cuantificada añadida o reescrita con el comando que ejecutó su borde. Guardas tolerantes en DELEGATION_OBLIGATIONS de test/context.test.mjs; rojo 3/3 contra el fragmento previo, ocho mutantes y tres reformulaciones. implement pasa de 2742 a 2796 tokens y sigue en 227 líneas (límite 3000/300). Residuo: la lista de cuantificadores de la viñeta no incluye never.
- **2026-10-07T16:37:33Z** `[note]` Tarea 3 (CR6, mismo subagente): la viñeta de review.md sobre la lista del implementador pasa a las listas informadas por el implementador o corrector — decisiones no especificadas y frases con cuantificador universal añadidas o reescritas — como puntos de escrutinio. Guarda tolerante en DELEGATION_OBLIGATIONS; rojo contra el fragmento previo, dos mutantes y una reformulación. review pasa de 1140 a 1156 tokens y sigue en 98 líneas (límite 2500/250). pnpm verify en verde con 1771/1771.
- **2026-10-07T17:07:38Z** `[note]` Decisión del humano (2026-10-07): pasar a revisión con CR5 pendiente; si la revisión encuentra prosa a corregir, esa corrección recorre CR5; si pasa limpia, el change llega a validación con CR5 sin recorrer y decide el humano.
