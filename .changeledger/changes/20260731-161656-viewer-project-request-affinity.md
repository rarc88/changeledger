---
id: "20260731-161656"
title: Completar la afinidad de proyecto en el viewer
type: bug
status: done
created: 2026-07-31T16:16:56Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260627-111218", "20260627-111219", "20260728-141643", "20260728-141859"]
owner: Roberto Ruiz
release_impact: patch
---

## Request

El viewer administra varios proyectos y ejecuta lecturas y mutaciones
asíncronas. Una respuesta iniciada para el proyecto A no debe aplicarse después
de que la selección o el detalle visible haya cambiado a B. La carga principal
ya protege parte de esa frontera, pero referencias Git, configuración
administrada y mutaciones del registro todavía pueden usar estado global leído
después de un `await` o aceptar un target cuya ruta cambió.

## Investigation

`load()` captura `state.currentProject` y usa `repoRequestRevision`; los flujos
de status añadidos por `20260728-141643` también comprueban el proyecto antes y
después de recargar. Sin embargo, `loadGitRefs(id)` solicita refs usando el
proyecto vigente y, al resolver, renderiza sobre el `#git-section` que exista en
ese momento sin comprobar proyecto, change ni generación. Las operaciones de
configuración administrada mantienen `managedProject`/`managedConfig` globales,
y `registry.update/remove` no ofrecen compare-and-swap sobre la ruta que el
cliente observó.

La rama histórica `codex/state-replica-v2` resolvió la clase completa con targets
capturados, contadores latest-wins, procedencia `project_id`/`repository_path`
en payloads y precondiciones de registry. Desde entonces `20260728-141643` y
`20260728-141859` reimplementaron parte de la protección para carga, status y
navegación Ledger; este change debe conservarla y cerrar solo las continuaciones
que siguen abiertas.

`20260627-111218` introdujo la administración de proyectos y
`20260627-111219` la persistencia del estado del viewer. Son contexto terminado;
no hay dependencia de ejecución.

## Specification

### CR1 — Referencias Git no cruzan proyecto ni detalle
- **Given** una petición de refs para el change A1 del proyecto A que permanece pendiente
- **When** el usuario cambia al proyecto B o abre otro detalle antes de que responda A1
- **Then** la respuesta tardía de A1 no renderiza ni limpia la sección Git visible
- **And** solo la petición más reciente para el proyecto y change todavía visibles puede aplicarse

### CR2 — Configuración administrada usa un target capturado
- **Given** una lectura o mutación de configuración iniciada para el proyecto A
- **When** `managedProject` cambia a B antes de que termine el `await`
- **Then** la respuesta de A no reemplaza `managedConfig` ni muestra éxito/error bajo B
- **And** la petición conserva el id y la ruta de A capturados al iniciarse

### CR3 — El registry rechaza una ruta observada obsoleta
- **Given** que el viewer leyó el proyecto A en `/old` y el registry ahora lo asocia a `/new`
- **When** intenta reparar o eliminar A enviando `repository_path: /old`
- **Then** el servidor responde `409` con `project registry changed; reload before writing`
- **And** no actualiza ni elimina la entrada `/new`

### CR4 — Respuestas resueltas declaran su procedencia
- **Given** una operación HTTP cuyo servidor resolvió un proyecto registrado
- **When** responde con éxito o con un error posterior a esa resolución
- **Then** el payload incluye el `project_id` y `repository_path` efectivos
- **And** el cliente descarta el payload si no coincide con el target capturado

### CR5 — Las protecciones existentes no retroceden
- **Given** dos cargas de repo A y B que responden en orden inverso o una mutación de status cuyo proyecto cambia durante la recarga
- **When** terminan las continuaciones asíncronas
- **Then** se conservan las reglas latest-wins y las comprobaciones de proyecto existentes
- **And** el estado visible corresponde únicamente al proyecto actualmente seleccionado

## Plan

- [x] Escribir primero regresiones DOM de refs tardías y ligar cada petición al proyecto, change y generación capturados
  - **Target:** `src/viewer/public/app.js`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR5
  - **Resolved:** `2026-07-31T18:33:01Z`
- [x] Escribir primero regresiones de configuración administrada tardía y centralizar targets capturados en el cliente
  - **Target:** `src/viewer/public/app.js`, `src/viewer/public/api.js`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR4, CR5
  - **Resolved:** `2026-07-31T18:33:05Z`
- [x] Añadir compare-and-swap por ruta a update/remove del registry y propagar conflictos HTTP con procedencia
  - **Target:** `src/registry.mjs`, `src/viewer/domain.mjs`, `src/viewer/server/router.mjs`, `test/registry.test.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/registry.test.mjs test/view.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-31T18:19:03Z`
- [x] Ejecutar la matriz integrada de carreras del viewer y el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-31T18:34:33Z`

## Log
- **2026-07-31T16:30:56Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T18:08:50Z** `[status]` approved → in-progress
- **2026-07-31T18:19:09Z** `[note]` CR3/CR4 servidor red→green: update y remove obsoletos mutaron o borraron la entrada reubicada antes del arreglo; CAS por repository_path y procedencia HTTP pasaron 104/104. Mutantes de ambos guards, mismatch del router y atribución de dominio fallaron por la razón esperada y se restauraron por edición.
- **2026-07-31T18:33:10Z** `[note]` CR1/CR2/CR4/CR5 cliente red→green: refs tardías sobrescribieron o limpiaron otro detalle; config tardía reemplazó el target; status y repo omitieron repository_path. Targets capturados, generaciones y receipts con procedencia pasaron 110/110. Mutantes de guardas de refs, latest-wins, procedencia y ruta de status fallaron por la razón esperada y se restauraron por edición.
- **2026-07-31T18:34:39Z** `[note]` Gate integrado del candidato: Biome limpio, 1066/1066 tests y changeledger check válido.
- **2026-07-31T18:34:50Z** `[status]` in-progress → in-review
- **2026-07-31T18:35:52Z** `[note]` Mandato de revisión: auditoría completa del rango baseline..HEAD y de toda la superficie gobernada por CR1–CR5.
- **2026-07-31T18:43:48Z** `[review]` in-review → in-progress (retry): CR4 permite aplicar receipts resueltos sin project_id/repository_path, validation/reopen muestra errores HTTP con procedencia ajena antes de validarla y los catches genéricos del router pierden procedencia en errores posteriores a resolver el proyecto; exigir procedencia completa en receipts resueltos, validarla antes de éxito/error y atribuir los 500 post-resolution con regresiones adversariales.
- **2026-07-31T18:51:02Z** `[note]` Corrección de CR4: el error atribuido extranjero y el éxito sin procedencia fallaron antes del matcher estricto; los 500 de config/repo resolvidos carecieron de identidad antes del tracking por request. Cliente pasó 112/112, router 94/94 y gate completo Biome limpio, 1071/1071 tests y check válido.
- **2026-07-31T18:51:07Z** `[note]` Mandato de revisión de confirmación: spot check de los tres defectos CR4 señalados — error extranjero, receipt resuelto sin procedencia y 500 post-resolution — y regresiones introducidas por su corrección.
- **2026-07-31T18:51:22Z** `[status]` in-progress → in-review
- **2026-07-31T18:53:58Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-31T21:28:45Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-31T21:29:42Z** `[graduation]` spec: `viewer.md`
- **2026-07-31T21:29:42Z** `[archive]` archived
