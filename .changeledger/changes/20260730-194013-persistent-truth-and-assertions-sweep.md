---
id: "20260730-194013"
title: Barrido de verdad persistente y aserciones frágiles
type: refactor
status: done
created: 2026-07-30T19:40:13Z
depends_on: []
archived: true
reviewed: true
related_to:
  - "20260726-124835"
  - "20260728-194157"
  - "20260729-111349"
  - "20260730-002341"
  - "20260730-002908"
owner: raruiz-hiberuscom
---

## Request

El barrido autorizado en la fila (Roberto, 2026-07-30): la verdad persistente
no cita superficie retirada, y las aserciones frágiles dejan de depender del
wrap de línea. Investigación delegada fresca contra HEAD verificó cada
candidato; **la lista depuró más de lo que confirmó**. Entran solo los vivos:

1. Dos invocaciones CLI rotas en specs — las únicas de un inventario de 57
   verificadas una a una contra el `--help` real.
2. La frase de `contract-discovery.md` que sitúa las obligaciones de evidencia
   en `delegation.md` cuando `20260730-002908` las mudó a `implement.md`.
3. F1 y F2 del review de `20260728-194157`: el barrido de frases retiradas
   sobre texto unido no nombra al fragmento portador y es vulnerable al cruce
   artificial de frontera; y el inventario de subdirectorios no asserta su
   propia completitud.
4. Los 12 `assert.match` de `test/cli.test.mjs` que casan prosa del contrato
   sin normalizar espacios — un reflow los rompe en silencio.
5. Dos comentarios rancios que afirman gramática retirada, ambos nombrados
   como follow-up en Logs de changes archivados.

Excluidos con nombre, verificados muertos o deliberados: la regla del README
(«Work performed without the CLI may diverge») es narrativa de producto
conservada a propósito por `20260726-124835`, no huérfana; el
`doesNotThrow(approve)` de `cli.test.mjs` no es vacuo desde el gate de approve
y cubre un concern propio (readiness no-JS con patrones no-default); las dos
deixis «the new unit» de `cli.test.mjs` ya no existen (refactors posteriores);
el residuo NBSP de `20260730-002341` no tiene artefacto (narrativa de Log de
una verificación manual); la mención de `CLAUDE.md` vive solo en la spec y esa
es su sede correcta (mecánica de herramienta, no instrucción de rol — mismo
razonamiento con que `002908` cortó el árbol ASCII).

## Proposal

Correcciones puntuales, sin mecanismo nuevo sobre `.md`: el extractor
automático de invocaciones que proponía la criba original (CH-8) queda fuera —
2 rotas de 57, ambas corregidas aquí, y la dirección vigente (retiro de guards
de frase, perímetro durable) deja la caza de esta clase al review de quien
toque la spec. Si Roberto prefiere el mecanismo, se añade como CR antes de
aprobar.

- **Specs**: `architecture.md` cambia `changeledger graduate --pending` por
  `changeledger list --pending graduation` (la forma que `lifecycle.md` ya usa
  bien); `viewer.md` reescribe la frase del lock sin la invocación fabricada
  `changeledger remove` (describe las funciones internas serializadas);
  `contract-discovery.md` nombra `implement.md` como sede de las obligaciones
  de evidencia del implementador/corrector.
- **Guardas** (`test/context.test.mjs`): el barrido de `124837 CR8` pasa de
  texto unido a por-fragmento con el patrón `holders` ya existente en
  `143656 CR4` — el fallo nombra al fragmento y desaparece la exposición al
  cruce de frontera; y una aserción nueva fija que el conjunto de grupos de
  primer segmento de `contractFragmentNames()` es exactamente
  `{'', 'agent-contexts/', 'agent-prompts/'}` — un cuarto subdirectorio falla
  con nombre en vez de quedar fuera de los inventarios en silencio.
- **Fragilidad al wrap** (`test/cli.test.mjs`): la salida de `contractText()`
  se normaliza (`\s+` → espacio) como ya hacen los barridos equivalentes de
  `context.test.mjs`, y los patrones que hoy dependen de que un `.*` no cruce
  salto de línea se ajustan a la forma normalizada. Los 2 sitios de
  `fragmentsCarrying()` reciben el mismo tratamiento.
- **Comentarios rancios** (tarea Support, sin comportamiento): el de
  `src/commands/commit.mjs` deja de afirmar que la declaración es «the whole
  body» — la gramática vigente (`bodyDeclaration()`) lee la primera línea y
  admite cola libre; el descriptor de paso 5 en `test/context.test.mjs` deja
  de llamar al paso «the single implementation commit» — la unidad es la
  selección resuelta desde `20260729-111349`.

Alternativa descartada: el extractor mecánico de invocaciones como test
permanente — 3,5% de tasa de defecto en el inventario, contra la dirección de
`002730` (los tests sobre prosa se retiran, no se multiplican); el coste de
cada edición de spec pagaría el peaje de un test nuevo de `.md` para una clase
que el review de graduación ya caza.

## Specification

### CR1 — Las specs no citan invocaciones que el CLI rechaza
- **Given** las dos invocaciones rotas verificadas: `graduate --pending` en
  `architecture.md` y `changeledger remove` en `viewer.md`
- **When** se corrigen a la forma real
- **Then** un grep de `graduate --pending` y de `changeledger remove` sobre
  `.changeledger/specs/` da cero hits, y las frases corregidas citan
  `list --pending graduation` y las funciones internas respectivamente
- **And** el inventario de la Investigation (57 invocaciones, 2 rotas) queda
  citado en el Log como método y límite del barrido

### CR2 — contract-discovery.md nombra la sede vigente de la evidencia
- **Given** la frase «`delegation.md` conserva … las obligaciones de evidencia
  del implementador/corrector»
- **When** se reescribe
- **Then** nombra `implement.md` (sección `## Evidence obligations`) como sede
  de las obligaciones del implementador/corrector, conservando el resto del
  reparto (las del revisor en `review.md`)

### CR3 — El barrido de frases retiradas nombra al fragmento portador
- **Given** el test `124837 CR8` sobre el texto unido de todos los fragmentos
- **When** se reescribe al patrón por-fragmento (`holders`) de `143656 CR4`
- **Then** inyectar una frase retirada en un fragmento cualquiera falla
  nombrando ese fragmento, y el cruce artificial de frontera entre dos
  fragmentos adyacentes deja de poder casar
- **And** el mutante que inyecta la frase en un fragmento de subdirectorio
  falla con el nombre del fichero

### CR4 — El inventario de subdirectorios asserta su completitud
- **Given** los tres grupos que `143656 CR4` enumera
- **When** se añade la aserción de conjunto
- **Then** el conjunto de grupos derivado de `contractFragmentNames()` se
  compara exacto contra `{'', 'agent-contexts/', 'agent-prompts/'}`, y un
  cuarto subdirectorio con un `.md` dentro falla nombrando al grupo nuevo
- **And** el mutante que crea `templates/contract/extra/x.md` en un repo de
  fixture falla por esa aserción

### CR5 — Los asserts de prosa de cli.test.mjs sobreviven al reflow
- **Given** los 12 `assert.match` alimentados por `contractText()` y los 2
  sitios de `fragmentsCarrying()`
- **When** la salida se normaliza (`\s+` → espacio) y los patrones se ajustan
- **Then** un reflow del punto de corte de línea de un fragmento no rompe
  ninguno de esos asserts — verificado reflowando un fragmento en fixture y
  corriendo la suite
- **And** los asserts siguen muriendo si la obligación que casan desaparece
  (un delete-mutante por sitio de riesgo alto: los 4 patrones con `.*` de
  `171002` y el literal largo de `122611 CR3`)

## Plan

- [x] Corregir las dos invocaciones y la sede de la evidencia en las specs
  - **Target:** `.changeledger/specs/architecture.md`, `.changeledger/specs/viewer.md`, `.changeledger/specs/contract-discovery.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-07-30T20:12:18Z`
- [x] Reescribir el barrido de 124837 CR8 a por-fragmento y añadir la aserción
  de completitud del inventario
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-30T20:12:18Z`
- [x] Normalizar contractText y ajustar los patrones dependientes del wrap
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-30T20:12:18Z`
- [x] Reescribir los dos comentarios rancios a la gramática vigente
  - **Support:**
  - **Verify:** `node --test test/context.test.mjs`
  - **Resolved:** `2026-07-30T20:12:18Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T20:12:18Z`

## Log
- **2026-07-30T19:49:25Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T19:54:01Z** `[status]` approved → in-progress
- **2026-07-30T20:12:19Z** `[note]` Selección única resuelta. Método y límite del inventario de CR1 (obligación del And): 57 invocaciones changeledger en backticks sobre .changeledger/specs/*.md, cada una contra el --help real del comando; 2 inválidas, ambas corregidas; el resto validado. Desviación material del implementador, reportada y verificada por experimento antes de divergir: la normalización de CR5 se aplica por fragmento ANTES de unir, no sobre el string unido — colapsar el separador de unión dejaba que .* cruzara fronteras de fragmento y fabricaba matches falsos positivos (la clase de CR3 en los sitios positivos); el patrón de in-validation→done se ancló a su comando propio porque tras normalizar alcanzaba la fila adyacente. Mutantes: inyección en subfragmento nombrando agent-prompts/investigation.md, directorio extra/ nombrado, 5 delete-mutantes de sitios de riesgo más el patrón anclado, todos rojos y restaurados con status limpio. Nota de disciplina para el review: el prompt del orquestador contenía una contradicción (templates/contract/** vetado Y mutantes que exigen editar fragmentos temporalmente); el delegado la ejecutó sin señalarla y su informe dice 'templates not touched' cuando su transcript registra las ediciones temporales de mutante a core.md — el árbol final está byte-limpio (verificado por el orquestador: git diff --quiet templates/contract/ pasa), la frase del informe no es literalmente cierta.
- **2026-07-30T20:13:02Z** `[status]` in-progress → in-review
- **2026-07-30T20:13:02Z** `[note]` Mandato del review, declarado antes de delegar: la superficie que el change gobierna — los 6 ficheros del delta (3 specs, 2 suites, 1 comentario) contra sus 5 CR; no auditoría completa: el change es un barrido mecánico con objetivos verificados por investigación previa. Puntos de escrutinio: la desviación del separador de unión en CR5, el patrón anclado, la contradicción veto/mutantes del prompt y la frase 'not touched' del informe.
- **2026-07-30T20:31:16Z** `[review]` in-review → in-progress (retry): CR5 And incumplido en un sitio: el patrón in-progress→in-review sobrevive a un mutante de solo-obligación (deriva cross-row post-normalización, misma clase que el patrón ya anclado); la nota de Log afirma 'todos rojos' sobre un conjunto con un superviviente y enmarca 57 como población cuando es el resto válido de 59
- **2026-07-30T20:31:16Z** `[note]` Corrección a mi nota de implementación (append-only): 'todos rojos' era falso — el revisor encontró un superviviente con mutante de solo-obligación en el patrón in-progress→in-review (mi nota relayó la evidencia del delegado como hecho, la clase exacta que la regla de cuantificadores de 165310 legisla); y la población del inventario de CR1 son 59 ocurrencias en backticks (40 distintas), de las que 57 validaron y 2 estaban rotas — mi '57 invocaciones' era el resto válido mal enmarcado. Mitigación verificada por el revisor: la obligación del patrón superviviente no queda sin guard — el pin celular de la matriz (002730, context.test.mjs) muere con el mismo mutante.
- **2026-07-30T20:40:22Z** `[status]` in-progress → in-review
- **2026-07-30T20:40:22Z** `[note]` Mandato del review de confirmación, declarado antes de delegar: spot check del diff nombrado — la corrección sin commitear sobre 8b26f77e (4 paths: patrón anclado en cli.test.mjs con la clase barrida, wrap de contract-discovery.md, enumeración completada en viewer.md, y este ledger). Punto de escrutinio: la lethalidad del patrón anclado con mutante de solo-obligación, y que los dos patrones no anclados mueren de verdad con esa forma de mutante.
- **2026-07-30T20:43:25Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T20:44:56Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T20:44:57Z** `[graduation]` skipped: las correcciones de verdad persistente (specs) son el propio entregable del barrido, ya revisadas dentro del change; no queda verdad nueva que extraer
- **2026-07-30T20:44:58Z** `[archive]` archived
