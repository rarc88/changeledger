---
title: Viewer y presentación
updated: 2026-07-18T12:35:18Z
tags: [ viewer ]
graduated_from: ["20260616-151234", "20260616-212309", "20260623-125850", "20260627-111219", "20260627-215619", "20260628-113924", "20260703-150228", "20260703-220013", "20260704-103715", "20260710-105206", "20260711-155720", "20260711-155721", "20260711-155722", "20260718-111457"]
---

## Presentación

El visor (`changeledger view`) levanta un server `node:http` enlazado **solo a loopback**
(`127.0.0.1`) que relee `.changeledger/` en cada request (live) y expone JSON. Rechaza
requests cuyo `Host`/`Origin` no sea local (defensa anti DNS-rebinding), añade
headers defensivos (`nosniff`, `X-Frame-Options: DENY`, `no-store`), acota el
body y exige una credencial efímera por proceso (inyectada en la página y
enviada en `x-changeledger-token`) para escribir. Las escrituras exigen un `project`
exacto, sin fallback al primero. Es de solo lectura salvo `POST /api/status`, que
permite que **el humano** apruebe un change `draft` arrastrando su card y acepte o
rechace con motivo un change `in-validation` desde su detalle, además de reabrir
uno provisional. El agente puede rechazar o reabrir también desde el CLI; sólo
la aprobación y aceptación permanecen humanas. La UI rinde board (kanban), table, graph
(`depends_on`), specs y metrics, con búsqueda full-text, filtros (tipo, estado,
owner) y render de markdown + mermaid. Type y owner son filtros inclusivos de
multiselección; owner incluye `Unassigned` como booleano independiente de los
nombres para no colisionar con un owner real. El cliente está dividido en módulos
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
normales. Cada columna usa un ancho responsive entre 190 px y 400 px que garantiza al
menos seis visibles sin scroll desde 1280 px; en vez de comprimirse para que
las siete quepan, `.board` ofrece scroll horizontal para la restante. Título,
id y owner de la card envuelven
tokens largos sin espacios (`overflow-wrap: anywhere`) para no desbordar la
card; por debajo de 680 px las columnas siguen apilándose a ancho completo.
Table conserva ID, título, type, status y progreso en una línea, centra
verticalmente sus celdas y reserva el wrapping para dependencias; status usa un
badge delineado distinto del type sólido. Los details presentan la validación
humana como una única acción pendiente (controles deshabilitados durante el
request y cierre al éxito), usan controles de cierre consistentes y convierten
cada Mermaid en un lightbox navegable por teclado con retorno de foco. En specs,
el frontmatter estructurado `graduated_from` se presenta como un historial
colapsable cuyos ids abren el change correspondiente, sin reinterpretar el
cuerpo Markdown ni relajar la sanitización.

La pestaña **Specs** dispone las cards en un grid responsive a ancho completo
(al menos 3 columnas desde 1280 px, una columna bajo 680 px), ordenadas por
`updated` descendente. Cada card muestra título, fecha, tags y un extracto en
texto plano del primer párrafo de prosa del cuerpo — salta el historial de
graduación, headings, blockquotes y fences, y elimina la sintaxis Markdown
inline —, insertado siempre como texto, nunca como HTML interpretable. La
búsqueda global y el click para abrir el detalle se conservan.

La pestaña **Metrics** respeta los filtros globales (type, status, owner,
búsqueda) y comparte una única implementación de cálculo: el cliente importa
`src/metrics.mjs` servido por una ruta de solo lectura con la contención de
assets existente, sin reimplementar `computeMetrics`. Los KPI incluyen closed,
cycle p50/p85, WIP, tiempo bloqueado, espera media de validación y retries de
review. Bajo la fila de KPI cards el contenido se organiza en una cuadrícula
2×2 de paneles tipo card a ancho completo — throughput como SVG propio con
barra, fecha y valor por día; tiempos medios por estado con barras a escala
común y valor visible; aging + WIP; tablas por tipo y por owner — que degrada a
una sola columna bajo 1100 px; el SVG de throughput se estira al ancho de su
panel. Sin changes visibles muestra un estado vacío explícito, sin `NaN`,
`Infinity` ni divisiones por cero.

Changes y specs comparten preferencias globales de presentación del detalle.
En escritorio se puede alternar sin cerrar entre panel lateral y modal flotante,
y elegir `Compact` (720 px), `Wide` (960 px, default) o `Full` (1280 px), siempre
limitados al viewport seguro. El modal se centra con altura acotada y scroll
interno; el panel conserva el contexto visual detrás. Los controles son botones
con grupos y estado `aria-pressed`, y cambiar un preset no reconstruye el detalle
ni pierde su scroll. Hasta 680 px ambos modos convergen temporalmente en pantalla
completa sin sobrescribir la preferencia de escritorio. Tablas, código y Mermaid
mantienen overflow interno en vez de ampliar la página.

El detalle reúne presentación, cierre y, para changes, navegación de etapas en
una única toolbar fija al borde superior de su scroll interno. Cuando el ancho
del propio panel no alcanza para todo en una fila —incluido el preset
`Compact`, sin depender del viewport— los controles esenciales permanecen
visibles y la navegación pasa a su propia fila con overflow horizontal; los
specs omiten esa fila porque no tienen el pipeline de etapas. Los destinos
compensan la altura de la toolbar. Abrir otro
change o spec —incluidos dependencias y enlaces entre specs— cancela cualquier
desplazamiento pendiente y comienza en la parte superior, mientras cambiar sólo
el modo o el ancho conserva la posición de lectura actual.

Los tests del visor ejercitan el `createRequestListener` en memoria para validar
status, headers, tokens, body limits, endpoints JSON y assets sin abrir sockets
locales. La cobertura del transporte real queda acotada a un smoke test del bind
a `127.0.0.1`; si el sandbox niega ese bind con `EPERM`/`EACCES`, la suite no
falla por una restricción del entorno que no afecta al router.

La pestaña **Projects** administra el registro local desde el propio visor:
muestra id, nombre, ruta y salud; permite reparar una ruta movida solo cuando el
`project_id` coincide, y desregistrar una entrada sin eliminar archivos del
repositorio. En modo `--local` conserva la lectura/edición del proyecto actual,
pero oculta las mutaciones del registro global. `.projects-shell` ocupa el ancho
completo del contenedor; el listado de proyectos y el panel de configuración
mantienen scroll independiente por panel, y bajo el breakpoint estrecho se
apilan en una columna recuperando un único scroll vertical.

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
`N → M` (con la versión de origen real detectada), los cambios y el YAML candidato
antes de una aplicación confirmada. CLI y
viewer comparten el mismo motor de migración. Un schema futuro es estrictamente de
solo lectura tanto en UI como en endpoints Raw/Form. Cambiar de modo, recargar o
seleccionar otro proyecto con ediciones locales exige confirmación. Confirmaciones,
desregistro y errores usan dialogs/toasts propios accesibles; no dependen de
`alert`, `confirm` ni `prompt` del navegador.

El viewer conserva en `localStorage` un snapshot versionado y mínimo de la
sesión: proyecto seleccionado, vista, modo Global, búsqueda, orden, layout/ancho
del detalle y filtros de
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
