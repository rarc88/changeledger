---
title: Viewer y presentación
updated: 2026-06-28T17:15:04Z
tags: [ viewer ]
---

## Presentación

> Graduado del change 20260616-151234 (resolución segura de assets estáticos).
> Graduado del change 20260616-212309 (tests del viewer sin socket local).
> Graduado del change 20260623-125850 (legibilidad e interacción del viewer).
> Graduado del change 20260627-111219 (persistencia del estado del viewer).
> Graduado del change 20260627-215619 (navegación entre specs por enlaces).
> Graduado del change 20260628-113924 (editor amigable y migración de config).

El visor (`changeledger view`) levanta un server `node:http` enlazado **solo a loopback**
(`127.0.0.1`) que relee `.changeledger/` en cada request (live) y expone JSON. Rechaza
requests cuyo `Host`/`Origin` no sea local (defensa anti DNS-rebinding), añade
headers defensivos (`nosniff`, `X-Frame-Options: DENY`, `no-store`), acota el
body y exige una credencial efímera por proceso (inyectada en la página y
enviada en `x-changeledger-token`) para escribir. Las escrituras exigen un `project`
exacto, sin fallback al primero. Es de solo lectura salvo `POST /api/status`, que
permite que **el humano** apruebe un change `draft` arrastrando su card y acepte o
rechace con motivo un change `in-validation` desde su detalle; el resto del ciclo
lo conduce el agente. La UI rinde board (kanban), table, graph
(`depends_on`), specs y metrics, con búsqueda full-text, filtros (tipo, estado,
owner) y render de markdown + mermaid. El cliente está dividido en módulos
estáticos pequeños: `security.js` (escape/sanitización/Mermaid), `state.js`
(filtros y tombstones), `api.js` (fetch), `templates.js` (lit-html y el wrapper
único de Markdown sanitizado), `view-parts.js` (templates reutilizables),
`view-renderers.js` (graph/specs/metrics) y `app-state.js` (estado global y
helpers de transición puros — repo, filtros, vista, proyecto, sort — sin tocar el
DOM); `app.js` queda como bootstrap y wiring de eventos. El graph muestra un estado vacío cuando los filtros no dejan changes
visibles, en vez de generar un SVG con dimensiones inválidas. La profundidad del
grafo usa un set de visitados por rama para detectar ciclos solo en el camino
actual: dependencias compartidas entre ramas no colapsan la capa del nodo
dependiente, y los ciclos reales siguen terminando en un SVG finito.

Los estados se filtran desde un menú compacto de selección múltiple. `Clear`
restablece tanto los statuses como la visibilidad `Archived`/`Discarded`;
`Discarded` añade su lane al final del Board sin comprimir las siete columnas
normales. Table conserva ID, título, type, status y progreso en una línea, centra
verticalmente sus celdas y reserva el wrapping para dependencias; status usa un
badge delineado distinto del type sólido. Los details presentan la validación
humana como una única acción pendiente (controles deshabilitados durante el
request y cierre al éxito), usan controles de cierre consistentes y convierten
cada Mermaid en un lightbox navegable por teclado con retorno de foco. En specs,
el bloque inicial de procedencia `Graduado del change …` se agrupa en un historial
colapsable sin reinterpretar otros blockquotes ni relajar la sanitización.

Los tests del visor ejercitan el `createRequestListener` en memoria para validar
status, headers, tokens, body limits, endpoints JSON y assets sin abrir sockets
locales. La cobertura del transporte real queda acotada a un smoke test del bind
a `127.0.0.1`; si el sandbox niega ese bind con `EPERM`/`EACCES`, la suite no
falla por una restricción del entorno que no afecta al router.

La pestaña **Projects** administra el registro local desde el propio visor:
muestra id, nombre, ruta y salud; permite reparar una ruta movida solo cuando el
`project_id` coincide, y desregistrar una entrada sin eliminar archivos del
repositorio. En modo `--local` conserva la lectura/edición del proyecto actual,
pero oculta las mutaciones del registro global.

Para proyectos vivos, `.changeledger/config.yml` es la autoridad del nombre. El
nombre guardado en `.registry.json` solo sirve como fallback cuando la ruta ya no
existe. El editor entrega el YAML exacto —comentarios incluidos— y protege
`project_id` como identidad inmutable. Antes de una escritura carga el
repositorio completo con el config candidato, ejecuta las validaciones de
contrato y rutas, compara una revisión SHA-256 para detectar ediciones externas
y reemplaza el archivo atómicamente. Configs sintáctica o estructuralmente
inválidos devuelven un error 400 sin alterar bytes; errores inesperados se
normalizan para no revelar rutas locales. Los endpoints de config, reparación y
desregistro comparten token efímero, límite de body y frontera loopback con las
demás escrituras del viewer.

La configuración ofrece dos modos. **Form** es el predeterminado y representa
General, Paths, statuses y stages del lifecycle, tipos y stages activos, política
de review, impacto SemVer, Definition of Ready e identidad interna. **Raw YAML**
conserva la edición avanzada. Form envía únicamente un patch semántico allowlisted
y diferencial, por lo que cambiar un campo no reconstruye el documento ni inventa
defaults para tipos custom. El servidor conserva la autoridad: rechaza identidad,
valores canónicos ausentes, repos no cargables y revisiones obsoletas antes de una
escritura atómica.

Un config antiguo muestra **Migration required** y permite previsualizar el resumen
`0 → 1`, los cambios y el YAML candidato antes de una aplicación confirmada. CLI y
viewer comparten el mismo motor de migración. Un schema futuro es estrictamente de
solo lectura tanto en UI como en endpoints Raw/Form. Cambiar de modo, recargar o
seleccionar otro proyecto con ediciones locales exige confirmación. Confirmaciones,
desregistro y errores usan dialogs/toasts propios accesibles; no dependen de
`alert`, `confirm` ni `prompt` del navegador.

El viewer conserva en `localStorage` un snapshot versionado y mínimo de la
sesión: proyecto seleccionado, vista, modo Global, búsqueda, orden y filtros de
cada proyecto. La restauración hidrata el shell antes de iniciar los fetches y
normaliza proyectos o valores que ya no existen; cada proyecto mantiene sus
propios filtros. Un storage ausente, corrupto, bloqueado o sin cuota nunca impide
el arranque. El snapshot excluye tokens, rutas, YAML, contenido del repositorio,
formularios y errores. Si no queda ningún proyecto vivo, la UI corrige el estado
a Board, desactiva Global y muestra el estado vacío visible.

Los changes con `archived: true` se ocultan por defecto (toggle "Archived" para
mostrarlos); el flag los saca del board sin sacarlos de `changes_dir`, así
`check` y las deps los siguen viendo. `lit-html`, `marked`, `dompurify` y
`mermaid` son dependencias instaladas (pnpm), servidas desde `node_modules` bajo
`/vendor/*`.

Los assets estáticos propios del viewer se resuelven con contención explícita:
la ruta se decodifica, se resuelve contra `publicDir`, se valida con
`path.relative` y, cuando el fichero existe, se vuelve a validar contra
`realpath`. Esto evita traversal codificado y escapes por directorios hermanos
con prefijo común; las rutas `/api/*` y `/vendor/*` se resuelven antes de esa
rama estática.
**Frontera de confianza:** los documentos del repo son contenido no confiable
aunque el repo sea local. El cuerpo Markdown se rinde vía `safeHtml` (marked →
DOMPurify) antes de tocar el DOM; si `marked` o `DOMPurify` no cargan, `safeHtml`
falla cerrado y muestra un mensaje en vez de insertar HTML no sanitizado. Mermaid
se inicializa con `securityLevel: 'strict'`, de modo que ningún change/spec pueda
ejecutar JavaScript en el origen del visor. En modo global el visor lee el
registro y muestra todos los proyectos (selector + autoenfoque), y la búsqueda
"Global" (`GET /api/search?q=`) hace match full-text en todos los repos vivos y
agrupa los resultados por proyecto.
El registry local distingue archivo ausente de archivo corrupto: si no existe,
empieza vacío; si existe y no es JSON válido, `readRegistry` falla con un error
claro y `register` no lo sobrescribe silenciosamente. Las mutaciones
read-modify-write del registry (`register`, `remove`) se envuelven en
`withFileLock(registryPath())`, lo que serializa dos invocaciones concurrentes de
`changeledger register`/`changeledger remove` sobre el mismo archivo. El directorio se garantiza
antes de tomar el lock porque el lock file requiere que el directorio exista.

El estado global `~/.changeledger/` y los datos de proyecto `.changeledger/`
comparten nombre, pero no marcador. `findChangeledgerDir()` asciende por los
ancestros y solo reconoce una raíz de proyecto si contiene
`.changeledger/config.yml`; así ignora el home global, incluso cuando el
directorio temporal está debajo del home como ocurre en Windows.

**Navegación entre specs.** El cuerpo de un spec puede enlazar a otro con
markdown relativo (`[Modelo de datos](data-model.md)`). El visor intercepta el
click sobre esos enlaces `*.md` relativos (`handleSpecBodyClick`), previene la
navegación nativa del navegador y abre el spec destino dentro del visor
(`openSpecByName` resuelve el href —sin `./` ni `.md`— contra `state.repo.specs`),
reusando el patrón de las dependencias de un change. Los enlaces externos (con
esquema o path absoluto) pasan sin interceptar. Un destino inexistente es no-op.
