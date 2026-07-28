---
id: "20260728-164620"
title: La unidad de commit es el change, no la tarea del Plan
type: feature
status: draft
created: 2026-07-28T16:46:20Z
depends_on: []
related_to: ["20260726-124837", "20260727-194234", "20260728-151336", "20260722-124656"]
owner: raruiz-hiberuscom
---

## Request

El core exige **un commit por tarea del Plan**, con el código de esa tarea, su
test, su casilla marcada y sus entradas de Log. Delegar el Plan completo a un
subagente hace esa regla **imposible de cumplir**: el delegado no toca git, así que
al recibir su informe las casillas y las notas ya están escritas, y separar la
unidad exigiría reescribir el documento dos veces — la reconstrucción que el propio
bloque prohíbe.

Roberto, el 2026-07-28, tras verlo ocurrir: *"tendremos que analizar si como los
changes tendrán un presupuesto de complejidad, una vez que esté en in-progress
commitear todo solo después que el review confirme el PASS"*.

Se necesita que la unidad de commit sea el change, sin perder el artefacto
inmutable que el revisor inspecciona ni dejar trabajo largo sin commitear.

## Investigation

**Ocurrió dos veces el 2026-07-28, con resultados opuestos.** En `20260722-124656`
delegué el Plan entero en una pasada y el commit por tarea fue imposible: se
resolvió con la salida legal —commit combinado con el porqué en el Log— y el
revisor lo confirmó como atribuible al flujo de orquestación, no al implementador.
En `20260728-151336` delegué tarea por tarea para cumplir la regla, y **costó 347k
tokens en tres delegaciones frente a 161k del Plan completo del change anterior**,
siendo un change más pequeño. El coste es fijo por delegación —cada delegado carga
su contexto, relee el documento, re-verifica los hechos y vuelve a correr el gate
entero— así que la regla del commit por tarea multiplica el coste de delegación por
el número de tareas.

**El argumento más fuerte es interno al propio bloque.** `templates/contract/core.md`
enuncia el test de granularidad —*"whether the unit will be reverted, referenced or
implemented independently"*— y justifica el commit del documento porque *"a later
implementation branch builds on it, `changeledger check --commits` references it by
id, and it can be discarded alone"*. Una tarea del Plan no se revierte sola, no se
referencia por id y casi nunca se implementa aparte. El change sí. **La regla por
tarea no pasa el test que su propio párrafo enuncia.**

**Nada la impone hoy.** `lintCommitRange` en `src/git.mjs` valida únicamente la
forma de los marcadores; ningún código cuenta commits contra tareas completadas.
Verificado también que `src/commands/check.mjs` es su único consumidor. La regla es
prosa sin verificador, así que retirarla no pierde ninguna garantía mecánica: hoy la
cumplen los delegados por disciplina. `20260726-124837` dejó registrado un lint que
contase commits contra tareas como *"merece medirse más adelante, pero es superficie
nueva"* — nunca se hizo.

**Una cláusula se vuelve falsa, no obsoleta.** El bloque dice *"never defer them and
reconstruct mixed diffs at the end"*. Bajo la regla nueva, diferir hasta el final de
la implementación **es** la regla. La cláusula no puede quedarse ni borrarse en
silencio: se retira nombrando que la sustituye una unidad distinta, no que dejara de
importar.

**Existe una quinta clase de facto, sin nombre.** `templates/contract/review.md` ya
manda que la corrección tras `fail --retry` quede **sin commitear** hasta que un
revisor fresco la confirme, y que entonces *"correction, tests and ledger form a
commit"*. Los dos changes cerrados hoy produjeron exactamente ese commit. El bloque
declara cuatro clases y la práctica usa cinco.

**Presupuesto.** El bloque `## Commits` mide **28 líneas contra un techo de 28**, y
el core está a 193/200 líneas y 11770/12000 bytes. El cambio retira la fórmula
`n + 1` / `n + 2`, la cláusula de reconstrucción y la mención a tareas inseparables,
y añade una clase. Si el contenido correcto no cabe, el trabajo **para y pregunta**:
no se retira normativa para encajar en un techo.

## Proposal

Cinco clases, ninguna dependiente del número de tareas:

| clase | cuándo | cuántas |
|---|---|---|
| **Draft** | un documento redactado, commiteado en solitario | 0..n |
| **Baseline** | el documento aprobado, antes de cualquier código | exactamente 1 |
| **Implementation** | el trabajo completo del change, tras el gate local y **antes** de delegar el review | exactamente 1 |
| **Correction** | tras `fail --retry` o un rechazo humano, **sin commitear** hasta que un revisor fresco la confirme | 0..n |
| **Handoff** | **obligatoria** si el trabajo se detiene en `blocked` o al terminar la sesión con estado sin commitear | 0..1 |

La fórmula deja de depender de `n`: **2 commits por change**, más una por corrección
confirmada y una de handoff si aplica.

**El commit de implementación va antes del review, no después del PASS.** Es la
única diferencia con la formulación original, y la razón es concreta: si nada se
commitea hasta el PASS, el revisor inspecciona el working tree y **entre su informe
y el commit el orquestador puede editar el entregable sin que quede rastro de qué se
revisó**. De los cuatro `fail --retry` de la fase A, dos eran defectos que introdujo
el orquestador editando el entregable. Con la implementación commiteada antes, el
rango `baseline..HEAD` es un artefacto inmutable.

Alternativas descartadas:

- **Commitear todo tras el PASS** (formulación original). Pierde el artefacto
  inmutable, y un `fail --block` dejaría el trabajo entero sin commitear.
- **Conservar el commit por tarea y delegar siempre por tarea.** Medido: multiplica
  el coste por el número de tareas sin comprar ninguna garantía, porque nada lo
  verifica.
- **Añadir el lint que cuente commits contra tareas.** Volvería exigible la regla en
  vez de retirarla, pero cementa una unidad que no pasa el test de granularidad del
  propio contrato, y es superficie nueva.

Lo que este cambio **no** hace: no toca el prompt del revisor. Que el revisor
reciba `baseline..HEAD` en vez del working tree es consecuencia disponible, no
obligación introducida aquí; su sede son los skeletons de delegación.

## Specification

### CR1 — El bloque declara cinco clases y ninguna por tarea
- **Given** el fragmento `templates/contract/core.md`
- **When** se compone el contexto core
- **Then** el bloque `## Commits` nombra exactamente las clases Draft, Baseline, Implementation, Correction y Handoff
- **And** no contiene ninguna obligación de un commit por tarea del Plan ni la fórmula `n + 1`

### CR2 — La implementación se commitea antes de pedir review
- **Given** el bloque `## Commits` y el gate ordenado de `templates/contract/implement.md`
- **When** se compone el contexto `implement`
- **Then** el commit de implementación aparece exigido antes del paso que delega el review
- **And** el contrato nombra `baseline..HEAD` como el rango que el revisor puede inspeccionar

### CR3 — La corrección es una clase declarada, no una excepción tácita
- **Given** el bloque `## Commits`
- **When** se compone el contexto core
- **Then** declara la clase Correction como cero o más, sin commitear hasta que un revisor fresco la confirme
- **And** `templates/contract/review.md` sigue siendo la sede de qué ocurre con la corrección según el veredicto, sin duplicar la declaración de la clase

### CR4 — El handoff es obligatorio cuando el trabajo se detiene
- **Given** el bloque `## Commits`
- **When** se compone el contexto core
- **Then** declara el handoff obligatorio si el trabajo se detiene en `blocked` o al terminar la sesión con estado sin commitear
- **And** no lo declara como cero-o-uno opcional

### CR5 — La cláusula retirada se nombra, no se borra
- **Given** el mapa de pins de snapshot de `test/context.test.mjs`
- **When** se actualiza el pin de `core.md`
- **Then** la entrada clasifica la cláusula `never defer them and reconstruct mixed diffs at the end` como retirada, declarando que la sustituye una unidad de commit distinta y no que dejara de importar
- **And** un grep de esa obligación no la encuentra en ningún otro fragmento

### CR6 — El bloque cabe en su techo
- **Given** el fragmento `templates/contract/core.md` reescrito
- **When** se ejecuta la comprobación de tamaño del bloque
- **Then** el bloque `## Commits` no supera las 28 líneas que esa comprobación fija
- **And** el contexto core no supera su techo de líneas ni de bytes

## Plan

- [ ] Reescribir el bloque `## Commits` de `templates/contract/core.md` con las cinco clases, retirando la fórmula por tarea y la cláusula de reconstrucción, y alinear el gate ordenado de `templates/contract/implement.md`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-28T16:46:20Z** `[note]` Draft creado. Nace de que el commit por tarea resultó imposible al delegar el Plan completo en 124656 y costó 347k frente a 161k al delegar por tarea en 151336. El argumento decisivo es interno: una tarea del Plan no pasa el test de granularidad que el propio bloque enuncia. Verificado que ningún lint impone la regla hoy, así que retirarla no pierde garantía mecánica.
