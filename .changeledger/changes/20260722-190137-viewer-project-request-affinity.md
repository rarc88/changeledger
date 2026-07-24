---
id: "20260722-190137"
title: Evitar que respuestas tardías del viewer crucen proyectos
type: bug
status: in-progress
created: 2026-07-22T19:01:37Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260627-111218", "20260627-111219"]
---

## Request

La auditoría de producción `20260721-193106` reprodujo que una respuesta lenta
del viewer puede cruzar proyectos. Si `load()` solicita A, el usuario cambia a
B y la respuesta de B llega primero, la llegada posterior de A reemplaza
`state.repo` aunque `state.currentProject` siga siendo B. La UI termina mostrando
la revisión y los changes de A bajo la selección visible B.

Cada operación asíncrona ligada a un proyecto debe conservar la afinidad del
target capturado al iniciarse y descartar respuestas obsoletas. El servidor y el
cliente deben transportar procedencia suficiente para que la UI pueda verificar
la atribución antes de aplicar un resultado.

## Investigation

`load()` (`src/viewer/public/app.js:93-111`) evalúa `state.currentProject` al
construir `getRepo(...)`, pero después del `await` ejecuta `setRepo(text)` sin
comparar el proyecto solicitado con la selección actual ni con una generación
de request. No existe cancelación ni regla latest-wins. Además, `serialize()` no
incluye `project_id`, por lo que el payload tampoco permite verificar afinidad.

Reproducción con el módulo real del viewer bajo JSDOM y `fetch` controlado:

1. bootstrap selecciona A e inicia `/api/repo?project=project-a`, retenido;
2. el selector cambia a B y `/api/repo?project=project-b` responde primero;
3. el estado queda correctamente `selected=B, rendered=B, revision=revision-b`;
4. se libera A y el estado termina `selected=B, rendered=A,
   revision=revision-a`.

La misma forma de carrera existe en otras continuaciones que leen globals tras
un `await`: `loadGitRefs` aplica refs usando el proyecto actual sin conservar el
target; `openManagedProject` puede sobrescribir `managedConfig` después de que
`managedProject` cambió; y callbacks de mutación de configuración capturan el
target de escritura, pero pueden aplicar su receipt al proyecto administrado
actual. Un guard exclusivo en `load()` dejaría superficies equivalentes
abiertas.

La capa de escritura del servidor no cruza paths: una prueba concurrente separó
correctamente una aprobación del viewer en A y un Log del CLI con cwd B. El
defecto está en la atribución/aplicación asíncrona del cliente, no en que el CLI
consuma la selección del viewer. Según `20260721-193106` es crítico porque una
respuesta queda atribuida al proyecto incorrecto y puede inducir una decisión
humana sobre otra verdad.

La revisión iterativa inicial no convirtió "todas las continuaciones" en un
inventario verificable y dejó que cada reviewer encontrase una frontera aislada.
La auditoría sistémica posterior inventarió cada `await`, import dinámico,
continuación detached, confirmación y callback temporizado del viewer. Además de
las rutas ya corregidas, identificó tres familias que deben cerrarse juntas:

1. `renderMetrics()` captura changes antes de cargar dinámicamente el módulo y
   puede renderizar A después de seleccionar B, volver A, cambiar filtros o salir
   de la vista.
2. Las generaciones observan `project_id`, pero un refresh del registry puede
   conservar ese id y cambiar `repository_path`; las continuaciones del path
   anterior siguen pareciendo vigentes para repo, detalle, Git, sync, status y
   configuración.
3. El preview de migración comprueba que hay revisiones, pero no que sean las
   revisiones exactas solicitadas; un guardado concurrente puede dejar visible un
   preview de R1 junto a la configuración R2.

La misma auditoría detectó cinco regresiones que usaban receipts incompletos y
podían pasar antes de alcanzar el guard cuya afinidad pretendían demostrar. El
criterio de salida exige fixtures válidos que fallen al retirar cada guard.

## Specification

### CR1 — La última selección gobierna la respuesta visible
- **Given** una lectura de A en vuelo y una selección posterior de B
- **When** B responde primero y A responde después
- **Then** la UI conserva repositorio, revisión y filtros de B
- **And** la respuesta obsoleta de A no muta cache, DOM ni estado persistido

### CR2 — Cada payload declara su identidad
- **Given** cualquier lectura de repositorio o configuración por proyecto
- **When** el servidor responde
- **Then** el receipt incluye el `project_id` y la revisión del ledger usados
- **And** el cliente rechaza o descarta una identidad distinta del target
  capturado
- **And** una operación ligada a una revisión solo acepta las revisiones exactas
  capturadas al iniciar la request

### CR3 — Latest-wins también dentro del mismo proyecto
- **Given** dos lecturas consecutivas del mismo proyecto con revisiones distintas
- **When** la respuesta más antigua llega al final
- **Then** no puede rebajar la UI ni `lastJson` a la revisión anterior
- **And** un cálculo asíncrono derivado de filtros o vista no puede reemplazar un
  cálculo posterior del mismo proyecto

### CR4 — Todas las continuaciones project-scoped conservan afinidad
- **Given** repo, Git refs, configuración, sync o mutación en vuelo para A
- **When** cambia la selección general o el proyecto administrado a B
- **Then** el resultado de A solo actualiza el contexto A todavía vigente o se
  descarta
- **And** errores, toasts y receipts identifican inequívocamente su target
- **And** cambiar el `repository_path` de un `project_id` invalida todas las
  continuaciones capturadas con el path anterior
- **And** imports dinámicos, confirmaciones y callbacks detached obedecen la
  misma regla que las requests HTTP

### CR5 — El CLI permanece independiente
- **Given** viewer seleccionado en A y un CLI cuyo cwd es B
- **When** ambas superficies leen o mutan concurrentemente
- **Then** la selección y las respuestas del viewer no cambian la resolución del
  CLI
- **And** refs, worktrees y receipts demuestran que cada operación tocó solo su
  repositorio

## Plan

- [x] Añadir en `test/viewer-metadata.test.mjs` un harness asíncrono del comportamiento de `src/viewer/public/app.js` que invierta respuestas A/B y dos revisiones de A; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR3)
  - **Resolved:** `2026-07-23T14:00:36Z`
- [x] Incorporar en `src/viewer/public/app.js` una identidad/generación de request capturada y aplicarla a repo, Git refs, config, sync y callbacks de mutación; verify: `node --test test/viewer-metadata.test.mjs test/view.test.mjs` (CR1, CR3, CR4)
  - **Resolved:** `2026-07-23T14:00:36Z`
- [x] Exponer `project_id` junto a la revisión desde `src/viewer/domain.mjs` y validarlo en `src/viewer/public/app.js`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR2, CR4)
  - **Resolved:** `2026-07-23T14:00:36Z`
- [x] Cubrir en `test/view.test.mjs` la concurrencia entre `src/viewer/domain.mjs` para A y `src/commands/agent.mjs` con cwd B, comprobando refs, worktrees y receipts; verify: `node --test test/view.test.mjs test/ledger-mutations.test.mjs` (CR5)
  - **Resolved:** `2026-07-23T14:00:36Z`
- [x] Ejecutar `pnpm verify` (support)
  - **Resolved:** `2026-07-23T14:02:18Z`
- [x] Inventariar todas las fronteras asíncronas de `src/viewer/public/app.js`, `src/viewer/public/api.js`, `src/viewer/domain.mjs` y `src/viewer/server/router.mjs`, clasificando target, generación, receipt, efectos posteriores y cobertura efectiva; verify: `node --test test/viewer-metadata.test.mjs test/view.test.mjs` (CR1, CR2, CR3, CR4)
  - **Resolved:** `2026-07-24T11:42:00Z`
- [x] Corregir en `src/viewer/public/app.js` las fronteras de métricas y en `test/viewer-metadata.test.mjs` las cinco fixtures que no alcanzan su guard, añadiendo regresiones A→B, A→B→A, latest-wins por filtros, salida de vista y error de import; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR3, CR4)
  - **Resolved:** `2026-07-24T13:03:03Z`
- [x] Incluir `repository_path` en `src/viewer/public/app.js`, `src/viewer/public/api.js`, `src/viewer/server/router.mjs`, `src/viewer/domain.mjs` y `src/registry.mjs`, invalidando selección, detalle y configuración cuando el registry rebindea el mismo id; verify: `node --test test/viewer-metadata.test.mjs test/view.test.mjs test/registry.test.mjs` (CR1, CR2, CR4)
  - **Resolved:** `2026-07-24T13:03:08Z`
- [x] Exigir en `src/viewer/public/app.js` las revisiones ledger/config exactas solicitadas por preview e invalidarlo cuando un save instala una revisión nueva; verify: `node --test test/viewer-metadata.test.mjs` para R1→save R2→late preview R1 y Apply (CR2, CR3, CR4)
  - **Resolved:** `2026-07-24T13:03:12Z`
- [x] Ejecutar formatter, suites afectadas, `pnpm verify`, `changeledger check` y `git diff --check` sobre el candidato sistémico antes de solicitar una sola revisión integral (support)
  - **Resolved:** `2026-07-24T13:05:59Z`
- [ ] Añadir tests rojos y devolver identidad (`project_id`+`repository_path`) en todos los payloads de error del viewer con proyecto resuelto —incluido 410 y los errores de status/config/preview/sync/repair/unregister— mediante un helper común en `src/viewer/domain.mjs`; los 404 de proyecto inexistente quedan sin identidad por incognoscible; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR2, CR4)
- [ ] Ejecutar el gate completo tras la reapertura; verify: `pnpm verify` (support)

## Log

- **2026-07-22T19:01:37Z** `[note]` Draft creado por el hallazgo crítico ISOL-02 de la auditoría 20260721-193106; reproducción determinista con el app real bajo JSDOM: selección B terminó mostrando payload/revisión de A.
- **2026-07-23T09:28:17Z** `[status]` draft → approved
- **2026-07-23T13:43:51Z** `[status]` approved → in-progress
- **2026-07-23T13:43:51Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T14:02:19Z** `[note]` Implementado: load()/loadGitRefs/openManagedProject y callbacks de mutación de config guardan target+seq y descartan respuestas obsoletas o de proyecto distinto (CR1/CR3/CR4); serialize() y readProjectConfigStructured ahora declaran project_id, validado en el cliente antes de aplicar (CR2); test CR5 confirma que domain.mjs (viewer) y agent.mjs (CLI, cwd distinto) nunca cruzan repos. pnpm verify verde (977 tests).
- **2026-07-23T14:02:19Z** `[status]` in-progress → in-review
- **2026-07-23T14:09:12Z** `[review]` in-review → in-progress (retry): CR4: saveRaw() onSuccess no guarda con managedProject===configTarget.project como sus 4 hermanos (saveForm/applyMigration/repair/unregister); una respuesta tardía de guardado raw para un proyecto abandonado puede sobrescribir la config del proyecto actualmente gestionado
- **2026-07-23T14:23:36Z** `[note]` Corrección tras fail-retry: saveRaw() ahora guarda con managedProject===configTarget.project como sus hermanos (saveForm/applyMigration/repair/unregister/previewMigration). Test de regresión agregado que confirma la corrupción de config_revision sin el guard y su ausencia con el fix. También se detectó y corrigió un gap del arnés de test: api.js lee window.__CHANGELEDGER_TOKEN__ pero viewer-metadata.test.mjs nunca exponía window como global, por lo que ningún test anterior ejercía de verdad un handler de mutación POST; se agregó globalThis.window. node --test + pnpm verify verdes (978 tests).
- **2026-07-23T14:23:44Z** `[status]` in-progress → in-review
- **2026-07-23T14:29:40Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T16:58:36Z** `[validation]` in-validation → in-progress (agent rejected): Doble auditoría confirma alcance incompleto: el handler de sync pierde afinidad tras el await (resultado de A mostrado bajo B, app.js:1779), falta latest-wins por secuencia para recargas del mismo proyecto (CR3, openManagedProject:1282), y el toast de éxito hereda type error por defecto (showToast:918). Corrección: centralizar afinidad target+secuencia y cubrir sync éxito/error A→B y doble carga A old/new.
- **2026-07-23T17:41:58Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T17:51:08Z** `[note]` Corrección implementada (sin commit hasta confirmación humana): syncReplicaState extraído con guard de afinidad post-await y atribución de proyecto en toasts; secuencia latest-wins en openManagedProject (configRequestSeq); showToast con options correcto; strings del viewer unificados a inglés incl. botón sync-state en index.html. 166 tests viewer en verde con red-green de los 4 escenarios.
- **2026-07-23T17:57:15Z** `[status]` in-progress → in-review
- **2026-07-23T18:00:03Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T19:19:55Z** `[note]` Humano confirma que la corrección resuelve el rechazo (conversación 2026-07-23); se committea.
- **2026-07-23T19:26:11Z** `[validation]` in-validation → in-progress (agent rejected): Auditoría integral post-corrección: re-seleccionar el mismo proyecto con la carga en vuelo incrementa configRequestSeq antes del early-return de caché (app.js:1312 vs :1321); la respuesta pendiente se descarta como stale y el panel queda en Loading configuration… sin fetch activo. Fix: mover el bump de secuencia tras los early-returns. Incluye además el residuo doc: README.md:142 aún dice Actualizar estado (botón renombrado a Sync state).
- **2026-07-23T19:30:18Z** `[note]` Corrección de la regresión: bump de configRequestSeq movido tras los early-returns (cache hit o proyecto no vivo ya no invalidan la request en vuelo); test rojo-verde del doble click mid-load con id único (estado de módulo persiste entre tests); README actualizado a Sync state. 167/167 viewer, gate completo verde.
- **2026-07-23T19:30:18Z** `[status]` in-progress → in-review
- **2026-07-23T19:32:22Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T19:55:52Z** `[note]` Humano confirma la corrección de auditoría (conversación 2026-07-23); se committea.
- **2026-07-23T20:25:39Z** `[validation]` in-validation → in-progress (agent rejected): Auditoría externa: syncReplicaState re-chequea afinidad tras el POST pero no tras await load(); el toast de A aparece bajo B (repro: State updated for Alpha bajo project-b). Corrección: token de afinidad centralizado {project, sequence} verificado en CADA frontera asíncrona del handler, con tests que cambian de proyecto en cada await.
- **2026-07-23T20:31:51Z** `[note]` Corrección 3 (sin commit hasta confirmación humana): factory affinityLane(live) centraliza el token {target, secuencia por lane}; syncReplicaState re-chequea en cada frontera async (post-POST, post-load, error path); openManagedProject migrado al mismo helper preservando el fix del cache-hit; configRequestSeq eliminado. 169 tests viewer verdes, rojo-verde en los 2 escenarios nuevos.
- **2026-07-23T20:34:10Z** `[status]` in-progress → in-review
- **2026-07-23T20:37:21Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T20:45:40Z** `[note]` Humano confirma la corrección (conversación 2026-07-23); se committea.
- **2026-07-23T22:55:00Z** `[validation]` in-validation → in-progress (agent rejected): La reauditoría be058658 reproduce que una respuesta tardía de validación para A pinta su error en el detalle de B; además preview de migración carece de latest-wins dentro del mismo proyecto. ISOL-02 sigue abierto.
- **2026-07-23T23:01:40Z** `[note]` Reauditoría adicional: gotoChange captura B, espera load(), pero si la selección cambia a C durante el await ejecuta openDetail sobre C; reproducción be058658 terminó selected/project=C y abrió C shared change.
- **2026-07-24T09:46:49Z** `[note]` Corrección de reauditoría: lanes de afinidad independientes protegen validación de detalle, preview de migración y navegación gotoChange; cada continuación comprueba target+secuencia tras sus awaits. Tres regresiones rojo-verde cubren error tardío A→B, preview old/new y navegación B→C. Viewer 172/172 y pnpm verify 1.082/1.082; 241 changes válidos.
- **2026-07-24T09:46:49Z** `[status]` in-progress → in-review
- **2026-07-24T09:53:58Z** `[review]` in-review → in-progress (retry): CR2/CR4/CR5 incompletos: completar y validar project_id en payloads config/preview; proteger reopen, moveStatus y configDirty contra respuestas stale; atribuir receipts de estado; convertir CR5 en concurrencia real con refs, worktrees y receipts.
- **2026-07-24T09:59:33Z** `[note]` Corrección del review: payloads config/raw/structured/preview y sync incluyen project_id+repository_path; cliente exige identidad; moveStatus/reopen/configDirty son stale-safe; CR5 intercala CLI B dentro de transacción viewer A y prueba HEAD refs, worktrees y receipts. Viewer 172/172 y pnpm verify 1.082/1.082; 241 changes válidos.
- **2026-07-24T09:59:33Z** `[status]` in-progress → in-review
- **2026-07-24T10:12:13Z** `[review]` in-review → in-progress (retry): CR2/CR4: reopen y callbacks config no son generation-safe en A→B→A; sync y mutaciones config no validan receipts completos; los writes config carecen de identidad y preview descarta errores legítimos sin identidad.
- **2026-07-24T10:25:50Z** `[note]` Corrección del segundo fail-retry: identidad estricta project_id+repository_path en repo, config, preview, sync y receipts de mutación; receipts de config/repair/unregister/serialize completados; generación de selección protege sync/status A→B→A; identidad de detalle invalida reopen al cerrar/reabrir; generación de contexto config protege configDirty y ediciones nuevas; errores vigentes de preview siguen visibles. Regresiones rojo-verde; afectadas 232/232 y pnpm verify 1.089/1.089; 241 changes válidos.
- **2026-07-24T10:25:50Z** `[status]` in-progress → in-review
- **2026-07-24T10:36:18Z** `[review]` in-review → in-progress (retry): CR4: gotoChange usa afinidad por target pero no generación de selección; una navegación obsoleta B sobrevive a B→C→B y abre el detalle del B posterior.
- **2026-07-24T10:37:55Z** `[note]` Corrección del tercer fail-retry: gotoChange realiza primero su cambio intencional de proyecto y después captura lane+generación de selección; una navegación obsoleta ya no sobrevive B→C→B. Regresión real rojo-verde añadida; suites afectadas 233/233 y 241 changes válidos.
- **2026-07-24T10:37:55Z** `[status]` in-progress → in-review
- **2026-07-24T10:48:22Z** `[review]` in-review → in-progress (retry): CR2/CR4: preview y unregister sobreviven A→B→A por capturar afinidad incompleta/tardía; /api/git no declara ni valida identidad/revisión del proyecto antes de renderizar refs.
- **2026-07-24T10:51:19Z** `[note]` Corrección del cuarto fail-retry: preview combina lane latest-wins con generación del contexto administrado; unregister captura esa generación antes de abrir el prompt; /api/git devuelve project_id+repository_path+ledger receipt y loadGitRefs valida identidad y ledger_revision antes de renderizar. Tres regresiones rojo-verde; suites afectadas 237/237 y 241 changes válidos.
- **2026-07-24T10:51:19Z** `[status]` in-progress → in-review
- **2026-07-24T11:10:44Z** `[note]` Corrección del quinto fail-retry: load devuelve éxito y goto no abre sobre fallo; receipts exigen revisiones ledger/config aplicables; cambio de proyecto invalida detalle; Git y mutaciones de detalle tienen lanes latest-wins; confirmaciones select/reload/mode y selector superior capturan generación pre-await; refresh de registry valida stale antes de mutar globals; búsqueda global es latest-wins. Regresiones rojo-verde; suites afectadas 243/243 y 241 changes válidos.
- **2026-07-24T11:11:15Z** `[review]` in-review → in-progress (retry): CR1-CR4: goto podía abrir repo previo tras load fallido; faltaba exigir revisiones aplicables; Git/detail carecían de latest-wins; confirmaciones, refresh de registry y búsqueda global conservaban continuaciones stale.
- **2026-07-24T11:11:15Z** `[status]` in-progress → in-review
- **2026-07-24T11:21:51Z** `[review]` in-review → in-progress (retry): gotoChange reutiliza state.repo obsoleto tras una carga fallida porque un reintento al proyecto ya seleccionado omite load(), permitiendo mostrar el detalle de A bajo la selección B.
- **2026-07-24T11:23:48Z** `[note]` Corrección del sexto fail-retry: gotoChange solo reutiliza el repo actual si su project_id, repository_path y ledger_revision corresponden al target; tras una carga fallida, reintentar el proyecto ya seleccionado vuelve a cargar y nunca abre el detalle residual. La regresión existente ahora reproduce fallo+reintento y el test de sync incluye ledger_revision para atravesar realmente await load(). Suites afectadas 190/190.
- **2026-07-24T11:23:54Z** `[status]` in-progress → in-review
- **2026-07-24T11:35:15Z** `[review]` in-review → in-progress (retry): CR4: renderMetrics() aplica métricas capturadas de A después de await loadMetricsModule() sin comprobar target/generación, por lo que puede pintar A bajo la selección B.
- **2026-07-24T13:06:10Z** `[note]` Corrección sistémica tras auditoría completa: inventariadas todas las fronteras async; afinidad viva usa project_id+repository_path+generaciones; métricas, búsqueda global, detalle/spec y Mermaid son stale-safe; previews exigen revisiones exactas; las siete rutas write ligan el path capturado antes del dispatch y repair/unregister lo verifican por CAS dentro del lock del registry. Fixtures inválidas reparadas y regresiones independientes cubren A→B→A, old→new→old, receipts, éxito/error y TOCTOU. Reauditoría final no encontró defectos de implementación restantes. Suites afectadas 276/276; pnpm test 1.121/1.121; changeledger check 241 changes y git diff --check verdes.
- **2026-07-24T13:06:17Z** `[status]` in-progress → in-review
- **2026-07-24T13:20:01Z** `[review]` in-review → in-progress (retry): CR2/CR4: la continuación de repair usa managedProject después de await load() y puede recargar otro proyecto y descartar sus ediciones; añadir además una fixture de preview con revisiones presentes pero distintas sin cambio de contexto y una fixture CAS que intercale el rebind durante la adquisición del lock, para que los guards exactos no puedan sustituirse por alternativas TOCTOU o de generación sin romper los tests.
- **2026-07-24T13:23:59Z** `[note]` Corrección del review integral: repair captura su target y la generación administrada post-rebind, revalida tras await load() y nunca recarga el managedProject vivo; regresión reproduce A repair mientras B recibe B UNSAVED y confirma una sola lectura de B. Preview prueba revisiones presentes pero distintas sin cambio de contexto. CAS de registry usa workers que mantienen el lock, rebindean antes de liberarlo y fuerzan update/remove a releer dentro del lock. Suites afectadas 225/225.
- **2026-07-24T13:24:07Z** `[status]` in-progress → in-review
- **2026-07-24T14:38:25Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:45:18Z** `[validation]` in-validation → done (human accepted)
- **2026-07-24T22:11:44Z** `[status]` done → in-progress (agent reopened): La tercera ejecución del audit (RECEIPT-02) encontró scope original sin completar: los payloads de error del viewer se emiten como {error} pelado sin project_id ni repository_path incluso con el proyecto target plenamente resuelto (POST /api/status 403/404/409/400/410, config 409, preview 400, repair/unregister 400), contradiciendo el CR4 'errores, toasts y receipts identifican inequívocamente su target' y el CR2 de receipts con identidad.
