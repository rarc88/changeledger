---
id: "20260627-111219"
title: Conservar el estado del viewer entre recargas
type: feature
status: done
created: 2026-06-27T11:12:19Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

El viewer conserva la selección y los filtros únicamente en memoria. Al
refrescar la página se pierde el proyecto elegido, la vista Board/Table/Graph/
Specs/Metrics, el modo de búsqueda global, el texto, los filtros de tipo, owner
y status, la visibilidad de archivados/descartados y la ordenación de Table.
Tener que reconstruir el contexto de trabajo en cada recarga interrumpe el uso
cotidiano y resulta especialmente molesto con varios proyectos.

Se solicita guardar y restaurar el estado completo del viewer entre recargas.

## Investigation

- `src/viewer/public/app-state.js` contiene todo el estado relevante en un objeto
  singleton, pero sus mutadores no notifican ni persisten cambios.
- `loadProjects()` siempre reemplaza `currentProject` por el proyecto asociado al
  cwd o por el primer proyecto vivo, aunque el usuario hubiese seleccionado otro.
- `selectProject()` borra filtros de tipo, owner y statuses. Esto impide conservar
  un contexto distinto por proyecto incluso durante navegación cruzada.
- Los controles DOM se hidratan parcialmente después de cargar el repositorio;
  search, tabs, modo global y sort no tienen una fase común de restauración.
- Tipos, owners y statuses dependen del proyecto y pueden cambiar entre sesiones.
  Restaurar valores obsoletos sin validarlos puede dejar una pantalla vacía o
  controles en estados que ya no existen.
- `Set` no es serializable directamente. El estado necesita una representación
  JSON versionada y una conversión explícita en ambos sentidos.
- `localStorage` es apropiado porque la preferencia pertenece a ese navegador y
  debe sobrevivir recargas/reinicios sin escribir en ningún repositorio. Puede
  estar bloqueado o contener JSON corrupto, casos que no deben impedir arrancar
  el viewer.
- La gestión de proyectos se documenta por separado en el change
  `20260627-111218`; esta persistencia debe tolerar que el proyecto guardado sea
  desregistrado o quede `missing`.

## Proposal

Introducir un snapshot versionado bajo la clave
`changeledger.viewer-state.v1`. Guardará preferencias globales (`currentProject`,
`currentView`, `globalMode`, texto de búsqueda y ordenación) y filtros por id de
proyecto (`type`, `owner`, statuses, archived y discarded). Así, cambiar entre
proyectos no destruye su contexto y volver a cada uno restaura sus filtros.

La aplicación leerá el snapshot una sola vez antes de elegir proyecto. Una vez
conocidos el listado y el repositorio, normalizará lo restaurado: solo selecciona
un proyecto vivo; solo admite vistas y claves/direcciones de orden conocidas; y
descarta tipos, owners o statuses que ya no están disponibles. Si el proyecto
guardado no sirve, usa el proyecto actual del servidor o el primer vivo. El modo
global y su búsqueda se restauran cuando siguen siendo utilizables.

Cada mutación observable persistirá un snapshot nuevo, incluido limpiar filtros,
cambiar visibilidad, ordenar columnas o cambiar proyecto. Las escrituras se
encapsularán detrás de una pequeña interfaz inyectable para probarlas sin un
navegador real. JSON corrupto, versión desconocida, cuota excedida o acceso
bloqueado a `localStorage` se ignorarán y la aplicación continuará con defaults.
No se persistirán paneles efímeros, formularios, tokens, contenido del repo ni
errores.

## Specification

### CR1 — Recarga restaura el contexto completo
- **Given** que seleccioné el proyecto `alpha`, Table, búsqueda `release`, tipo `feature`, owner `ana`, statuses `draft` y `approved`, Archived activo, Discarded activo y orden por `progress` descendente
- **When** refresco el viewer
- **Then** vuelvo a `alpha` en Table con esos controles y valores restaurados
- **And** los resultados se renderizan usando el estado restaurado sin una visualización intermedia incorrecta

### CR2 — Vista y modo global sobreviven la recarga
- **Given** que activé búsqueda Global con el texto `authentication` desde la vista Graph
- **When** refresco la página
- **Then** Global vuelve a estar activo y muestra los resultados de `authentication`
- **And** al salir de Global regreso a Graph

### CR3 — Filtros independientes por proyecto
- **Given** que `alpha` tiene type `feature` y status `draft` seleccionados y `beta` tiene type `bug`, owner `bob` y Discarded activo
- **When** alterno de `alpha` a `beta` y después vuelvo a `alpha`
- **Then** cada proyecto recupera exclusivamente sus propios filtros y visibilidad
- **And** cambiar de proyecto no borra el snapshot del proyecto anterior

### CR4 — Proyecto guardado ausente o missing
- **Given** que el snapshot selecciona `alpha`, pero `alpha` fue desregistrado o su ruta está marcada `Missing`
- **When** abro el viewer
- **Then** se selecciona el proyecto actual indicado por el servidor si está vivo, o el primer proyecto vivo
- **And** si no existe ninguno se muestra `No projects registered` sin lanzar errores
- **And** el snapshot se corrige para no volver a seleccionar `alpha`

### CR5 — Valores obsoletos se normalizan
- **Given** un snapshot para `alpha` con vista `timeline`, sort key `banana`, type `removed-type`, owner `former-owner` y statuses `draft` y `removed-status`
- **When** el repositorio actual solo admite Board, sort por `id`, type `feature`, owner `ana` y status `draft`
- **Then** se usan Board, sort `id`, type `all`, owner `all` y únicamente status `draft`
- **And** la aplicación reemplaza el snapshot obsoleto por su forma normalizada

### CR6 — Storage inválido no bloquea el viewer
- **Given** que `localStorage` contiene JSON truncado, una versión desconocida o lanza al leer/escribir por política o cuota
- **When** arranca o cambia cualquier control del viewer
- **Then** la aplicación sigue funcionando con defaults y renderiza el repositorio
- **And** no muestra un error fatal ni deja controles inutilizables

### CR7 — Clear y visibilidad también persisten
- **Given** statuses `draft` y `done`, Archived y Discarded activos
- **When** pulso `Clear` y refresco
- **Then** no hay status seleccionado y Archived y Discarded permanecen desactivados
- **And** el trigger muestra `All statuses`

### CR8 — Snapshot mínimo y sin secretos
- **Given** una sesión con token de escritura, un detail abierto, errores visibles y datos cargados del repositorio
- **When** inspecciono `changeledger.viewer-state.v1`
- **Then** contiene únicamente versión, preferencias globales y filtros por project id
- **And** no contiene el token, YAML, changes, specs, rutas, texto de formularios ni mensajes de error

## Plan

- [x] Escribir tests de serialización, restauración, normalización y fallos de storage en `test/app-state.test.mjs`; implementar snapshot versionado y filtros por proyecto en `src/viewer/public/app-state.js`; verificar con `node --test test/app-state.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8) — 2026-06-27T19:28:18Z
- [x] Añadir tests DOM de hidratación inicial y cambios de controles en `test/viewer-metadata.test.mjs`; integrar restauración previa al primer render y persistencia de cada mutación en `src/viewer/public/app.js`; verificar con `node --test test/viewer-metadata.test.mjs test/app-state.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7) — 2026-06-27T19:28:18Z
- [x] Ejecutar `pnpm verify` y comprobar manualmente recarga, reinicio, cambio entre dos proyectos, Global, storage corrupto y proyecto previamente seleccionado ya ausente (support) — 2026-06-27T19:28:18Z
- [x] Aplicar el snapshot al shell antes de los fetches y proteger el acceso inicial a storage en `src/viewer/public/app.js` y `test/viewer-metadata.test.mjs`; verificar con `node --test test/viewer-metadata.test.mjs test/app-state.test.mjs` (CR1, CR6) — 2026-06-27T19:34:56Z
- [x] Mostrar el estado vacío en Board cuando no queda ningún proyecto vivo en `src/viewer/public/app.js` y cubrir la regresión en `test/viewer-metadata.test.mjs`; verificar con `node --test test/viewer-metadata.test.mjs test/app-state.test.mjs` (CR4) — 2026-06-27T19:37:15Z

## Log

- **2026-06-27T11:12:19Z** — Draft creado tras localizar todo el estado efímero en `app-state.js` y confirmar que `loadProjects()` y `selectProject()` descartan selección y filtros. Se propone un snapshot local versionado con filtros independientes por proyecto.
- **2026-06-27T11:16:23Z** — status: draft → approved
- **2026-06-27T19:21:54Z** — status: approved → in-progress
- **2026-06-27T19:21:54Z** — owner → Roberto Ruiz (auto)
- **2026-06-27T19:28:18Z** — Implementación completa: snapshot local versionado, filtros por proyecto, restauración/normalización del shell y tolerancia a storage corrupto o bloqueado. pnpm verify pasa con 395 tests; verificación real confirma proyecto, Table, búsqueda, filtros y Global tras recarga.
- **2026-06-27T19:28:18Z** — status: in-progress → in-review
- **2026-06-27T19:32:54Z** — review → in-progress (retry): CR6: window.localStorage puede lanzar antes del try; CR1: el shell restaurado se aplica después de los fetches y muestra un estado intermedio incorrecto.
- **2026-06-27T19:34:56Z** — Corrección del review: acceso inicial a localStorage protegido y shell restaurado síncronamente antes de los fetches. pnpm verify pasa con 396 tests.
- **2026-06-27T19:34:57Z** — status: in-progress → in-review
- **2026-06-27T19:36:04Z** — review → in-progress (retry): CR4: sin proyectos vivos, una vista o Global restaurados pueden ocultar el mensaje No projects registered porque load() no resincroniza el shell.
- **2026-06-27T19:37:15Z** — Corrección del segundo review: cuando no existe un proyecto vivo se normaliza la vista a Board, se desactiva Global y el estado vacío queda visible. Regresión DOM añadida.
- **2026-06-27T19:37:15Z** — status: in-progress → in-review
- **2026-06-27T19:38:22Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-27T19:43:27Z** — validation → done (human accepted)
- **2026-06-27T19:44:36Z** — graduado a spec `architecture.md`
- **2026-06-27T19:44:36Z** — archived
