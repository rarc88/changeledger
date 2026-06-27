---
id: "20260627-111218"
title: Gestionar proyectos y su configuración desde el viewer
type: feature
status: done
created: 2026-06-27T11:12:18Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

El viewer permite seleccionar proyectos ya registrados, pero no ofrece una
superficie para inspeccionarlos ni administrarlos. Para corregir un nombre o una
ruta hay que volver a la CLI o editar el registro global manualmente; las
entradas cuya ruta desapareció quedan visibles como `missing` sin una forma de
repararlas o retirarlas. Tampoco es posible consultar ni modificar desde el
viewer la configuración que determina el lenguaje, tipos, estados, readiness y
release de cada proyecto.

Se solicita una gestión de proyectos dentro del viewer que permita revisar el
listado, reparar su ruta, desregistrar entradas y ver o editar el `config.yml`
del proyecto seleccionado.

## Investigation

- `GET /api/projects` expone `id`, `name`, `path` y `alive`; la interfaz los
  reduce a un `<select>` que se oculta cuando solo hay un proyecto.
- `src/registry.mjs` ya implementa registro y eliminación con lock y escritura
  atómica, pero no hay una operación explícita para actualizar una ruta ni
  endpoints del viewer que invoquen esas mutaciones.
- Eliminar una entrada del registro no toca el repositorio. Esa separación es
  valiosa y debe hacerse explícita en la confirmación de la UI.
- `resolveProjects()` obtiene el nombre y la identidad local desde
  `.changeledger/config.yml`, mientras que el registro global conserva nombre y
  ruta como metadata de recuperación. Para proyectos vivos, el config debe ser
  la autoridad del nombre; la copia registrada queda como fallback si la ruta
  desaparece.
- `serialize()` devuelve datos derivados del repositorio, pero no el contenido
  de su configuración. La UI necesita una lectura dedicada que preserve el YAML
  para editarlo sin reconstruirlo ni perder comentarios.
- `project_id` es una identidad estable utilizada por el registro y por
  dependencias entre proyectos. Editarla desde un formulario genérico dejaría
  referencias y claves inconsistentes.
- Las escrituras actuales del viewer exigen host local y el token efímero del
  proceso. Las mutaciones del registro y del config deben mantener exactamente
  esa frontera, limitar el body y no aceptar una ruta fuera del proyecto
  resuelto.
- Un YAML sintácticamente válido aún puede incumplir el contrato (tipos,
  estados, rutas o readiness inválidos). Guardar requiere validar el candidato
  completo antes de reemplazar el archivo y conservar intacto el original ante
  cualquier fallo.
- El modo `--local` no usa el registro global. En él puede mostrarse y editarse
  el config del único proyecto, pero reparar rutas o desregistrar no tiene
  sentido y debe quedar deshabilitado.

## Proposal

Añadir una vista `Projects` accesible siempre desde la navegación principal. En
modo global mostrará todas las entradas en una tabla con nombre, id, ruta y
salud; seleccionar una abrirá su detalle. Una entrada viva permitirá editar su
configuración YAML, reparar su ruta y desregistrarla. Una entrada ausente
permitirá reparar la ruta o desregistrarla, pero no fingirá disponer de config.

La edición de `config.yml` será deliberadamente directa: un editor de texto
mostrará el archivo exacto, incluidos comentarios. `Save configuration` enviará
el candidato al servidor, que comprobará YAML, contrato y carga del repositorio
antes de sustituir el archivo mediante lock y escritura atómica. El
`project_id` tendrá que conservar su valor original; un cambio se rechazará con
`project_id cannot be changed from the viewer`. Si cambia `project_name`, el
listado derivará inmediatamente el nombre del config canónico y el selector se
refrescará; no habrá una segunda escritura coordinada que pueda divergir.

La ruta se editará por separado. Solo se aceptará una ruta absoluta a un
repositorio ChangeLedger existente cuyo `project_id` coincida con la entrada;
esto permite reparar repos movidos sin convertir el registro en un alias de otro
proyecto. Desregistrar exigirá confirmación con el nombre y explicará que no se
eliminará ningún archivo. Tras hacerlo se elegirá otro proyecto vivo o se
mostrará el estado vacío.

Todas las mutaciones usarán endpoints `POST` protegidos por el token del viewer,
la restricción de host local, límite de body y errores JSON no sensibles. No se
añadirán dependencias de runtime. En `--local`, Projects mostrará el único
proyecto y su config editable, ocultando las acciones que mutan el registro
global.

## Specification

### CR1 — Listado administrable de proyectos
- **Given** un viewer global con los proyectos `alpha` vivo en `/repos/alpha` y `beta` cuya ruta ya no existe
- **When** abro la vista `Projects`
- **Then** veo para ambos su nombre, id, ruta y estado `Available` o `Missing`
- **And** puedo seleccionar `alpha` para abrir su configuración
- **And** `beta` ofrece reparar ruta y desregistrar, pero no editar una configuración inexistente

### CR2 — Lectura fiel de config.yml
- **Given** que `alpha/.changeledger/config.yml` contiene comentarios y valores de lenguaje, tipos, readiness y release
- **When** abro el detalle de `alpha`
- **Then** el editor muestra el texto YAML exacto, incluidos sus comentarios
- **And** el contenido se presenta como texto no confiable y no puede inyectar HTML ni script en el viewer

### CR3 — Guardado válido y sincronización del nombre
- **Given** el config de `alpha` con `project_id: "aaa111"` y `project_name: alpha`
- **When** cambio `project_name` a `alpha-renamed`, mantengo un config válido y presiono `Save configuration`
- **Then** el servidor valida el candidato antes de escribirlo y reemplaza `config.yml` de forma atómica
- **And** el listado de proyectos y el selector muestran `alpha-renamed` sin reiniciar el viewer
- **And** el nombre almacenado en el registro queda como fallback local y no puede prevalecer sobre el config de un proyecto vivo
- **And** el resto del YAML y sus comentarios se conservan tal como fueron enviados

### CR4 — Config inválido nunca reemplaza el original
- **Given** un `config.yml` válido en disco
- **When** intento guardar YAML mal formado o una configuración que incumple el contrato ChangeLedger
- **Then** recibo un error visible que identifica la causa de validación
- **And** el archivo original y la entrada del registro quedan byte por byte sin cambios
- **And** el editor conserva mi candidato para que pueda corregirlo

### CR5 — Identidad estable protegida
- **Given** el proyecto registrado con `project_id: "aaa111"`
- **When** intento guardar el mismo config con `project_id: "bbb222"`
- **Then** el servidor responde `project_id cannot be changed from the viewer`
- **And** no modifica el config ni el registro

### CR6 — Reparación segura de una ruta
- **Given** una entrada `beta` marcada `Missing` con `project_id: "bbb222"`
- **When** sustituyo su ruta por `/repos/beta-moved`, que es absoluta, existe y contiene el mismo `project_id`
- **Then** el registro se actualiza atómicamente y `beta` pasa a `Available`
- **And** una ruta relativa, un directorio sin ChangeLedger o un proyecto con otro id se rechazan sin modificar el registro

### CR7 — Desregistrar nunca elimina el repositorio
- **Given** el proyecto registrado `alpha` y su repositorio existente
- **When** elijo `Unregister`, confirmo explícitamente `alpha` y el request termina correctamente
- **Then** `alpha` desaparece del listado y del selector
- **And** ningún archivo bajo `/repos/alpha` se modifica o elimina
- **And** el viewer selecciona el siguiente proyecto vivo o muestra `No projects registered` si no queda ninguno

### CR8 — Frontera local y modo --local
- **Given** un request sin el token efímero correcto o con un host no local
- **When** intenta guardar config, reparar ruta o desregistrar
- **Then** se rechaza sin mutar disco ni registro
- **And** en un viewer iniciado con `--local` puedo ver y editar el config del proyecto local, pero no aparecen acciones de ruta ni desregistro

### CR9 — Conflictos y doble envío controlados
- **Given** que el config cambió en disco después de que abrí el editor o que ya hay un guardado pendiente
- **When** intento guardar la copia obsoleta o vuelvo a presionar el botón
- **Then** los controles permanecen deshabilitados durante el request y solo se ejecuta una escritura
- **And** una copia obsoleta se rechaza con `configuration changed on disk; reload before saving`
- **And** puedo recargar el contenido actual sin que el viewer sobrescriba silenciosamente cambios externos

## Plan

- [x] Añadir tests de registro y dominio en `test/registry.test.mjs` y `test/view.test.mjs`; implementar actualización de ruta, lectura de config y mutaciones validadas/atómicas en `src/registry.mjs` y `src/viewer/domain.mjs`; verificar con `node --test test/registry.test.mjs test/view.test.mjs` (CR3, CR4, CR5, CR6, CR7, CR9) — 2026-06-27T11:24:53Z
- [x] Añadir tests HTTP de autorización, límites, errores y modo local en `test/view.test.mjs`; exponer lectura y endpoints de proyectos/config en `src/viewer/server/router.mjs`; verificar con `node --test test/view.test.mjs` (CR2, CR4, CR5, CR6, CR7, CR8, CR9) — 2026-06-27T11:24:54Z
- [x] Añadir tests DOM del listado, estados, editor, confirmación y feedback en `test/viewer-metadata.test.mjs`; construir la vista Projects y sus flujos en `src/viewer/public/index.html`, `src/viewer/public/app.js`, `src/viewer/public/api.js` y `src/viewer/public/styles.css`; verificar con `node --test test/viewer-metadata.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8, CR9) — 2026-06-27T11:24:54Z
- [x] Ejecutar `pnpm verify` y comprobar manualmente la vista Projects, un guardado válido/inválido, una ruta missing reparada y el desregistro en viewer global y `--local` (support) — 2026-06-27T11:24:54Z
- [x] Añadir carga completa con config candidato y regresiones de rutas alternativas inválidas en `src/repo.mjs`, `src/viewer/domain.mjs` y `test/view.test.mjs`; verificar con `node --test test/view.test.mjs test/repo.test.mjs` (CR4) — 2026-06-27T11:41:02Z
- [x] Hacer `config.yml` canónico para el nombre mostrado, eliminar la mutación cruzada con el registro y sanitizar errores inesperados en `src/viewer/domain.mjs`, `src/registry.mjs` y `test/view.test.mjs`; verificar con `node --test test/view.test.mjs test/registry.test.mjs` (CR3, CR4, CR6, CR9) — 2026-06-27T11:45:56Z
- [x] Cubrir pending, éxito, error, recarga y acciones cableadas de proyecto en `src/viewer/public/app.js` y `test/viewer-metadata.test.mjs`; verificar con `node --test test/viewer-metadata.test.mjs` (CR3, CR4, CR6, CR7, CR9) — 2026-06-27T11:45:56Z
- [x] Endurecer formas inválidas de config y captura de excepciones HTTP en `src/check.mjs`, `src/viewer/server/router.mjs`, `test/check.test.mjs` y `test/view.test.mjs`; verificar con `node --test test/check.test.mjs test/view.test.mjs` (CR4) — 2026-06-27T11:51:25Z
- [x] Validar formas anidadas de tipos y hacer el guardado fail-closed en `src/check.mjs`, `src/viewer/domain.mjs`, `test/check.test.mjs` y `test/view.test.mjs`; verificar con `node --test test/check.test.mjs test/view.test.mjs` (CR4) — 2026-06-27T11:55:25Z
- [x] Validar formas inválidas de readiness y alinear la autoridad del nombre en `src/check.mjs`, `test/check.test.mjs`, `test/view.test.mjs` y este change; verificar con `node --test test/check.test.mjs test/view.test.mjs` (CR3, CR4) — 2026-06-27T12:01:16Z

## Log

- **2026-06-27T11:12:18Z** — Draft creado tras confirmar que el viewer solo selecciona proyectos, el registro ya puede eliminar entradas y el config aún no se expone. El alcance autorizado incluye editar `config.yml`; se protege `project_id` como identidad estable y el desregistro nunca elimina archivos.
- **2026-06-27T11:16:07Z** — status: draft → approved
- **2026-06-27T11:18:00Z** — status: approved → in-progress
- **2026-06-27T11:18:00Z** — owner → Roberto Ruiz (auto)
- **2026-06-27T11:24:54Z** — Implementación completa: gestión global/local de proyectos, edición YAML validada y atómica, control de conflictos, reparación de rutas y desregistro seguro. pnpm verify pasa con 375 tests; comprobación visual sin overflow a 1280 px y 680 px.
- **2026-06-27T11:25:08Z** — status: in-progress → in-review
- **2026-06-27T11:38:35Z** — review → in-progress (retry): La validación usa las rutas anteriores; config y registro pueden divergir ante fallo; algunos errores filtran rutas internas; faltan tests DOM de los flujos activos.
- **2026-06-27T11:41:02Z** — Correcciones del review: carga completa con config candidato, coordinación config/registro con rollback, errores inesperados sanitizados y tests DOM de pending/error/confirmación. pnpm verify pasa con 380 tests.
- **2026-06-27T11:41:02Z** — status: in-progress → in-review
- **2026-06-27T11:43:41Z** — review → in-progress (retry): El rollback entre config y registro aún puede fallar; queda un error crudo; los tests no ejercitan handlers DOM reales de Save/Repair/Reload/Unregister.
- **2026-06-27T11:45:56Z** — Segunda corrección del review: config.yml es la autoridad única del nombre visible, eliminada la mutación cruzada de archivos, todos los errores de carga/escritura se sanitizan y los handlers DOM reales quedan cubiertos. pnpm verify pasa con 382 tests y no quedan residuos.
- **2026-06-27T11:45:56Z** — status: in-progress → in-review
- **2026-06-27T11:48:55Z** — review → in-progress (retry): Un config YAML válido con statuses de forma incorrecta lanza TypeError en checkRepo y el callback HTTP no captura la excepción para responder 400/500.
- **2026-06-27T11:51:25Z** — Tercera corrección del review: el checker tolera colecciones config con forma inválida, devuelve errores de contrato y el callback HTTP captura excepciones inesperadas. pnpm verify pasa con 384 tests.
- **2026-06-27T11:51:25Z** — status: in-progress → in-review
- **2026-06-27T11:53:44Z** — review → in-progress (retry): CR4: types escalar o types.<tipo>.stages con forma no-lista aún puede lanzar en checkRepo; saveProjectConfig debe fallar cerrado con 400.
- **2026-06-27T11:55:25Z** — Cuarta corrección del review: validación estructural profunda de types y type.stages, rutas seguras dentro del checker y guardado fail-closed ante cualquier excepción de validación. pnpm verify pasa con 386 tests.
- **2026-06-27T11:55:25Z** — status: in-progress → in-review
- **2026-06-27T11:58:37Z** — review → in-progress (retry): CR4: readiness patterns con forma no-lista aún pueden lanzar en coverage; Proposal/CR3 deben reflejar que config.yml es autoridad del nombre y el nombre almacenado en registry es solo fallback.
- **2026-06-27T12:01:16Z** — Quinta corrección del review: readiness con patrones no-lista devuelve su causa sin romper coverage y el change documenta config.yml como autoridad del nombre visible. 112 tests focalizados pasan; el gate completo no pudo repetirse por límite de uso del entorno, tras haber pasado previamente con 386 tests.
- **2026-06-27T12:01:16Z** — status: in-progress → in-review
- **2026-06-27T19:05:23Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-27T19:18:20Z** — validation → done (human accepted)
- **2026-06-27T19:19:39Z** — graduado a spec `architecture.md`
- **2026-06-27T19:19:40Z** — archived
