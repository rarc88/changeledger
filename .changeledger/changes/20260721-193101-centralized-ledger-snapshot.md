---
id: "20260721-193101"
title: Centralizar el snapshot completo del ledger
type: feature
status: in-validation
created: 2026-07-21T19:31:01Z
depends_on: ["20260721-195318", "20260721-195659"]
owner: Roberto Ruiz
related_to: ["20260613-205854", "20260623-235628", "20260711-103758", "20260718-111457", "20260721-195319"]
release_impact: major
---

## Request

Los changes están ligados hoy a la rama de código desde la que se crearon. Esto
impide que dos personas o agentes consulten una vista común y vigente del
proyecto. Separar solamente los changes tampoco resuelve el problema completo:
la configuración, las specs graduadas y los releases participan en las mismas
validaciones y pueden quedar en revisiones incompatibles.

ChangeLedger necesita una autoridad Git compartida que reúna todo el estado
mutable del ledger en un único snapshot. El código, el contrato del agente y
los templates continúan versionados con el producto; el historial operativo y
la verdad graduada deben poder leerse y buscarse desde cualquier rama de código.

## Investigation

`loadRepo` y sus consumidores componen hoy la vista desde el filesystem del
worktree. `list`, `show`, `search`, `context`, `check`, el viewer, la graduación
y los releases asumen que changes, specs, configuración y manifests pertenecen
a la misma revisión. El prototipo preservado en `codex/global-state-branch`
(`6ac08826`) movió solo los changes a otra rama y tuvo que reconstruir una
autoridad cruzada: changes desde la rama de estado, config y specs desde la rama
de integración y graduación repartida entre ambas. Esa composición multiplicó
los casos de inconsistencia y dejó la validación dependiente de la config local
de cada clon.

La capa de specs de `20260613-205854`, los releases de `20260623-235628`, la
búsqueda de `20260711-103758` y la procedencia de specs de `20260718-111457` son
capacidades terminadas que deben conservarse. Son contexto, no prerrequisitos
de ejecución: este change cambia dónde se obtiene su snapshot, no redefine sus
formatos funcionales.

Alternativas descartadas:

- **Mover únicamente changes:** mantiene dos autoridades y hace que graduar o
  registrar un release requiera coordinar commits entre ramas.
- **Agregar todas las ramas de trabajo a las consultas:** no decide qué copia
  de un id es vigente y convierte cada lectura en una reconciliación.
- **Servicio o base de datos obligatorios:** ofrecerían consistencia central,
  pero violan el núcleo local-first y añaden operación, autenticación y red al
  camino mínimo.
- **Worktree permanente de estado:** expone una copia modificable y obliga a
  coordinar checkouts; Git ya permite leer y construir árboles sin checkout.

## Proposal

La ref pública fija `refs/heads/changeledger/state` contendrá un árbol exclusivo
del ledger. En v1 el nombre no será configurable: una convención única elimina
resolución, migraciones y diagnósticos que no aportan valor probado.

```text
refs/heads/changeledger/state
└── .changeledger-state/
    ├── manifest.yml
    ├── config.yml
    ├── changes/
    ├── specs/
    └── releases/
```

`manifest.yml` declara `format_version` y `project_id`; no intenta contener el
SHA del commit que lo contiene, porque esa referencia sería circular. El
baseline exacto vive en el recibo de activación de la rama de código.
`config.yml` es la configuración canónica usada para interpretar ese mismo
árbol. Changes, specs y releases conservan sus formatos actuales y sus paths
relativos debajo de `.changeledger-state/`; un directorio de colección ausente
equivale a una colección vacía porque Git no versiona directorios vacíos.

Un commit de la ref es la unidad completa de lectura, validación y escritura.
Una operación carga una revisión exacta, produce otro árbol completo y ejecuta
`check` sobre esa revisión antes de crear el commit. Graduar actualiza el change
y la spec en el mismo commit; registrar un release actualiza el manifest y los
changes relacionados en el mismo commit. Ningún comando combina config de un
worktree con documentos de otro snapshot.

Una nueva interfaz interna `LedgerStore` separará el dominio de su ubicación:
el adaptador `worktree` conservará el comportamiento de repositorios legacy y
el adaptador `state` leerá objetos Git. Los comandos consultarán un solo
`LedgerSnapshot` inmutable que incluye revisión, config, changes, specs y
releases. La selección del adaptador será explícita y fallará cerrada; nunca se
usará el worktree como fallback cuando la autoridad de estado esté activa.

La misma frontera gobernará todas las escrituras. La implementación mantendrá
una matriz exhaustiva para evitar que un comando nuevo o poco frecuente siga
escribiendo el worktree por accidente:

| Familia | Operaciones incluidas |
|---|---|
| creación | `new` |
| lifecycle | `status`, `approve`, `review`, `validation`, `reopen`, `owner`, `discard`, `archive`, `log`, `task` |
| bulk | `archive --graduated` y todas las variantes mutadoras de `fix` |
| verdad durable | `graduate --into`, `graduate --skip` y releases |
| configuración | edición CLI/viewer de la config canónica |

En modo state, cada invocación entrega una operación de dominio a
`LedgerStore.mutate`; ninguna de esas rutas llama directamente a un writer del
worktree. Una operación bulk preflighta todos sus documentos y produce un solo
snapshot sucesor o ninguno. `graduate --new --to <file>` es la excepción
deliberada: exporta una superficie local de edición y no modifica la autoridad.
El bug general `20260721-195318` establece primero el guard de schemas futuros;
la recuperación legacy de `20260721-195319` conserva la seguridad del modo
anterior mientras los repositorios todavía no hayan migrado.

Las búsquedas y el contexto del agente usarán el mismo snapshot que `check` y
el viewer. Toda salida de lectura expondrá la revisión confirmada y su frescura
cuando el modo state esté activo, sin hacer red implícitamente. La forma de
actualizar esa revisión pertenece al change posterior del protocolo de réplica.

La edición prolongada de una spec seguirá ocurriendo en un archivo normal de la
rama de trabajo. `graduate --new --to <file>` exportará una semilla y
`graduate --into --from <file>` importará la versión final, revalidando y
commiteando change+spec de manera atómica en el snapshot. El archivo de trabajo
es una superficie de edición, nunca una segunda autoridad.

## Specification

### CR1 — Snapshot canónico completo
- **Given** un repositorio con autoridad de estado activa en el commit `S1`
- **When** ChangeLedger carga el ledger
- **Then** obtiene manifest, config, changes, specs y releases exclusivamente del árbol de `S1`
- **And** rechaza el snapshot si falta manifest o config, o si su `project_id` no corresponde al repositorio
- **And** interpreta la ausencia de un directorio de colección como una colección vacía

### CR2 — Lecturas coherentes desde cualquier rama
- **Given** dos worktrees del mismo repositorio en ramas de código diferentes y ambos con revisión confirmada `S1`
- **When** ejecutan `list`, `show`, `search`, `context`, `check` o cargan el viewer
- **Then** producen resultados funcionalmente equivalentes a partir de `S1`
- **And** la salida identifica `S1` como revisión del ledger sin mezclar documentos del worktree

### CR3 — Compatibilidad legacy explícita
- **Given** un repositorio que no activó la autoridad de estado
- **When** ejecuta un comando existente
- **Then** el adaptador worktree conserva el comportamiento actual
- **And** no crea, descubre ni activa `changeledger/state` por su mera existencia remota
- **Given** un repositorio con autoridad de estado activa pero inaccesible o inválida
- **When** intenta leer o mutar el ledger
- **Then** falla cerrado y no usa los archivos legacy como fallback
- **And** el baseline debe ser un OID completo que nombre directamente un objeto commit, nunca un tag, tree, blob, ref o expresión de revisión

### CR4 — Graduación atómica y editable
- **Given** un change `done` de `S1` y una spec preparada en `<file>`
- **When** se ejecuta `graduate <id> <slug> --into --from <file>`
- **Then** el nuevo snapshot contiene la spec final, su procedencia y la resolución de graduación del change en un único commit
- **And** un fallo de validación no publica ni change ni spec
- **And** `--new --to <file>` no cambia la autoridad hasta ejecutar `--into`

### CR5 — Releases atómicos
- **Given** changes elegibles y una revisión `S1`
- **When** se registra un release
- **Then** el manifest de release y toda actualización relacionada del ledger pertenecen al mismo sucesor de `S1`
- **And** una lectura nunca observa el release sin sus decisiones de cierre asociadas

### CR6 — Validación ligada a la revisión
- **Given** un snapshot de estado en `S1`
- **When** se ejecuta `check` o se prepara una mutación
- **Then** la configuración y todos los documentos validados provienen de `S1`
- **And** el resultado incluye la revisión validada
- **And** cambiar la config local del worktree no altera el resultado

### CR7 — Layout cerrado y portable
- **Given** un commit candidato para `changeledger/state`
- **When** se valida su árbol
- **Then** solo admite `.changeledger-state/manifest.yml`, `.changeledger-state/config.yml` y los directorios `changes`, `specs` y `releases`
- **And** usa las mismas reglas de paths, encoding y parsing en repositorios SHA-1 y SHA-256

### CR8 — Cobertura completa de mutaciones
- **Given** una autoridad state confirmada en `S1`
- **When** se ejecuta cualquier operación mutadora de la matriz de creación, lifecycle, bulk, verdad durable o configuración
- **Then** la operación lee y escribe exclusivamente mediante `LedgerStore` sobre `S1`
- **And** todo su conjunto de documentos aparece en un único sucesor válido o no aparece ninguno
- **And** un fallo no modifica archivos legacy del worktree ni deja parte de una operación bulk aplicada
- **And** el resultado identifica la revisión creada para que el protocolo de réplica determine si está confirmada o pendiente
- **And** toda mutación state exige la revisión exacta observada y rechaza que la autoridad avance antes o después de su preflight
- **And** el viewer captura ese recibo al renderizar cada decisión y distingue la revisión del snapshot de la revisión del contenido de configuración
- **And** una invocación con intención de escritura y preflight vacío linealiza `S1 → S1` sin crear commit, mientras dry-runs, previews y exportaciones locales permanecen read-only

## Plan

- [x] Añadir tests fallidos del contrato `LedgerSnapshot` y crear `src/ledger-store.mjs` con adaptadores worktree/state de solo lectura; verify: `node --test test/ledger-store.test.mjs` (CR1, CR2, CR3, CR6, CR7)
  - **Resolved:** `2026-07-21T21:30:19Z`
- [x] Migrar `src/repo.mjs`, `src/commands/search.mjs`, `src/commands/check.mjs` y el payload del viewer al snapshot único; verify: `node --test test/repo.test.mjs test/search.test.mjs test/check.test.mjs test/view.test.mjs` (CR2, CR3, CR6)
  - **Resolved:** `2026-07-21T21:33:11Z`
- [x] Añadir una prueba parametrizada de la matriz mutadora y migrar `src/commands/new.mjs`, `src/commands/agent.mjs`, `src/commands/fix.mjs` y las mutaciones de config del viewer a `LedgerStore.mutate`; verify: `node --test test/ledger-mutations.test.mjs test/agent.test.mjs test/fix.test.mjs test/view.test.mjs` (CR3, CR8)
  - **Resolved:** `2026-07-21T22:38:55Z`
- [x] Añadir primero tests de mutación atómica y adaptar graduación/specs en `src/commands/graduate.mjs` al snapshot único y al flujo `--to/--from`; verify: `node --test test/graduate.test.mjs test/ledger-store.test.mjs` (CR4)
  - **Resolved:** `2026-07-21T22:38:55Z`
- [x] Añadir primero tests de release atómico y adaptar `src/commands/release.mjs`; verify: `node --test test/release.test.mjs test/ledger-store.test.mjs` (CR5)
  - **Resolved:** `2026-07-21T22:38:55Z`
- [x] Validar layout y object format en fixtures SHA-1/SHA-256 y documentar el formato en `.changeledger/specs/architecture.md` y `.changeledger/specs/data-model.md`; verify: `node --test test/ledger-store.test.mjs && changeledger check` (CR1, CR7)
  - **Resolved:** `2026-07-22T09:56:55Z`
- [x] Hacer que `src/ledger-store.mjs` derive el delta efectivo del árbol y que `src/viewer/domain.mjs` preserve config semánticamente idéntica, manteniendo dry-runs y exportaciones read-only; verify: `node --test --test-name-pattern='effective identity|already-resolved task|identical raw config|config (empty patch|identity value patch)' test/ledger-store.test.mjs test/ledger-mutations.test.mjs` (CR8)
  - **Resolved:** `2026-07-22T09:37:08Z`
- [x] Ejecutar regresiones legacy y el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-21T22:41:40Z`

## Log

- **2026-07-21T19:31:01Z** `[note]` Draft v2 creado desde dev; el prototipo en codex/global-state-branch@6ac08826 queda como evidencia y cantera de tests, no como base de merge.
- **2026-07-21T21:24:26Z** `[status]` draft → approved
- **2026-07-21T21:25:59Z** `[status]` approved → in-progress
- **2026-07-21T21:25:59Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-21T21:30:19Z** `[note]` Añadido LedgerStore de lectura: snapshots state inmutables desde objetos Git, layout cerrado y adaptación worktree legacy.
- **2026-07-21T21:33:11Z** `[note]` Los lectores loadRepo, search, check y viewer consumen un único snapshot y exponen la revisión state.
- **2026-07-21T21:43:01Z** `[note]` Añadida transacción LedgerStore: árbol candidato validado, commit Git condicionado a S1 y layout state exclusivo.
- **2026-07-21T21:45:33Z** `[note]` Introducida la frontera común de mutación y migrado status al snapshot state; el resto de la matriz continúa pendiente.
- **2026-07-21T21:58:14Z** `[note]` Migradas lifecycle review, validation, reopen, owner, discard, archive, log y task; archive --graduated ahora publica un único snapshot state; agent context lee state.
- **2026-07-21T22:00:18Z** `[note]` Migrado new al snapshot state y convertido fix, incluidas variantes bulk, en operaciones de un único sucesor.
- **2026-07-21T22:06:14Z** `[note]` El viewer resuelve decisiones de lifecycle desde LedgerStore en modo state y conserva la tolerancia legacy a documentos ajenos no parseables.
- **2026-07-21T22:18:10Z** `[note]` Añadidas transacciones state para release init/record y graduation --skip; graduación --into queda como siguiente unidad atómica.
- **2026-07-21T22:19:23Z** `[note]` Graduation --into en modo state actualiza change y spec en un único sucesor validado.
- **2026-07-21T22:38:55Z** `[note]` Completada la matriz mutadora state: lifecycle, bulk, config CLI/viewer, graduación --to/--from y releases publican un único sucesor; añadidos fixtures SHA-1/SHA-256 y documentación del layout.
- **2026-07-21T22:41:40Z** `[note]` Gate completo superado: pnpm verify (774 tests, lint y check).
- **2026-07-21T22:41:41Z** `[status]` in-progress → in-review
- **2026-07-21T22:53:34Z** `[review]` in-review → in-progress (retry): La revisión independiente confirmó cinco incumplimientos: guard de schema futuro no ligado a la transacción, context/register fuera de la autoridad state, regex de layout no escapada, revisiones ausentes en salidas y slug no validado en --new --to.
- **2026-07-21T23:00:22Z** `[note]` Corregidas las cinco observaciones de revisión: guards de schema transaccionales, context/register ligados al snapshot state, layout literal cerrado, revisión/frescura en salidas y validación de slug al exportar.
- **2026-07-21T23:00:22Z** `[status]` in-progress → in-review
- **2026-07-21T23:10:05Z** `[review]` in-review → in-progress (retry): check --commits aún elude la autoridad state; las salidas de lectura state no exponen revisión/frescura de forma consistente; y el preflight bulk no está ligado al único snapshot que LedgerStore.mutate publica.
- **2026-07-21T23:15:56Z** `[note]` Corregida la segunda revisión: check --commits usa la autoridad state, todas las superficies de lectura detectadas reportan revisión/frescura y los preflights bulk exigen la revisión exacta S1.
- **2026-07-21T23:15:56Z** `[status]` in-progress → in-review
- **2026-07-21T23:24:55Z** `[review]` in-review → in-progress (retry): El descubrimiento global del viewer aún lee config legacy; lifecycle puede cruzar de S1 a S2 concurrente; y algunas salidas state sin resultados, incluido archive --graduated y graduate --new --to, omiten revisión/frescura.
- **2026-07-21T23:28:36Z** `[note]` Corregida la tercera revisión: discovery y búsquedas globales del viewer conservan autoridad/procedencia state, todas las mutaciones fijan su S1 y los no-op/export reportan revisión y frescura.
- **2026-07-21T23:28:36Z** `[status]` in-progress → in-review
- **2026-07-21T23:36:25Z** `[review]` in-review → in-progress (retry): El viewer no enlaza al mutar la revisión observada ni muestra revisión/frescura, y authority.baseline acepta referencias simbólicas móviles; corregir CAS de viewer, procedencia visible y OID exacto con regresiones.
- **2026-07-21T23:44:57Z** `[note]` Corregida la cuarta revisión: el viewer transmite y fija la revisión observada para lifecycle, muestra revisión/frescura en vistas normales y búsquedas globales incluso vacías, y el recibo exige un OID completo de commit; arquitectura y regresiones actualizadas.
- **2026-07-21T23:44:57Z** `[status]` in-progress → in-review
- **2026-07-21T23:50:52Z** `[review]` in-review → in-progress (retry): El baseline debe ser un objeto commit, no un tag/blob/tree pelable; el viewer debe capturar la revisión al renderizar cada decisión lifecycle y enlazar también todas las lecturas/mutaciones de config a ese snapshot, con matriz de carreras completa.
- **2026-07-22T00:12:04Z** `[note]` Refactor de hardening completado: baseline validado como objeto commit directo, LedgerStore exige expectedRevision, y el viewer captura recibos inmutables separados para ledger/config con matriz completa de carreras antes/después del preload. Gate completo: pnpm verify (811 tests, lint y 211 changes válidos).
- **2026-07-22T00:12:08Z** `[status]` in-progress → in-review
- **2026-07-22T00:20:30Z** `[review]` in-review → in-progress (retry): CR8 permite éxito obsoleto si una transacción no-op cruza un avance concurrente interno, y migration preview no exige ni devuelve config_revision junto con ledger_revision.
- **2026-07-22T00:25:13Z** `[note]` Cerrados los dos huecos CR8 finales: las transacciones state sin escrituras linealizan mediante CAS S1→S1, y migration preview exige y devuelve config_revision junto con ledger_revision. Gate completo: pnpm verify (814 tests, lint y 211 changes válidos).
- **2026-07-22T00:25:17Z** `[status]` in-progress → in-review
- **2026-07-22T00:33:19Z** `[review]` in-review → blocked: CR8: archive --graduated sin selección y las variantes de fix sin candidatos omiten LedgerStore.mutate, por lo que no linealizan el no-op y pueden devolver el recibo S1 después de que la autoridad publique S2. Stop-loss alcanzado: requiere decidir si se autoriza una corrección transversal final de todos los bypasses no-op.
- **2026-07-22T00:36:14Z** `[status]` blocked → in-progress
- **2026-07-22T00:46:35Z** `[note]` Auditoría transversal final completada: todo write-intent state, incluidos archive --graduated vacío, las tres variantes de fix sin candidatos y config migrate ya vigente, linealiza S1 mediante CAS; dry-runs, previews y exportación local permanecen read-only. Gate: Biome, 821 tests y 211 changes válidos.
- **2026-07-22T00:46:40Z** `[status]` in-progress → in-review
- **2026-07-22T01:01:28Z** `[review]` in-review → blocked: CR8 sigue incompleto: escrituras de contenido idéntico (por ejemplo task done ya resuelto y saves de config sin cambios) se registran como writes y crean commits de árbol idéntico, en vez de linealizar S1 → S1; el inventario y sus regresiones no cubren esta clase general de no-op.
- **2026-07-22T09:30:51Z** `[note]` El humano autoriza reanudar tras el stop-loss. La corrección se limita a la propiedad transversal de delta efectivo en LedgerStore y a impedir reserializaciones semánticamente vacías; no se ampliará con parches por entrypoint.
- **2026-07-22T09:30:54Z** `[status]` blocked → in-progress
- **2026-07-22T09:37:20Z** `[note]` Corrección de frontera completada: LedgerStore compara árbol fuente y candidato para colapsar todo delta efectivo vacío a CAS S1→S1; config evita writes byte-idénticos y preserva YAML ante patches semánticamente idénticos. Verificación: 6/6 invariantes y 207/207 familias afectadas.
- **2026-07-22T09:37:23Z** `[status]` in-progress → in-review
- **2026-07-22T09:47:34Z** `[review]` in-review → blocked: CR7 no es portable: LedgerStore enumera con git ls-tree --name-only y separa por salto de línea, por lo que core.quotePath altera nombres no ASCII y los paths con newline rompen el framing; el mismo snapshot puede cargar o fallar según la configuración Git local en SHA-1 y SHA-256.
- **2026-07-22T09:51:58Z** `[note]` El humano autoriza corregir CR7 y exige terminar el descubrimiento antes del review. Se auditarán todas las fronteras Git que emiten o consumen paths y se usará framing NUL independiente de core.quotePath.
- **2026-07-22T09:52:03Z** `[status]` blocked → in-progress
- **2026-07-22T09:56:55Z** `[note]` Corregida CR7 en la frontera Git: ls-tree usa framing NUL raw y una gramática explícita de paths. La matriz adversarial cubre Unicode, comillas, backslash, tab, CR, newline y dos puntos con core.quotePath true/false en SHA-1/SHA-256; lectura y mutación pasan.
- **2026-07-22T09:58:14Z** `[status]` in-progress → in-review
- **2026-07-22T10:07:11Z** `[review]` in-review → in-validation (delegated subagent, clean context)
