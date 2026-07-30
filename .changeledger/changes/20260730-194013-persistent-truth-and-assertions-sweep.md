---
id: "20260730-194013"
title: Barrido de verdad persistente y aserciones frágiles
type: refactor
status: draft
created: 2026-07-30T19:40:13Z
depends_on: []
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

- [ ] Corregir las dos invocaciones y la sede de la evidencia en las specs
  - **Target:** `.changeledger/specs/architecture.md`, `.changeledger/specs/viewer.md`, `.changeledger/specs/contract-discovery.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Criteria:** CR1, CR2
- [ ] Reescribir el barrido de 124837 CR8 a por-fragmento y añadir la aserción
  de completitud del inventario
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3, CR4
- [ ] Normalizar contractText y ajustar los patrones dependientes del wrap
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR5
- [ ] Reescribir los dos comentarios rancios a la gramática vigente
  - **Support:**
  - **Verify:** `node --test test/context.test.mjs`
- [ ] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
