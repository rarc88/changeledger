---
id: "20260808-142200"
title: Rescatar el techo de alcance del estado global a una spec
type: chore
status: done
created: 2026-08-08T14:22:00Z
depends_on: []
reviewed: true
related_to: ["20260627-205034"]
owner: rarc88
---

## Request

Los dos intentos de estado global (`codex/global-state-branch`,
`codex/state-replica-v2`) se abandonaron por crecimiento sin techo: la feature
pasó de 4 changes planificados a 43, con ~80% de las líneas sirviendo a
preguntas que nadie hizo. El post-mortem de la v2 escribió la lección como
sección normativa de `INTENT.md` — «Alcance de la réplica de estado global»,
el techo de la capacidad: qué incluye, qué excluye y cómo se gobierna — pero
esa sección vive **solo en la rama abandonada** (`codex/state-replica-v2`,
`INTENT.md` desde la línea ~112). El `INTENT.md` de `dev` no conserva ninguna
lección de las ~27.000 líneas pagadas.

Decidido retomar la capacidad por etapas (conversación del 2026-08-08), el
paso cero es traer ese techo a `dev`, actualizado con las decisiones tomadas
hoy, antes de gastar una línea de código. Este change es solo documentación
de intención: no toca código ni contrato.

**Destino (enmienda 2026-08-08).** El techo no vuelve a `INTENT.md`: ese
archivo es la descripción del producto en palabras simples del humano, y un
techo normativo de ~60 líneas no es su registro — el error de ubicación fue de
la propia v2. El precedente correcto ya existe en este repo: el presupuesto de
complejidad y los no-goals de `INTENT.md` viven graduados como spec en
`.changeledger/specs/product-principles.md` (`20260627-205034`), que es la
superficie que los agentes descubren por la vía que el contrato obliga
(`changeledger search` antes de investigar). Tres piezas, separadas por
registro:

1. **`.changeledger/specs/global-state-scope.md`** — nueva spec con el techo
   completo: la verdad normativa consultable.
2. **`INTENT.md`** — un párrafo breve en palabras simples con la expectativa
   del humano (ver todos los changes actualizados sin saltar de rama, funcionar
   sin remoto, sincronización git puro); nada normativo.
3. **`AGENTS.md`** — una sola línea en las notas del proyecto mientras duren
   las etapas de construcción, apuntando a la spec y a la regla de detenerse;
   retirable al terminar las etapas. AGENTS.md se carga en todo contexto, así
   que el techo completo ahí sería un impuesto permanente contra la propia
   filosofía de presupuestos del repo.

La sección rescatada debe conservar del original: el problema observado (cada
checkout ve solo lo que su rama conoce), el techo como presupuesto de
complejidad aplicado, la integridad client-side fail-closed, las exclusiones
(adaptadores de enforcement por proveedor, afirmaciones de confianza sobre
servidores ajenos, modelos de trust, adopción multi-fuente, garantías SLO) y
las reglas de gobernanza (un hallazgo fuera del techo es change independiente
con su propio presupuesto; un change que necesite crecer se detiene y vuelve
al humano; un defecto se cierra a nivel de clase o no se cierra).

Y debe enmendar el original con lo decidido el 2026-08-08:

- **Sincronización por contrato, no automática.** El original exigía frescura
  automática («debe ocurrir sin que el humano la pida»). Se sustituye: la
  sincronización es git puro (`fetch`/`push` con compare-and-swap), opcional y
  best-effort — sin remoto todo funciona —, y su cadencia es una obligación
  del contrato que el agente ejecuta en puntos estratégicos (al cargar el
  contexto de un change, tras commitear una selección resuelta, en cierres de
  etapa); ante conflicto notifica y la resolución se coordina con el humano,
  nunca se resuelve en silencio.
- **El enforcement remoto sale del alcance.** El original lo admitía como
  extra opcional para servidores propios; fue una de las fuentes principales
  de complejidad de ambos intentos (el hook `pre-receive` y sus 886 líneas de
  validación/capabilities). Queda excluido: retomarlo exigiría un change
  propio con presupuesto propio, nunca una extensión.
- **Adopción concretada.** Fuente única y entrada incremental se materializan
  en dos operaciones del mismo camino de código: cutover one-shot desde la
  rama de integración, e `import --from <ref>` explícito e idempotente por
  ref — el mismo comando cubre las ramas en vuelo al momento de la migración
  (escenario de equipos) y los rezagados posteriores; un conflicto entre el
  import y la ref de estado se reporta y lo decide el humano.
- **Construcción por etapas con gate humano**, cada una utilizable y
  verificable por sí sola: (1) núcleo local — ref fija, lectura por snapshot
  compartida por CLI y viewer, mutación CAS, sin red; (2) adopción — cutover,
  import y activación independiente del checkout; (3) sincronización — la
  descrita arriba más sus fragmentos de contrato. Invariante transversal:
  inactivo por defecto — un repo sin activar se comporta idéntico a hoy.
- **Condiciones de beta adaptadas a las etapas**, sustituyendo los ítems
  ligados a la implementación v2 (receipts, multi-proyecto) por los gates de
  las tres etapas.

## Plan

- [x] Redactar la spec `global-state-scope.md` partiendo del texto de
      `codex/state-replica-v2:INTENT.md` (sección «Alcance de la réplica de
      estado global», ~línea 112) y aplicando las seis enmiendas del Request;
      formato y frontmatter como las specs vecinas (graduación formal al
      cierre del change)
  - **Target:** `.changeledger/specs/global-state-scope.md`
  - **Verify:** verify: lectura humana de la spec contra la lista del Request
  - **Resolved:** `2026-08-08T14:57:39Z`
- [x] Añadir a `INTENT.md` un párrafo breve, en palabras simples, con la
      expectativa del estado global; sin contenido normativo
  - **Target:** `INTENT.md`
  - **Verify:** verify: lectura humana — registro simple, remite a la spec
  - **Resolved:** `2026-08-08T14:57:40Z`
- [x] Añadir una línea a las notas de proyecto de `AGENTS.md` apuntando a la
      spec y a la regla de detenerse ante crecimiento fuera del techo
  - **Target:** `AGENTS.md`
  - **Verify:** verify: lectura humana — una sola línea, retirable tras las etapas
  - **Resolved:** `2026-08-08T14:57:40Z`
- [x] Gate del repo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-08-08T14:58:56Z`

## Log

- **2026-08-08T14:22:00Z** `[note]` Draft creado tras la conversación que fijó
  la dirección del tercer intento: etapas 0-3, sync por contrato, adopción por
  import de fuente única y enforcement remoto fuera. El texto fuente del techo
  se conserva en `codex/state-replica-v2:INTENT.md` (~línea 112); no borrar
  esas ramas hasta que la etapa 1 rescate también el núcleo
  (`ledger-store`/`state-store`/`git-batch`) que reutilizará.
- **2026-08-08T14:34:43Z** `[note]` Enmienda pre-aprobación (decisión humana 2026-08-08): el destino del techo deja de ser INTENT.md — pasa a la spec nueva global-state-scope.md siguiendo el precedente de product-principles.md, con un párrafo simple en INTENT.md y una línea temporal en AGENTS.md. Tres piezas confirmadas por Roberto.
- **2026-08-08T14:55:32Z** `[status]` draft → approved (human via conversation)
- **2026-08-08T14:55:57Z** `[status]` approved → in-progress
- **2026-08-08T14:58:56Z** `[note]` Implementación completa: spec global-state-scope.md creada (aviso 'orphan spec' esperado y autoresoluble — la graduación al cierre la reclama con --into), párrafo simple en INTENT.md remitiendo a la spec, y línea temporal en AGENTS.md. Gate completo en verde (check y verify exit 0).
- **2026-08-08T14:58:56Z** `[status]` in-progress → in-validation
- **2026-08-08T15:09:39Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-08T15:09:56Z** `[graduation]` spec: `global-state-scope.md`
