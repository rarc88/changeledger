---
id: "20260728-194157"
title: Las guardas del contrato barren todo subfragmento
type: feature
status: draft
created: 2026-07-28T19:41:57Z
depends_on: []
related_to: ["20260728-170429", "20260726-124837", "20260727-194234"]
owner: raruiz-hiberuscom
---

## Request

Tres guardas exhaustivas-negativas del contrato enumeran sólo el nivel superior de
`templates/contract/`, así que son **ciegas a los 8 fragmentos de
`agent-contexts/` y `agent-prompts/`** — versionados y publicados a los repos
consumidores. Esas guardas son precisamente las que garantizan que retirar prosa
del contrato no pierde nada, y cubren 12 de 20 ficheros.

Descubierto el 2026-07-28 al cerrar el mismo hueco en una cuarta guarda
(`20260728-170429` CR2). El barrido de clase encontró las otras tres y quedaron
fuera de alcance porque son criterios de otros changes.

## Investigation

**El hueco, reproducido.** Un revisor de contexto limpio inyectó en
`templates/contract/agent-contexts/investigation.md` la frase retirada que
`124837 CR1` vigila —`later work could obscure attribution`— y la suite siguió en
**79/79 verde**. No es una posibilidad teórica: la obligación puede reintroducirse
en un fragmento publicado sin que nada avise.

**Las tres guardas afectadas**, todas en `test/context.test.mjs`, todas con la
misma forma `fs.readdirSync(<dir>).filter(name => name.endsWith('.md'))` sin
`{ recursive: true }`:

- `194234 CR4` — la unidad de commit tiene una sola sede: comprueba que las copias
  retiradas no estén en ningún fragmento.
- `124837 CR1` — el juicio de atribución retirado no aparece en el contrato.
- `124837 CR8` — ninguna obligación sale de `implement.md` sin sede nombrada.

**Conteo verificado**: 12 ficheros `.md` en el nivel superior, **20** en recursivo.
Los 8 que faltan son 4 en `agent-contexts/` y 4 en `agent-prompts/`.

**No toda enumeración es del mismo tipo.** Dos llamadas más a `readdirSync` sobre
el mismo directorio (búsqueda de un fragmento por nombre, y el inventario de
digests del nivel superior) **no** son guardas exhaustivas-negativas y no
comparten el defecto. La distinción es la que importa: el hueco está donde una
aserción afirma que algo **no aparece en ninguna parte**.

**Por qué esto es grave y no cosmético.** El hallazgo 38 de la iniciativa dice que
ninguna retirada de prosa normativa vale sin sede nombrada y verificada por grep de
la obligación misma. Estas tres guardas **son** ese mecanismo. Con un 40% de los
ficheros fuera de su barrido, el mecanismo da una garantía que no tiene.

**Residuo relacionado, misma familia y mismo fichero.** `bootstrapHeadCut()` en
`test/context.test.mjs` hace `REFERENCE.match(/head -(\d+)/)` y destructura sin
comprobar nulo: si `REFERENCE` dejara de contener el patrón lanzaría un
`TypeError` en vez de nombrar la ausencia del corte del bootstrap. Contradice el
principio del repo —lo que no se puede decidir aborta **y se nombra**— y viaja aquí
por ser el mismo fichero y la misma clase de fragilidad de guarda.

## Proposal

Las tres enumeraciones pasan a recursivas, y el barrido queda **derivado de un solo
sitio** en vez de repetido tres veces: un helper que devuelva todo fragmento `.md`
bajo `templates/contract/` a cualquier profundidad, usado por las cuatro guardas
exhaustivas-negativas. Repetir la enumeración es lo que permitió que tres de cuatro
quedaran atrás cuando la cuarta se corrigió.

El helper es también el sitio donde se nombra la distinción: una guarda
exhaustiva-negativa lo usa; una búsqueda por nombre o un inventario del nivel
superior, no.

Y `bootstrapHeadCut()` comprueba el nulo y falla nombrando que el bootstrap no
declara corte, en vez de lanzar un `TypeError`.

Alternativas descartadas:

- **Añadir `{ recursive: true }` en los tres sitios y ya.** Cierra las instancias
  de hoy y deja la causa: cuatro copias de la misma enumeración que vuelven a
  divergir en cuanto alguien añada la quinta guarda.
- **Un test que prohíba `readdirSync` sin `recursive` en estas suites.** Cerraría la
  clase por prohibición, pero rompería las dos llamadas legítimas que no son
  guardas exhaustivas.

## Specification

### CR1 — Toda guarda exhaustiva-negativa barre los subfragmentos
- **Given** las guardas de `test/context.test.mjs` que afirman que una obligación retirada no aparece en ningún fragmento del contrato
- **When** se inyecta la cadena que cada una vigila en un fichero bajo `templates/contract/agent-contexts/` y en otro bajo `templates/contract/agent-prompts/`
- **Then** cada guarda falla nombrando el fichero infractor
- **And** ninguna de ellas pasa con la inyección presente

### CR2 — La enumeración tiene una sola sede
- **Given** `test/context.test.mjs`
- **When** se busca cómo cada guarda exhaustiva-negativa obtiene su lista de fragmentos
- **Then** todas la obtienen del mismo helper, que devuelve todo `.md` bajo `templates/contract/` a cualquier profundidad
- **And** ninguna guarda exhaustiva-negativa enumera el directorio por su cuenta

### CR3 — Las enumeraciones que no son guardas quedan intactas
- **Given** la búsqueda de un fragmento por nombre y el inventario de digests del nivel superior
- **When** se ejecuta la suite tras el cambio
- **Then** ambas siguen operando sobre el nivel superior y pasan sin modificación de su comportamiento
- **And** el helper documenta que sólo lo usan las guardas exhaustivas-negativas

### CR4 — La ausencia del corte del bootstrap se nombra, no revienta
- **Given** un `REFERENCE` que no contiene el patrón `head -<n>`
- **When** se evalúa el techo de líneas del core contra el corte del bootstrap
- **Then** la aserción falla con un mensaje que nombra que el bootstrap no declara corte
- **And** no lanza un `TypeError` por destructurar un `null`

## Plan

- [ ] Extraer el helper de enumeración recursiva en `test/context.test.mjs` y hacer que las cuatro guardas exhaustivas-negativas lo usen, dejando intactas la búsqueda por nombre y el inventario del nivel superior
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] Comprobar el nulo en `bootstrapHeadCut` de `test/context.test.mjs` y fallar nombrando la ausencia del corte
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR4
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log

- **2026-07-28T19:41:57Z** `[note]` Draft creado. Nace del barrido de clase de `20260728-170429`: al cerrar el hueco no recursivo de una guarda, el delegado encontró tres más y las reportó sin arreglarlas por ser criterios de otros changes. El revisor de confirmación probó que el hueco es explotable inyectando la frase retirada de 124837 CR1 en un subdirectorio y obteniendo la suite verde. La causa no es el flag ausente sino la enumeración repetida cuatro veces, así que el arreglo es una sola sede.
- **2026-07-28T19:43:53Z** `[note]` BLOQUEADO POR EL HALLAZGO 41, en su forma mas pura. Todo el entregable de este change vive en test/context.test.mjs, pero test/** es patron de verificacion y no de target, asi que NINGUNA de sus tareas pasa readiness: 4 warnings en draft que serian errores en approved. Y no hay tarea de src/ ni templates/ con la que fusionarlas, que es el apano que usaron 194233 y 124837, porque el change es puramente endurecimiento de guardas. Las tres salidas conocidas son todas malas: meter test/** en target_patterns vuelve vacio el requisito de target para todo el repo porque check busca ambas listas sobre el mismo texto de la tarea; marcar todo (support) es el bypass que convierte errores en warnings y desactiva la trazabilidad; y bajar el tipo a chore deja cero diagnosticos. El arreglo estructural es la gramatica del Plan por tags, que separa el campo de target del de verificacion. Este change espera a ese, y su existencia es el mejor argumento para priorizarlo: demuestra que un change cuyo entregable es enteramente una guarda de test no tiene forma legal de documentarse con criterios.
