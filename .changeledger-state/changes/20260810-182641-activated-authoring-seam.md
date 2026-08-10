---
id: "20260810-182641"
title: Costura de autoría de documentos en modo activado
type: feature
status: in-progress
created: 2026-08-10T18:26:41Z
depends_on: []
branch: feature/20260810-182641
related_to: ["20260810-181801", "20260810-180434", "20260810-181803", "20260808-151643"]
owner: claude
---

## Request

Hallazgo de la 2ª ronda del experimento de activación (2026-08-10): en un
repo activado no existe ninguna vía soportada para escribir la PROSA de un
documento del ledger. `new` scaffoldea en la ref, el lifecycle
(`status`/`log`/`task`/`owner`) muta sus campos, y las rutas de escritura
del viewer son solo status/config/path/remove — pero el cuerpo no tiene
camino de escritura.

Requisito de diseño fijado por el humano (2026-08-10): **nada de commits a
cuentagotas en la ref de estado**. El journal es permanente — reescribirlo
rompería el CAS y, con sync, a todos los clones — así que cada entrada debe
ser un evento con significado: un documento aterriza COMPLETO y cada edición
posterior es un guardado deliberado, como ya hace `import` (todo-o-nada, un
commit). Estados intermedios a medio escribir no entran nunca en la ref.

Este documento reemplaza a `20260810-181801`, que se descarta: su propio
Specification no podía completarse in situ precisamente por el hueco que
describe.

## Investigation

Hechos ejecutados durante el experimento y su secuela (2026-08-10):

- **Sin camino de cuerpo:** el catálogo del CLI (`changeledger help`) no
  tiene comando de edición de documento; las rutas POST del viewer
  (`WRITE_ROUTES`, `src/viewer/server/router.mjs`) son
  status/project-config/config-patch/config-migrate-apply/path/remove.
- **`new` activado publicó un scaffold vacío** en la ref (commit de journal
  `bd6bf6c6`, draft `20260810-180434`): el documento quedó sin Request y sin
  vía para rellenarlo. Ese draft sigue vacío y es el primer dogfood de esta
  costura.
- **`import --from` no es un editor:** valida la fuente completa
  (auto-consistente: headings de stages activas y referencias resolubles) y
  absorbe todo-o-nada, pero un documento ya existente con contenido distinto
  es conflicto → humano, por diseño del techo. Probado: sirvió para absorber
  5 drafts nuevos en un commit, y no puede actualizar ninguno.
- **Consecuencia viva:** `20260810-181803` menciona un change sin declararlo
  en `related_to` (warning de `check`) y no puede corregirse: el frontmatter
  tampoco tiene camino de escritura.
- **La costura de escritura ya existe por debajo:**
  `mutateLedgerFile`/`writeLedgerFiles` (`src/change-store.mjs`,
  `20260808-151643`) es el único punto que decide worktree vs commit CAS. El
  comando nuevo la consume; no se crea una segunda verdad de escritura.
- **La graduación en activado necesita esto mismo:** `graduate --into`
  escribe el enlace y `updated`, pero reconciliar el CUERPO de una spec es
  una edición de documento — sin costura, la primera graduación
  post-activación queda bloqueada (razonado del overlay de cierre; no
  ejecutado).
- **Observación colateral (follow-up aparte, no de este change):**
  `changeledger approve` aceptó un feature con Investigation/Proposal/
  Specification/Plan vacíos — la severidad `approved` valida estructura,
  no contenido de stages.

## Proposal

Un comando nuevo, `changeledger edit <change-id|spec:slug> --from <file|->`,
que reemplaza el documento COMPLETO (frontmatter + cuerpo) con el contenido
leído de un archivo o stdin:

- **Activado:** aterriza como UN commit CAS `edit: <id>` vía
  `mutateLedgerFile`. **Inactivo:** reescribe el archivo del worktree
  atómicamente, sin ningún commit — mismo comando, misma semántica en ambos
  modos, cero goteo en ambos.
- **Guardas antes de escribir, nada aterriza si fallan:** el documento
  entrante se valida completo (la misma severidad que `check` aplica al
  status vigente). `id` y `created` son inmutables. Los campos con comando
  propio — `status`, `owner`, `branch` — deben coincidir con el valor
  vigente y el rechazo nombra al comando dueño: `edit` escribe contenido,
  nunca lifecycle. `title`, `depends_on`, `related_to` y `release_impact`
  son contenido editable.
- **Idempotente:** contenido byte-idéntico al vigente = no-op con exit 0,
  journal inmóvil.
- **`new` en activado deja de publicar scaffolds:** sin `--from <file>`
  falla con error accionable (componer el documento y pasarlo); con
  `--from`, el documento completo aterriza en un solo commit. `--print`
  (ambos modos) emite el scaffold a stdout para componer sin escribir nada.
  En inactivo `new` conserva su comportamiento de worktree.
- **Specs editables** por `spec:<slug>` con las mismas guardas (frontmatter
  mínimo de spec): desbloquea la reconciliación de graduación en activado.

Alternativas descartadas:

- Editor en el viewer: superficie mucho mayor para el mismo resultado y el
  autor primario del cuerpo es el agente; puede venir después como
  integración, consumiendo esta misma costura.
- Permitir a `import` actualizar documentos existentes: rompe el
  "conflicto → humano" que el techo fija; import queda como absorción, no
  como editor.
- Edición por secciones (`--section`): más API para el mismo resultado; el
  reemplazo completo es la unidad que garantiza documentos enteros y cero
  estados intermedios en la ref.

Excluido: edición de releases, agrupamiento de mutaciones de lifecycle (se
mide aparte contra el presupuesto de INTENT si el humano lo pide) y
cualquier editor visual.

Escenarios: rellenar el draft vacío `20260810-180434`; corregir el
`related_to` de `20260810-181803`; `new --from` en activado; graduación con
reconciliación de spec en activado; el mismo flujo en un repo inactivo.

## Specification

### CR1 — edit reemplaza el documento completo con un solo commit CAS
- **Given** un repo activado y un archivo con el documento completo y válido de un change existente en la ref, con cuerpo distinto al vigente
- **When** se ejecuta `changeledger edit <id> --from <archivo>`
- **Then** el documento en la ref queda byte-idéntico al archivo, el journal de la ref gana exactamente un commit (`edit: <id>`) y `show <id>` sirve el contenido nuevo

### CR2 — Un documento inválido no aterriza
- **Given** un archivo cuyo contenido rompe la validación del documento (p. ej. heading de stage fuera de orden o CR malformado)
- **When** se ejecuta `changeledger edit <id> --from <archivo>`
- **Then** el comando falla con exit distinto de cero nombrando el defecto y la ref queda inmóvil (mismo oid antes y después)

### CR3 — Los inmutables y los campos con comando dueño se rechazan
- **Given** un archivo que cambia `id` o `created`, o que trae `status`, `owner` o `branch` distintos del valor vigente
- **When** se ejecuta `changeledger edit <id> --from <archivo>`
- **Then** el rechazo nombra el campo y, para los campos con comando propio, el comando dueño (`status`/`owner`/`branch`); nada se escribe

### CR4 — Idempotencia byte a byte
- **Given** un archivo byte-idéntico al documento vigente
- **When** se ejecuta `changeledger edit <id> --from <archivo>`
- **Then** exit 0 sin escribir: el journal de la ref no gana ningún commit

### CR5 — Simetría en modo inactivo
- **Given** un repo inactivo con un change en el worktree
- **When** se ejecuta `changeledger edit <id> --from <archivo>` con las mismas guardas violadas y respetadas de CR1-CR3
- **Then** el comportamiento es el mismo — reemplazo atómico del archivo del worktree en el caso válido, rechazo idéntico en los inválidos — y no se crea ningún commit en ninguna ref

### CR6 — new activado no publica vacíos
- **Given** un repo activado
- **When** se ejecuta `changeledger new` sin `--from`
- **Then** falla con error accionable sin escribir nada en la ref
- **And** con `--from <archivo completo>` el documento aterriza en un solo commit, y `--print` emite el scaffold a stdout sin escribir en ningún modo

### CR7 — Las specs se editan por slug
- **Given** un repo activado con una spec existente en la ref
- **When** se ejecuta `changeledger edit spec:<slug> --from <archivo>` con un cuerpo reconciliado
- **Then** la spec queda reemplazada en un solo commit con las mismas garantías de validación e idempotencia que los changes

## Plan

- [x] Núcleo de `edit` para changes: lectura de archivo/stdin, validación
  completa, guardas de inmutables y campos con dueño, aterrizaje por
  `mutateLedgerFile`
  - **Target:** `src/commands/edit.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/edit.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-08-10T20:38:07Z`
- [x] Simetría del camino inactivo
  - **Target:** `src/commands/edit.mjs`
  - **Verify:** `node --test test/edit.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-08-10T20:39:24Z`
- [x] `new` activado: `--from` obligatorio, `--print` en ambos modos
  - **Target:** `src/commands/new.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/edit.test.mjs test/cli.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-10T20:42:22Z`
- [x] Specs por `spec:<slug>`
  - **Target:** `src/commands/edit.mjs`
  - **Verify:** `node --test test/edit.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-08-10T20:43:30Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T20:54:27Z`

## Log
- **2026-08-10T20:29:18Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T20:29:19Z** `[status]` approved → in-progress
- **2026-08-10T20:29:19Z** `[branch]` set: feature/20260810-182641 (auto)
- **2026-08-10T20:29:19Z** `[owner]` set: claude
- **2026-08-10T20:54:27Z** `[note]` edit consume mutateLedgerFile: guardas y validacion completa antes de la escritura, byte-identico = no-op sin commit; misma ruta en activado (1 commit CAS) e inactivo (reemplazo atomico, 0 commits)
- **2026-08-10T20:54:27Z** `[note]` Decision no fijada por el documento: archived y reviewed se anaden a status/owner/branch como campos con comando dueno (archive/review) — son lifecycle, y el principio 'edit escribe contenido, nunca lifecycle' los cubre
- **2026-08-10T20:54:28Z** `[note]` Decision no fijada por el documento: en spec nada es inmutable; graduated_from es el unico campo con comando dueno (graduate). title, tags, updated y cuerpo son contenido editable
- **2026-08-10T20:54:28Z** `[note]` Decision no fijada por el documento: new --from toma id/created del documento (venidos de --print) y exige que type y title del CLI coincidan; el reintento con id nuevo ante conflicto CAS de 20260808-151643 CR4/CR10 queda retirado — el id ya no es del asignador
- **2026-08-10T20:54:56Z** `[note]` Retargeteados 3 tests de test/cli.test.mjs que fijaban el scaffold vacio en activado y su reintento CAS (20260808-151643 CR4/CR10): uno reescrito sobre scaffoldChange+newChangeFrom, dos retirados — la propagacion del conflicto ya esta fijada en change-store.test.mjs CR2
