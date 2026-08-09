---
id: "20260809-113241"
title: Import idempotente por ref
type: feature
status: done
created: 2026-08-09T11:32:41Z
depends_on: ["20260808-151643"]
reviewed: true
branch: feature/20260809-113241
related_to: ["20260809-113240"]
owner: rarc88
release_impact: minor
---

## Request

`changeledger import --from <ref>`: absorción incremental, explícita e
idempotente, de una ref por invocación hacia la ref de estado de un repo
activado. Cubre con el mismo comando las ramas en vuelo al momento de la
migración (equipos con changes en ramas de desarrollo) y los documentos
rezagados que lleguen después del corte. Un conflicto entre el import y la ref
de estado se reporta y lo decide el humano; no hay resolución automática ni
formato de plan editable.

Excluido explícitamente (techo de `global-state-scope`): adopción desde fuentes
múltiples en una sola operación y la maquinaria de resolución derivada de que
dos fuentes discrepen; el import absorbe exactamente una ref por invocación.

## Investigation

- El formato de la fuente es el layout de worktree: la ref importada es una
  rama (típicamente creada antes del corte, o rezagada tras él) cuyo tree
  contiene `.changeledger/changes|specs|releases`. No se importan refs en
  formato de estado.
- La identidad de un documento se deriva del contenido, no del filename
  (modelo del migrador v2, `contentIdentity`/`documentIdentity`): un change es
  su `id`, un spec su nombre, un release su versión.
- El camino de escritura ya existe y es CAS: `mutateState`
  (`src/state-store.mjs`, de `20260808-151643`); el import aplica todo su
  resultado como una única mutación atómica.
- "El Log solo crece": toda mutación del ciclo de vida añade una entrada al
  `## Log` del change, así que la relación de prefijo entre Logs ordena dos
  versiones del mismo documento sin diff semántico. El migrador v2 nunca
  implementó esto — su única igualdad era el blob byte-idéntico y todo lo
  demás conflicto — de modo que la comparación por extensión estricta es
  capacidad nueva, no un port.
- Bugs heredados del inventario v2 como criterios: MIG-04 (la ref debe
  resolver a un commit; un tag anotado se rechaza, nunca se peela) y MIG-05
  (determinismo: la misma ref produce el mismo resultado en cada invocación).
- `config.yml` queda fuera del import: en activo la autoridad de config es la
  copia de la ref de estado, y una rama en vuelo lleva una copia
  potencialmente obsoleta; importarla silenciosamente sería una segunda
  verdad.

## Proposal

Algoritmo de una pasada, sin estado intermedio:

1. Resolver `<ref>` y asertar que es un commit (MIG-04).
2. Leer `.changeledger/` de su tree y validar todos los documentos con las
   reglas de `checkRepo` antes de clasificar nada.
3. Clasificar cada documento contra el snapshot actual por identidad:
   - no existe en el snapshot → **alta**;
   - byte-idéntico → **no-op**;
   - change cuyo Log del snapshot extiende estrictamente al importado →
     **no-op** (ya absorbido);
   - change importado cuyo Log extiende estrictamente al del snapshot →
     **actualización** al contenido importado;
   - cualquier otra combinación (mismo Log con contenido distinto, Logs
     divergentes, specs/releases con contenido distinto) → **conflicto**.
4. Si hay al menos un conflicto: reportarlos todos con identidad y causa, no
   escribir nada, exit distinto de cero.
5. Si no: aplicar altas y actualizaciones en una única `mutateState` cuyo
   mensaje registra la ref y el commit importados. Sin nada que aplicar,
   no-op con exit 0.

La extensión estricta se define sobre las entradas del `## Log`: B extiende
estrictamente a A si las entradas de A son prefijo propio de las de B, en el
mismo orden. Specs y releases no tienen Log, así que su única igualdad es la
byte-idéntica; todo lo demás es conflicto para el humano.

Alternativas descartadas:

- Plan-file con resoluciones por variante (v2): es la UX del mundo
  multi-fuente excluido; aquí el conflicto se decide en conversación y se
  re-importa tras corregir la fuente o el estado.
- Merge semántico de Logs divergentes: reconciliación por inferencia,
  exactamente lo que el techo prohíbe.
- Aplicación parcial (importar lo limpio y dejar los conflictos): rompe la
  idempotencia observable y deja el resultado dependiente del orden de
  invocaciones; todo-o-nada es más simple y auditable.

Escenarios: alta nueva; re-ejecución idéntica; snapshot más nuevo; fuente más
nueva; mismo Log con cuerpo distinto; Logs divergentes; mezcla importable +
conflicto; spec/release nuevos y divergentes; config divergente ignorada; tag
anotado; documento inválido en la fuente; repo sin activar.

## Specification

### CR1 — Alta de un documento nuevo
- **Given** un repo activado y una rama `feature-x` cuyo tree añade un change nuevo `20260101-000001` en formato worktree
- **When** se ejecuta `changeledger import --from feature-x`
- **Then** exit 0 y el snapshot de la ref de estado contiene `20260101-000001` byte-idéntico al de la rama

### CR2 — Re-ejecución idéntica es no-op
- **Given** el import de CR1 ya aplicado
- **When** se vuelve a ejecutar `changeledger import --from feature-x`
- **Then** exit 0 informando de que no hay nada que absorber y la revisión de la ref de estado no cambia

### CR3 — El snapshot ya absorbió la fuente
- **Given** un change presente en la fuente y en el snapshot, donde el Log del snapshot contiene las entradas del Log importado como prefijo propio (el snapshot siguió avanzando)
- **When** se ejecuta el import
- **Then** ese documento se clasifica como no-op y el snapshot conserva su versión, con exit 0

### CR4 — La fuente es estrictamente más nueva
- **Given** un change cuyo Log importado contiene las entradas del Log del snapshot como prefijo propio
- **When** se ejecuta el import
- **Then** exit 0 y el snapshot queda con el contenido importado del documento

### CR5 — Mismo Log con contenido distinto es conflicto
- **Given** un change presente en fuente y snapshot con entradas de Log idénticas pero cuerpo distinto
- **When** se ejecuta el import
- **Then** exit distinto de cero reportando el id del change y la causa (contenido divergente sin avance de Log) y la ref de estado queda intacta

### CR6 — Logs divergentes son conflicto
- **Given** un change cuyos Logs de fuente y snapshot comparten prefijo pero divergen después
- **When** se ejecuta el import
- **Then** exit distinto de cero reportando el id y la divergencia, con la ref de estado intacta

### CR7 — Todo o nada
- **Given** una fuente con un documento nuevo importable y otro en conflicto según CR5
- **When** se ejecuta el import
- **Then** exit distinto de cero reportando el conflicto y la ref de estado no cambia: el documento importable tampoco se aplica

### CR8 — Specs y releases sin Log: idéntico o conflicto
- **Given** una fuente con un spec nuevo, un release byte-idéntico y un spec existente con contenido distinto
- **When** se ejecuta el import
- **Then** exit distinto de cero reportando el spec divergente como conflicto
- **And** tras alinear ese spec en la fuente, re-ejecutar el import da de alta el spec nuevo, deja el release como no-op y termina con exit 0

### CR9 — El config de la fuente se ignora
- **Given** una fuente cuyo `.changeledger/config.yml` difiere del config del snapshot
- **When** se ejecuta un import sin otros conflictos
- **Then** exit 0, el config del snapshot queda intacto y el reporte no menciona conflicto de config

### CR10 — Una ref que no es commit se rechaza
- **Given** un tag anotado `v-import` apuntando al commit de la fuente
- **When** se ejecuta `changeledger import --from v-import`
- **Then** exit distinto de cero indicando que la ref no resuelve a un commit, sin escribir nada

### CR11 — Documento inválido en la fuente
- **Given** una fuente con un change sin heading `## Log`
- **When** se ejecuta el import
- **Then** exit distinto de cero nombrando el documento y el problema de validación, con la ref de estado intacta

### CR12 — Repo no activado
- **Given** un repo sin activación
- **When** se ejecuta `changeledger import --from <ref>`
- **Then** exit distinto de cero explicando que el import requiere un repo activado

## Plan

- [x] Lectura y validación de la fuente: resolución de ref con aserción de
  commit, parseo del layout de worktree e identidad por contenido
  - **Target:** `src/commands/import.mjs`
  - **Verify:** `node --test test/import.test.mjs`
  - **Criteria:** CR10, CR11, CR12
  - **Resolved:** `2026-08-09T13:31:16Z`
- [x] Clasificación por documento contra el snapshot: alta, no-op, extensión
  estricta de Log y las tres formas de conflicto
  - **Target:** `src/commands/import.mjs`
  - **Verify:** `node --test test/import.test.mjs`
  - **Criteria:** CR1, CR3, CR4, CR5, CR6, CR8, CR9
  - **Resolved:** `2026-08-09T13:31:16Z`
- [x] Aplicación atómica todo-o-nada vía `mutateState` e idempotencia
  observable de la invocación completa
  - **Target:** `src/commands/import.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/import.test.mjs`
  - **Criteria:** CR2, CR7
  - **Resolved:** `2026-08-09T13:31:16Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T13:31:16Z`

## Log
- **2026-08-09T11:55:07Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T13:12:34Z** `[status]` approved → in-progress
- **2026-08-09T13:12:34Z** `[branch]` set: feature/20260809-113241 (auto)
- **2026-08-09T13:31:17Z** `[status]` in-progress → in-review
- **2026-08-09T13:31:17Z** `[note]` Mandato del review: auditoría completa del diff cerrado baseline..HEAD (comando nuevo import.mjs + wiring), con las decisiones no especificadas del implementador como puntos de escrutinio, en particular: config del snapshot como autoridad de layout y reglas (un source con changes_dir recolocado queda invisible al import); update escrito en el path del snapshot ante renombres (sin CR que lo cubra); duplicación deliberada de readLedgerAt/toPosix respecto a cutover.mjs por veto de archivo; identidad duplicada dentro del source como fail-fast; documento del snapshot que no parsea reportado como corrupción.
- **2026-08-09T13:40:54Z** `[review]` in-review → in-progress (retry): Con cero documentos visibles en el source (ref sin .changeledger/ o con changes_dir recolocado), el reporte dice '0 document(s) already absorbed' con exit 0: la cláusula es falsa — nada fue absorbido porque nada fue visto — y llevaría a un operador a borrar la rama creyéndola importada. Corrección: distinguir 'el source no tiene documentos ChangeLedger en esta ref' de 'todo lo del source ya está publicado', con test. El exit 0 no cambia (CR2 lo fija); la política sobre changes_dir recolocado y la deduplicación de readLedgerAt van al humano, no a este retry.
- **2026-08-09T13:48:11Z** `[status]` in-progress → in-review
- **2026-08-09T13:48:12Z** `[note]` Mandato del review de confirmación: acotado al diff sin commitear de la corrección (src/commands/import.mjs +14, test/import.test.mjs +61/-2) — verificar que el defecto nombrado quedó cerrado (mensaje de cero documentos visibles distinguible de 'ya absorbido', exit 0 intacto) y el test del renombre que mata al mutante superviviente; sin regresiones; lo latente se reporta como follow-up.
- **2026-08-09T13:54:54Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T14:00:20Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-09T14:00:51Z** `[graduation]` spec: `architecture.md`
