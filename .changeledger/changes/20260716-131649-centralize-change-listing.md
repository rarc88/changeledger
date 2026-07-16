---
id: "20260716-131649"
title: Centralizar las consultas de changes en list
type: feature
status: done
created: 2026-07-16T13:16:49Z
depends_on: []
archived: true
reviewed: true
owner: Roberto Ruiz

---

## Request

Las consultas de colecciones de changes están repartidas entre `list`,
`graduate --pending` y `archive --graduated --dry-run`. Esta distribución hace
que humanos y agentes deban conocer de antemano comandos de acción para descubrir
trabajo pendiente; la ayuda de `graduate`, por ejemplo, se presenta como una
operación de graduación y no como un punto de consulta.

Centralizar en `changeledger list` todo lo relacionado con listar changes,
incluidos los pendientes de graduación o archivo. Ampliar sus filtros con
`owner`, porque el CLI se usa ya en proyectos con varias personas y se necesita
consultar de forma determinista el trabajo asignado y el no asignado.

## Investigation

- `list()` en `src/commands/agent.mjs` carga todos los changes, proyecta `owner`,
  pero solo filtra por `status` y `type`; además devuelve archivados sin exponer
  el campo `archived`, por lo que el consumidor no puede distinguirlos.
- `pendingGraduation()` en `src/commands/graduate.mjs` vuelve a cargar y parsear
  el repositorio para seleccionar `status: done` con `reviewed !== true`. La
  consulta se expone como `changeledger graduate --pending`.
- `archiveGraduated()` en `src/commands/agent.mjs` contiene otra selección:
  `done`, `reviewed: true`, resolución de graduación en el Log y aún no
  archivado. `changeledger archive --graduated --dry-run` reutiliza una operación
  mutadora en modo simulación para obtener ese listado.
- El resultado es una misma responsabilidad implementada en tres caminos, con
  formatos y mensajes diferentes. La lógica de elegibilidad para archivo queda
  además privada dentro del mutador y no tiene cobertura directa independiente.
- Los antecedentes `20260613-205852`, `20260613-222912`, `20260614-165720` y
  `20260616-212322` añadieron respectivamente `list`, owner, pendientes de
  graduación y archivado masivo. Cada change resolvió su necesidad local, pero
  no existía aún el uso multiusuario que revela la fragmentación actual.
- `search` es descubrimiento lexical sobre changes y specs, `show` consulta una
  entidad, `check` diagnostica y `release plan` calcula una release. No son
  sustitutos de `list` ni deben absorberse en esta reorganización.

## Proposal

Convertir `changeledger list` en la superficie canónica para seleccionar y
listar changes. Todos sus filtros son combinables salvo pares explícitamente
excluyentes:

- `--status <status>` y `--type <type>` conservan su semántica.
- `--owner <name>` selecciona por valor exacto de owner; `--unowned` selecciona
  la ausencia de owner. Son mutuamente excluyentes.
- `--pending <graduation|archive>` selecciona, respectivamente, changes `done`
  cuya decisión de graduación no está revisada, o changes `done` con graduación
  resuelta que aún no están archivados.
- Sin opción de visibilidad, `list` devuelve solo changes no archivados.
  `--archived` devuelve solo archivados y `--all` incluye ambos; son mutuamente
  excluyentes.
- La salida JSON conserva los campos actuales y añade `archived`, de modo que
  `--all --json` sea inequívoco.

`graduate` queda dedicado a `--new`, `--into` y `--skip`; se elimina
`--pending`. `archive` conserva el archivado individual y la acción masiva
`--graduated`, pero elimina `--dry-run`: su previsualización canónica pasa a ser
`changeledger list --pending archive`. La operación masiva y `list` comparten el
mismo predicado de elegibilidad para evitar divergencias.

Es una limpieza deliberada de la interfaz pública, sin aliases ni compatibilidad
silenciosa. Las ayudas de `graduate` y `archive` remiten a las consultas de
`list`; el contexto operativo y la documentación usan exclusivamente la nueva
sintaxis.

Alternativas descartadas:

- Conservar las opciones actuales como aliases: mantiene dos maneras de hacer
  la misma consulta y perpetúa la ambigüedad que origina el change.
- Crear un comando `pending`: separaría nuevamente una clase de listado de
  `list` y haría más difícil combinar owner, type y status.
- Integrar `search` en `list`: buscar contenido rankeado y filtrar una colección
  son operaciones distintas, con salidas y consumidores diferentes.

## Specification

### CR1 — Listar pendientes de graduación
- **Given** los changes `A` (`done`, sin `reviewed`), `B` (`done`, `reviewed: true`) y `C` (`in-validation`, sin `reviewed`)
- **When** se ejecuta `changeledger list --pending graduation`
- **Then** la salida incluye `A`
- **And** la salida no incluye `B` ni `C`

### CR2 — Listar pendientes de archivo
- **Given** `A` (`done`, `reviewed: true`, Log con `graduado a spec \`api.md\``, no archivado), `B` (`done`, `reviewed: true`, Log con `graduation skipped`, no archivado) y `C` igual que `A` pero con `archived: true`
- **When** se ejecuta `changeledger list --pending archive`
- **Then** la salida incluye `A` y `B`
- **And** la salida no incluye `C`

### CR3 — Filtrar por owner
- **Given** `A` con `owner: Roberto Ruiz`, `B` con `owner: raruiz-hiberuscom` y `C` sin owner
- **When** se ejecuta `changeledger list --owner "Roberto Ruiz"`
- **Then** la salida incluye solo `A`
- **And** la comparación del owner es exacta

### CR4 — Listar trabajo sin owner
- **Given** `A` con `owner: Roberto Ruiz` y `B` sin owner
- **When** se ejecuta `changeledger list --unowned`
- **Then** la salida incluye solo `B`
- **And** combinar `--owner "Roberto Ruiz" --unowned` falla con un diagnóstico que indica que las opciones son mutuamente excluyentes

### CR5 — Combinar filtros
- **Given** changes de varios owners, tipos y estados
- **When** se ejecuta `changeledger list --owner "Roberto Ruiz" --status in-validation --type feature`
- **Then** aparecen exclusivamente los changes que cumplen simultáneamente los tres filtros

### CR6 — Visibilidad de archivados
- **Given** `A` sin `archived: true` y `B` con `archived: true`
- **When** se ejecuta `changeledger list`
- **Then** aparece `A` y no aparece `B`
- **And** `changeledger list --archived` muestra solo `B`
- **And** `changeledger list --all` muestra `A` y `B`
- **And** combinar `--archived --all` falla con un diagnóstico que indica que las opciones son mutuamente excluyentes

### CR7 — JSON identifica archivados
- **Given** un change `A` archivado y otro `B` no archivado
- **When** se ejecuta `changeledger list --all --json`
- **Then** cada objeto conserva `id`, `title`, `type`, `status`, `owner` y `progress`
- **And** `A` contiene `"archived": true` y `B` contiene `"archived": false`

### CR8 — Graduate deja de listar
- **Given** la nueva interfaz instalada
- **When** se ejecuta `changeledger graduate --pending`
- **Then** falla porque `--pending` ya no es una opción de `graduate`
- **And** `changeledger graduate --help` remite a `changeledger list --pending graduation`

### CR9 — Archive separa previsualización y acción
- **Given** changes elegibles para archivado masivo
- **When** se ejecuta `changeledger archive --graduated --dry-run`
- **Then** falla porque `--dry-run` ya no es una opción de `archive`
- **And** `changeledger archive --help` remite a `changeledger list --pending archive` para previsualizar
- **And** `changeledger archive --graduated` archiva exactamente el mismo conjunto que devuelve esa consulta inmediatamente antes de la acción

### CR10 — Pending valida su dominio
- **Given** cualquier repositorio ChangeLedger
- **When** se ejecuta `changeledger list --pending release`
- **Then** el comando falla con un diagnóstico que enumera exactamente `graduation` y `archive`

### CR11 — Contrato operativo actualizado
- **Given** un agente que ha leído `changeledger context` o `changeledger context spec`
- **When** necesita changes aprobados, pendientes de graduación o pendientes de archivo
- **Then** el contexto recomienda comandos `changeledger list` para las tres consultas
- **And** no recomienda `graduate --pending` ni `archive --graduated --dry-run`

## Plan

- [x] Escribir primero tests fallidos en `test/agent.test.mjs`, centralizar después los predicados y filtros en `src/commands/agent.mjs` y retirar `pendingGraduation()` de `src/commands/graduate.mjs`; verify: `node --test test/agent.test.mjs test/graduate.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR9, CR10) — 2026-07-16T13:26:33Z
- [x] Escribir primero tests fallidos en `test/cli-bin.test.mjs` y reorganizar después opciones, validación, salida y help en `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs test/agent.test.mjs test/graduate.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8, CR9, CR10) — 2026-07-16T13:26:33Z
- [x] Actualizar los fragmentos aplicables de `templates/contract/` y la documentación pública; verify: `pnpm test` (CR11) — 2026-07-16T13:26:33Z
- [x] Ejecutar el gate completo `pnpm verify` (support) — 2026-07-16T13:28:50Z

## Log

- **2026-07-16T13:16:49Z** — Draft autorizado tras observar que ni el humano ni varios agentes descubrieron cómo listar changes `done` pendientes de graduación o archivo. La revisión amplió el alcance a todas las consultas de colecciones de changes y al filtro multiusuario por owner.
- **2026-07-16T13:18:57Z** — status: draft → approved
- **2026-07-16T13:19:40Z** — status: approved → in-progress
- **2026-07-16T13:19:40Z** — owner → Roberto Ruiz (auto)
- **2026-07-16T13:28:55Z** — status: in-progress → in-review
- **2026-07-16T13:31:42Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-16T13:37:34Z** — validation → done (human accepted)
- **2026-07-16T13:39:27Z** — graduado a spec `lifecycle.md`
- **2026-07-16T13:39:36Z** — archived
