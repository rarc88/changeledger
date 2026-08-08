---
id: "20260808-142200"
title: Rescatar el techo de alcance del estado global a INTENT.md
type: chore
status: draft
created: 2026-08-08T14:22:00Z
depends_on: []
related_to: []
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
de intención: no toca código, specs ni contrato.

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

- [ ] Redactar la sección «Alcance del estado global» en `INTENT.md` de `dev`,
      partiendo del texto de `codex/state-replica-v2:INTENT.md` y aplicando
      las seis enmiendas del Request; conservar tono y estructura del
      `INTENT.md` vigente
  - **Target:** `INTENT.md`
  - **Verify:** verify: lectura humana de la sección contra la lista del Request
- [ ] Gate del repo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**

## Log

- **2026-08-08T14:22:00Z** `[note]` Draft creado tras la conversación que fijó
  la dirección del tercer intento: etapas 0-3, sync por contrato, adopción por
  import de fuente única y enforcement remoto fuera. El texto fuente del techo
  se conserva en `codex/state-replica-v2:INTENT.md` (~línea 112); no borrar
  esas ramas hasta que la etapa 1 rescate también el núcleo
  (`ledger-store`/`state-store`/`git-batch`) que reutilizará.
