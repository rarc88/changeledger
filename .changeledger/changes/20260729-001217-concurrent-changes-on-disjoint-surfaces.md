---
id: "20260729-001217"
title: Dos changes a la vez cuando sus superficies no se solapan
type: feature
status: draft
created: 2026-07-29T00:12:17Z
depends_on: ["20260728-212043"]
related_to: ["20260728-164620", "20260726-124837"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El core prohíbe más de un change en curso: *"One change at a time, on a non-main
branch."* Esa regla serializa la iniciativa entera. De los changes que quedan, **CH-6,
CH-7, CH-11, CH-12 y CH-13 son defectos limpios con superficies de escritura
disjuntas** y hoy van en fila india por una regla que cuenta changes en vez de mirar
qué ficheros tocan.

Decisión de Roberto, el 2026-07-28: *"creo que si relajaremos mas de un change a la vez
siempre y cuando no toquen la misma superficie"*, y el 2026-07-29 autorizó redactarlo.
El contexto es su queja medida sobre la lentitud del flujo: *"resolver los hallazgos se
está transformando en algo desesperante por lo lento del flujo"*.

Lo que se pide es que **la unidad de exclusividad sea la superficie de escritura, no el
número de changes**.

## Investigation

### El argumento decisivo es interno al propio fragmento

`templates/contract/core.md` ya gobierna la concurrencia por superficie, y lo hace
**18 líneas antes** de gobernarla por conteo:

- línea 38, sobre delegación: *"One owner per write surface; concurrent subagents must
  not share files."*
- línea 56, sobre changes: *"One change at a time, on a non-main branch."*

La misma preocupación —dos escritores pisándose— resuelta con **dos unidades distintas
en el mismo fichero**: por superficie para los delegados, por conteo para los changes.
La regla de superficie es la correcta y ya está escrita; la de conteo es una
aproximación conservadora que nunca se revisó. Es la misma forma de argumento que
`20260728-164620` usa para la unidad de commit: la regla contradice el criterio que su
propio fragmento enuncia.

### Nada la impone, así que relajarla no pierde ninguna garantía mecánica

Verificado el 2026-07-28: ni `src/lifecycle.mjs` ni `src/check.mjs` cuentan cuántos
changes están en `in-progress`. `assertTransition` valida la arista, no la
multiplicidad. La regla es **prosa sin verificador**, sostenida hoy sólo por disciplina
del orquestador.

### El CLI ya está construido para varios en curso

`src/commands/commit.mjs` resuelve el id omitido y, cuando hay más de un change en
curso, falla con un mensaje que **presupone que eso es un estado legítimo**:

```
Ambiguous: N changes are in-progress (<ids>); pass --id <change-id> explicitly.
```

No dice "esto es inválido": dice "desambigua". El código anticipó el estado que la
prosa prohíbe. Consecuencia operativa que este change debe escribir: **bajo
concurrencia, `--id` deja de ser opcional en `changeledger commit`**, porque la
resolución automática es precisamente lo que se vuelve ambiguo.

### La regla tiene dos sedes, y hay que elegir una

- `core.md:56` — *"One change at a time, on a non-main branch."*
- `implement.md:24` — *"Implement one change at a time, even while another
  already-delivered change waits in `in-validation`."*

Es la clase 19/48 —una regla con más de un dueño— y relajarla en una sede y no en la
otra dejaría el contrato contradiciéndose. **Sede decidida: el core**, porque es donde
vive la doctrina de superficie de la línea 38 y porque la regla aplica a todo el
lifecycle, no sólo a la etapa de implementación. La frase de `implement.md` se retira
nombrando su sustituta, no se borra.

Nótese que `implement.md:24` ya contiene una relajación parcial —permite empezar otro
change mientras uno espera en `in-validation`— y el overlay de `in-validation` la
detalla. Este change generaliza esa excepción en su lugar de tratarla como caso
especial.

### Lo que NO se relaja, y hay que decirlo explícitamente

1. **Cadenas de dependencia.** Dos changes cuyo `depends_on` directo o transitivo los
   une no pueden ir en paralelo, con superficies disjuntas o sin ellas.
2. **Un dueño por superficie.** La línea 38 sigue intacta: sigue prohibido que dos
   delegados escriban el mismo fichero, ahora también cuando pertenecen a changes
   distintos.
3. **Worktrees de agente.** El acta los descartó *"por sus propios problemas conocidos"*
   y este change **no** los reintroduce: la concurrencia es de documentos y ficheros
   dentro de un mismo árbol, no de árboles paralelos.
4. **Aprobar en oleadas** sigue siendo del humano, no del contrato (hallazgo 36). Este
   change habla de **ejecución** concurrente, no de aprobación en lote.

### Cómo se juzga la disjunción, y por qué aquí no lleva mecanismo

La superficie de un change son los targets que nombran sus tareas del Plan. Un
verificador que cruzara los targets de los changes en curso sería el mecanismo natural,
pero **hoy se apoyaría en un parser roto**: `src/task.mjs` casa sólo el último grupo
entre paréntesis y pierde criterios en silencio, y `namesTargetAndVerification` busca
las dos listas de patrones sobre el mismo texto. Construir el cruce sobre eso daría
falsos negativos, que en esta regla significan dos escritores pisándose.

Por tanto la disjunción la **declara el orquestador** y queda registrada, y el
verificador mecánico es follow-up explícito una vez la gramática del Plan por tags
exista. Declararlo por escrito es lo que hace auditable la decisión: si dos changes
colisionan, el Log dice quién afirmó que no lo harían.

### Interacción con `20260728-164620`, que hay que resolver antes de aprobar los dos

`164620` propone que el revisor reciba **`baseline..HEAD`** como artefacto inmutable.
Con dos changes concurrentes en la misma rama, sus commits se **interleavan** y ese
rango deja de contener sólo el change revisado. No es hipotético: es la consecuencia
directa de sumar las dos propuestas.

Salida disponible y ya construida: los commits llevan `[#id]`, y `gitRefs()` en
`src/git.mjs` ya atribuye commits a un change por ese marcador. El rango del revisor
pasa a ser **los commits del change**, no un intervalo de la rama. Este change lo nombra
como requisito de compatibilidad; implementarlo pertenece a `164620`, que es quien
define el rango.

### Presupuesto

Este change **añade** prosa normativa al core, que está a **193/195 líneas**. No cabe.
Por eso `depends_on: 20260728-212043`, que deriva el techo de líneas del de tokens y
lleva el core a 400. Es una dependencia de ejecución real, no una preferencia de orden.

Se sustituye una línea por una regla más larga, así que el neto es positivo en líneas y
la dependencia es estricta.

## Proposal

La exclusividad se declara por **superficie de escritura**, no por conteo:

> Dos o más changes pueden estar en curso a la vez cuando sus superficies de escritura
> son disjuntas y ninguna cadena `depends_on` los une. Quien las declara disjuntas lo
> registra.

Con tres consecuencias escritas:

| aspecto | antes | después |
|---|---|---|
| unidad de exclusividad | el change | la superficie de escritura |
| sede de la regla | `core.md` y `implement.md` | sólo `core.md` |
| `changeledger commit --id` | opcional si hay un solo change en curso | **obligatorio** en cuanto hay más de uno |

Alternativas descartadas:

- **Dejarlo en disciplina del orquestador sin tocar el contrato.** Es el estado de hoy:
  la regla dice una cosa, el código permite otra y la práctica improvisa. Un contrato
  que se incumple por conveniencia deja de ser contrato.
- **Permitir concurrencia sin exigir declaración.** Sin registro, una colisión no tiene
  responsable y el diagnóstico se vuelve arqueología.
- **Un verificador mecánico de solapamiento en este change.** Se apoyaría en el parser
  posicional de `src/task.mjs`, que pierde targets en silencio; un falso negativo aquí
  son dos escritores sobre el mismo fichero. Follow-up tras la gramática por tags.
- **Worktrees por change.** Ya descartados con sus problemas conocidos; no se
  reabren.

## Specification

### CR1 — La exclusividad se declara por superficie, no por conteo
- **Given** el fragmento `templates/contract/core.md`
- **When** se compone el contexto core
- **Then** no contiene la obligación `One change at a time`
- **And** declara que varios changes pueden estar en curso simultáneamente cuando sus superficies de escritura son disjuntas y ninguna cadena `depends_on` los une
- **And** exige que quien afirma la disjunción la registre

### CR2 — La regla tiene una sola sede
- **Given** los fragmentos `templates/contract/core.md` e `templates/contract/implement.md`
- **When** se compone el contexto `implement`
- **Then** `implement.md` no contiene ninguna obligación sobre cuántos changes pueden estar en curso
- **And** un grep de la obligación `one change at a time` sobre `templates/contract/` no la encuentra en ningún fragmento
- **And** la entrada de clasificación del pin de `implement.md` declara la frase retirada nombrando el core como su sede sustituta, no que dejara de importar

### CR3 — Las tres cosas que no se relajan quedan escritas
- **Given** el contexto core compuesto
- **When** se leen las condiciones de la concurrencia
- **Then** declara que una cadena `depends_on` directa o transitiva impide la concurrencia
- **And** conserva intacta la obligación de un solo dueño por superficie de escritura, y la extiende explícitamente a delegados de changes distintos
- **And** no introduce worktrees ni árboles paralelos como parte del mecanismo

### CR4 — `--id` es obligatorio en cuanto hay concurrencia
- **Given** un repo con dos changes en `in-progress` cuyos ids son `20260101-000001` y `20260101-000002`
- **When** se ejecuta `changeledger commit -m "chore(x): y"` sin `--id`
- **Then** falla sin crear commit, con un mensaje que nombra los dos ids y pide `--id` explícito
- **And** el contrato declara que bajo concurrencia `--id` deja de ser opcional, así que el fallo es una regla documentada y no una sorpresa

### CR5 — El rango del revisor se define por marcador, no por intervalo de rama
- **Given** dos changes concurrentes cuyos commits se interleavan en la misma rama
- **When** se pregunta qué commits pertenecen a uno de ellos
- **Then** el contrato declara que la pertenencia se determina por el marcador `[#id]` del commit y no por un intervalo `baseline..HEAD`
- **And** nombra `20260728-164620` como el change que define el rango del revisor, sin duplicar aquí esa definición

## Plan

- [ ] Sustituir en `templates/contract/core.md` la regla de conteo por la regla de superficie disjunta, con las tres condiciones que no se relajan; verify: `node --test test/context.test.mjs` (CR1, CR3)
- [ ] Retirar de `templates/contract/implement.md` la frase de un change a la vez y clasificar la retirada nombrando el core como sede sustituta; verify: `node --test test/context.test.mjs` (CR2)
- [ ] Declarar en `templates/contract/core.md` que `--id` es obligatorio bajo concurrencia y afirmar el fallo de `src/commands/commit.mjs` con dos changes en curso; verify: `node --test test/git.test.mjs` (CR4)
- [ ] Declarar en `templates/contract/core.md` que la pertenencia de un commit a un change la fija su marcador `[#id]`; verify: `node --test test/context.test.mjs` (CR5)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-29T00:12:17Z** `[note]` Draft creado por autorización explícita de Roberto. El argumento decisivo es interno: core.md ya gobierna la concurrencia por superficie de escritura en su línea 38 y por conteo de changes en la 56, dos unidades para la misma preocupación en el mismo fichero. Verificado que nada impone la regla —ni lifecycle.mjs ni check.mjs cuentan changes en curso— y que src/commands/commit.mjs ya trata varios en curso como estado legítimo que sólo hay que desambiguar. Sin mecanismo de solapamiento a propósito: se apoyaría en el parser posicional de src/task.mjs, que pierde targets en silencio, y un falso negativo aquí son dos escritores sobre el mismo fichero.
- **2026-07-29T00:12:18Z** `[note]` depends_on 20260728-212043 es dependencia real de presupuesto: este change añade prosa a un core que está a 193/195 líneas, y CH-17 lo lleva a 400. Y hay interacción con 20260728-164620 que hay que resolver antes de aprobar los dos: con changes concurrentes en la misma rama sus commits se interleavan, así que baseline..HEAD deja de contener sólo el change revisado. La salida ya está construida: gitRefs() atribuye commits por marcador [#id].
