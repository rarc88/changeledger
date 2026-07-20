---
id: "20260718-105456"
title: Relacionar changes sin bloquear su ejecución
type: feature
status: in-validation
created: 2026-07-18T10:54:56Z
depends_on: ["20260718-111457"]
owner: Roberto Ruiz

---

## Request

Un requerimiento puede dividirse legítimamente en varios changes independientes,
o un change posterior puede extender el resultado de otro sin necesitar que ese
otro termine primero. Hoy el único vínculo estructurado es `depends_on`, cuya
semántica bloquea ejecución y participa en el lifecycle. Usarlo solo para obtener
trazabilidad falsearía esa semántica; dejar los changes sin vínculo obliga a
redescubrir su historia mediante búsqueda textual.

Añadir una relación explícita y no bloqueante que permita descubrir changes
conectados sin convertir esa conexión en una dependencia.

## Investigation

- `depends_on` es parte requerida del frontmatter. `src/check.mjs` valida
  referencias locales y ciclos, y el contrato impide iniciar candidatos cuya
  cadena directa o transitiva alcanza un change en `in-validation`.
- `changeledger context <id>` resuelve las dependencias locales y presenta id,
  título y estado. Las referencias externas `project:id` permanecen sin resolver.
- El viewer expone `depends_on` en su modelo, detalle, tabla y grafo dirigido;
  por tanto, reutilizarlo para afinidad alteraría tanto la representación visual
  como decisiones operativas de agentes.
- En el detalle actual, cada dependencia es un pill que solo muestra el id. No
  expone título, estado, tipo ni owner, por lo que obliga a navegar para decidir
  si la referencia es relevante.
- Las specs ya tienen un componente expandible `Graduation history`, pero sus
  entradas son strings sin navegación. El antecedente `20260718-111457`
  reemplaza esas frases frágiles por el frontmatter estructurado
  `graduated_from`; este change consume ese dato, no redefine su persistencia.
- El antecedente `20260619-171002` descartó `extends` porque entonces el problema
  observado era evitar fragmentación durante un change activo. El uso posterior
  aporta un caso distinto: varios changes independientes y ya justificados
  necesitan trazabilidad sin orden de ejecución.
- Una relación duplicada en ambos documentos sería frágil: podría quedar
  asimétrica. El repositorio ya carga todos los changes y puede calcular enlaces
  entrantes sin persistir una segunda copia.
- La validación en repositorios externos confirmó una brecha de autoría: el
  scaffold crea `related_to: []`, pero el contrato no obliga a clasificar los
  resultados de `changeledger search`, por lo que los agentes dejan el campo
  vacío incluso cuando descubren antecedentes relevantes.

## Proposal

Añadir el campo opcional `related_to`, una lista de ids de changes o referencias
externas `project:id`:

```yaml
depends_on: []
related_to: ["20260718-100000", "other-project:20260701-090000"]
```

`related_to` expresa únicamente que existe contexto útil compartido. No impone
orden, no participa en readiness ni lifecycle y admite relaciones con changes
en cualquier estado, incluidos `discarded` y archivados. Una relación local se
declara una sola vez; al consultar cualquiera de sus extremos, ChangeLedger
calcula también las referencias entrantes y presenta el vínculo como bidireccional
para descubrimiento.

El checker valida que el campo sea una lista, que no contenga el propio id y que
cada referencia local exista. Las referencias externas siguen la misma sintaxis
de `depends_on` y no se resuelven localmente. No se comprueban ciclos porque una
relación no define un grafo de ejecución.

El contexto de un change mostrará una sección `Related changes` separada de
`Dependencies`, con dirección de autoría (`outgoing` o `incoming`) y, para
referencias locales, título y estado.

En el viewer, dependencias y relaciones reutilizarán el patrón expandible de
`Graduation history` en lugar de pills sueltos. Un componente común de referencias
mostrará en su summary el icono semántico, label y número de entradas; al
expandirse, cada change local mostrará id, título, tipo, estado y owner cuando
exista. Toda la fila será navegable y abrirá el detalle de ese change. Las
referencias externas conservarán la navegación cross-project existente y se
identificarán como externas.

El mismo componente mejorará `Graduation history`: resolverá cada id de
`graduated_from` contra el repositorio para presentar los mismos metadatos y
abrir el change al hacer clic. Una referencia histórica no resoluble seguirá
visible como `unavailable`, sin ocultar el id durable de la spec.

El grafo mantendrá una representación propia: las relaciones se dibujarán como
aristas no dirigidas y discontinuas, distinguibles de las dependencias dirigidas.

El scaffold de `changeledger new` incluirá `related_to: []` inmediatamente
después de `depends_on`, y el contrato explicará cuándo usar cada campo.
Durante Investigation, el agente clasificará cada resultado relevante de
`changeledger search`: requisito de ejecución como `depends_on`, contexto útil
sin orden de ejecución como `related_to`, y matiz no estructurable como mención
textual. Las relaciones se escribirán en un solo change porque el backlink se
deriva automáticamente.

Alternativas descartadas:

- Tipos `extends`, `split-from` o un objeto por relación: añaden taxonomía y
  decisiones de modelado antes de observar una necesidad que vaya más allá de
  la descubribilidad.
- Reutilizar `depends_on`: convertiría una afinidad documental en un bloqueo
  operativo falso.
- Exigir la relación en ambos changes: duplica verdad y permite inconsistencias.

## Specification

### CR1 — Declarar una relación local no bloqueante
- **Given** dos changes locales `A` y `B` sin dependencias y `A` con `related_to: [B]`
- **When** se ejecuta `changeledger check`
- **Then** la relación es válida
- **And** `A` y `B` conservan su elegibilidad de lifecycle independientemente del estado del otro

### CR2 — Validar la forma y los destinos locales
- **Given** un change local `A`
- **When** `related_to` no es una lista, referencia un id local inexistente o contiene el id de `A`
- **Then** `changeledger check` falla respectivamente con `related_to must be a list`, `related_to references missing change "<id>"` o `related_to cannot reference its own change "<id>"`

### CR3 — Admitir referencias externas y ciclos relacionales
- **Given** `A` relacionado con `other-project:20260701-090000` y dos changes locales `B` y `C` relacionados entre sí
- **When** se ejecuta `changeledger check`
- **Then** la referencia externa no se exige localmente
- **And** el ciclo relacional entre `B` y `C` no produce un error de ciclo de dependencias

### CR4 — Resolver relaciones salientes y entrantes en contexto
- **Given** `A` con `related_to: [B, "other-project:20260701-090000"]` y `C` con `related_to: [A]`
- **When** se ejecuta `changeledger context A`
- **Then** aparece una sección `Related changes` separada de `Dependencies`
- **And** `B` aparece como `outgoing` con id, título y estado
- **And** `C` aparece como `incoming` con id, título y estado
- **And** la referencia externa aparece como `outgoing` y `external reference (not resolved locally)`

### CR5 — Mostrar relaciones sin confundirlas con dependencias
- **Given** un repositorio con `A related_to B` y `C depends_on B`
- **When** se abre el detalle de `A`, `B` o `C` y se expanden sus referencias
- **Then** el detalle presenta componentes separados `Related changes` y `Dependencies`, cada uno con su contador
- **And** cada change local muestra id, título, tipo, estado y owner cuando existe
- **And** toda la fila abre el detalle del change referenciado al hacer clic
- **And** el detalle de `A` y `B` enlaza la relación aunque solo `A` la declare
- **And** el grafo dibuja `A—B` como arista no dirigida y discontinua
- **And** dibuja `B→C` como dependencia dirigida con el estilo existente

### CR6 — Mejorar y hacer navegable el historial de graduación
- **Given** una spec con `graduated_from: [A, B, "20990101-000000"]`
- **When** se abre la spec y se expande `Graduation history`
- **Then** el summary muestra `3`
- **And** `A` y `B` muestran id, título, tipo, estado y owner cuando existe
- **And** hacer clic en `A` o `B` abre el detalle de ese change
- **And** el id inexistente aparece como `unavailable` sin navegación

### CR7 — Navegar referencias externas
- **Given** una dependencia o relación `other-project:20260701-090000` y el proyecto registrado en el viewer
- **When** se expande el componente y se hace clic en la referencia
- **Then** el viewer navega al detalle del change `20260701-090000` en `other-project`
- **And** si el proyecto no está registrado, la referencia permanece visible como externa y el viewer informa que no puede resolverla

### CR8 — Generar y documentar el campo canónico
- **Given** un repositorio ChangeLedger
- **When** se ejecuta `changeledger new feature example "Ejemplo"`
- **Then** el frontmatter generado contiene `related_to: []` inmediatamente después de `depends_on: []`
- **And** el contexto de especificación define `related_to` como vínculo no bloqueante y `depends_on` como requisito de ejecución
- **And** instruye al agente a clasificar cada resultado relevante de `changeledger search` durante Investigation como `depends_on`, `related_to` o mención textual
- **And** indica que una relación local se declara una sola vez porque el backlink entrante es derivado

## Plan

- [x] Escribir primero tests de validación y extender `src/check.mjs` para `related_to`; verify: `node --test test/check.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-18T12:38:14Z`
- [x] Escribir primero tests de contexto y extender `src/commands/context.mjs` para relaciones salientes y backlinks locales; verify: `node --test test/context.test.mjs` (CR4)
  - **Resolved:** `2026-07-18T12:39:09Z`
- [x] Escribir primero tests del modelo y del componente expandible común, y extender `src/viewer/domain.mjs` y `src/viewer/public/view-parts.js`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR5, CR6, CR7)
  - **Resolved:** `2026-07-18T12:41:34Z`
- [x] Escribir primero tests del grafo y extender `src/viewer/public/view-renderers.js` y sus estilos; verify: `node --test test/viewer-metadata.test.mjs` (CR5)
  - **Resolved:** `2026-07-18T12:41:34Z`
- [x] Escribir primero tests del scaffold y actualizar `src/commands/new.mjs` y `templates/contract/spec.md`; verify: `node --test test/cli-bin.test.mjs test/context.test.mjs` (CR8)
  - **Resolved:** `2026-07-18T12:44:26Z`
- [x] Ejecutar el gate completo `pnpm verify` (support)
  - **Resolved:** `2026-07-18T12:45:11Z`
- [x] Escribir primero un test del contexto de autoría y exigir en `templates/contract/spec.md` la clasificación de resultados de búsqueda y la declaración unilateral; verify: `node --test test/context.test.mjs` (CR8)
  - **Resolved:** `2026-07-20T10:11:59Z`

## Log

- **2026-07-18T10:54:56Z** `[note]` Draft autorizado por el humano a partir de uso real: requerimientos divididos y extensiones posteriores quedan hoy sin trazabilidad salvo que se falsee `depends_on`.
- **2026-07-18T11:08:26Z** `[note]` Refinamiento solicitado por el humano: dependencias y relaciones adoptan el componente expandible del historial de graduación, con metadatos y navegación; el historial de specs se mejora con el mismo patrón.
- **2026-07-18T11:14:57Z** `[note]` Decisión humana: el componente visual es común, pero la procedencia de specs usa `graduated_from`, no `related_to`; este change depende del bug de procedencia estructurada `20260718-111457`.
- **2026-07-18T11:18:32Z** `[status]` draft → approved
- **2026-07-18T12:36:44Z** `[status]` approved → in-progress
- **2026-07-18T12:36:44Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-18T12:44:26Z** `[note]` CR8 completado: el scaffold genera related_to inmediatamente después de depends_on y el contrato distingue vínculos no bloqueantes de requisitos de ejecución; tests focalizados 113/113.
- **2026-07-18T12:45:11Z** `[note]` Implementación completa: validación, contexto, componente expandible común, navegación local/externa, grafo relacional, scaffold y contrato; pnpm verify pasó con 700/700 tests y 200 changes válidos.
- **2026-07-18T12:45:11Z** `[status]` in-progress → in-review
- **2026-07-18T12:51:59Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-20T10:10:22Z** `[validation]` in-validation → in-progress (agent rejected): El flujo de autoría crea related_to vacío pero no exige clasificar los resultados de search ni poblar relaciones no bloqueantes durante Investigation.
- **2026-07-20T10:11:59Z** `[note]` Corrección de validación: el contexto de autoría ahora exige clasificar cada resultado relevante de search como depends_on, related_to o mención textual, y declara una sola vez las relaciones locales; test focalizado 38/38.
- **2026-07-20T10:11:59Z** `[status]` in-progress → in-review
- **2026-07-20T10:14:31Z** `[review]` in-review → in-validation (delegated subagent, clean context)
