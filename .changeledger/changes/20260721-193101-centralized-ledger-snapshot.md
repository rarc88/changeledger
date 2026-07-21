---
id: "20260721-193101"
title: Centralizar el snapshot completo del ledger
type: feature
status: in-progress
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

## Plan

- [x] Añadir tests fallidos del contrato `LedgerSnapshot` y crear `src/ledger-store.mjs` con adaptadores worktree/state de solo lectura; verify: `node --test test/ledger-store.test.mjs` (CR1, CR2, CR3, CR6, CR7)
  - **Resolved:** `2026-07-21T21:30:19Z`
- [ ] Migrar `src/repo.mjs`, `src/commands/search.mjs`, `src/commands/check.mjs` y el payload del viewer al snapshot único; verify: `node --test test/repo.test.mjs test/search.test.mjs test/check.test.mjs test/view.test.mjs` (CR2, CR3, CR6)
- [ ] Añadir una prueba parametrizada de la matriz mutadora y migrar `src/commands/new.mjs`, `src/commands/agent.mjs`, `src/commands/fix.mjs` y las mutaciones de config del viewer a `LedgerStore.mutate`; verify: `node --test test/ledger-mutations.test.mjs test/agent.test.mjs test/fix.test.mjs test/view.test.mjs` (CR3, CR8)
- [ ] Añadir primero tests de mutación atómica y adaptar graduación/specs en `src/commands/graduate.mjs` al snapshot único y al flujo `--to/--from`; verify: `node --test test/graduate.test.mjs test/ledger-store.test.mjs` (CR4)
- [ ] Añadir primero tests de release atómico y adaptar `src/commands/release.mjs`; verify: `node --test test/release.test.mjs test/ledger-store.test.mjs` (CR5)
- [ ] Validar layout y object format en fixtures SHA-1/SHA-256 y documentar el formato en `.changeledger/specs/architecture.md` y `.changeledger/specs/data-model.md`; verify: `node --test test/ledger-store.test.mjs && changeledger check` (CR1, CR7)
- [ ] Ejecutar regresiones legacy y el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-21T19:31:01Z** `[note]` Draft v2 creado desde dev; el prototipo en codex/global-state-branch@6ac08826 queda como evidencia y cantera de tests, no como base de merge.
- **2026-07-21T21:24:26Z** `[status]` draft → approved
- **2026-07-21T21:25:59Z** `[status]` approved → in-progress
- **2026-07-21T21:25:59Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-21T21:30:19Z** `[note]` Añadido LedgerStore de lectura: snapshots state inmutables desde objetos Git, layout cerrado y adaptación worktree legacy.
