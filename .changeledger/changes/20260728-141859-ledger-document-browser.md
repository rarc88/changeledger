---
id: "20260728-141859"
title: Reunir specs y contratos en la sección Ledger
type: feature
status: in-progress
created: 2026-07-28T14:18:59Z
depends_on: []
related_to:
  - "20260623-125850"
  - "20260627-111218"
  - "20260627-111219"
  - "20260627-215619"
  - "20260711-155720"
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El viewer permite revisar changes y specs, pero obliga a salir de la interfaz para consultar los documentos que gobiernan el ledger: `README.md`, `AGENTS.md`, `INTENT.md`, los fragmentos del contrato y sus templates.

Se necesita reunir ese material en una sección superior `Ledger`. Dentro de ella se seleccionarán `Specs`, `Project docs`, `Contract` y `Templates`; el grid actual de Specs debe conservarse y los demás documentos deben poder recorrerse y leerse cómodamente sin editar el repositorio.

## Investigation

La vista Specs recibe su colección mediante `/api/repo`, renderiza un grid rico y abre un detalle Markdown con sanitización, Mermaid, historial de graduación e interlinks. No existe routing del lado cliente: la vista y el proyecto se restauran desde `localStorage`, pero la URL no representa la categoría ni el documento y Back/Forward no participa.

El servidor ya resuelve un proyecto por id exacto, distingue proyectos ausentes y desaparecidos, restringe assets mediante allowlists y contiene rutas tras `realpath`. Esos patrones deben reutilizarse; aceptar cualquier `.md` del repositorio convertiría el viewer en un lector arbitrario de archivos.

`Project docs` pertenece al proyecto seleccionado y se limita a `README.md`, `AGENTS.md` e `INTENT.md` cuando existan. `Contract` se obtiene recursivamente de `templates/contract/` del paquete instalado. `Templates` usa el resto de `templates/`, excluyendo el subárbol `contract/`. Los árboles actuales contienen Markdown y YAML, por lo que se requieren dos formatos de presentación segura.

No hay prerrequisitos de ejecución. Son contexto no bloqueante la UX base del viewer (`20260623-125850`), la selección de proyectos (`20260627-111218`), la persistencia por proyecto (`20260627-111219`), los enlaces entre specs (`20260627-215619`) y el grid actual (`20260711-155720`). La verdad vigente está en `viewer.md`, `architecture.md`, `contract-discovery.md` y `product-principles.md`.

## Proposal

Renombrar la navegación superior `Specs` a `Ledger` e introducir dentro un selector `Specs | Project docs | Contract | Templates`. Specs conservará su grid y detalle actuales. Las categorías documentales mostrarán un árbol allowlisted a la izquierda y un artículo de solo lectura a la derecha; Markdown reutilizará la sanitización y Mermaid existentes, mientras YAML se mostrará como source escapado.

Añadir endpoints GET separados para obtener el árbol lógico y un documento. Nunca devolverán rutas absolutas y validarán categoría, path lógico, extensión, fichero regular, `realpath`, symlinks y tamaño antes de leer. La selección exacta del proyecto seguirá siendo obligatoria incluso para las categorías provistas por el paquete.

Representar la navegación con query params sobre `/`: `view=ledger`, `project`, `category` y, cuando corresponda, `doc`. La URL válida tendrá precedencia sobre storage; la navegación escribirá history y `popstate` restaurará proyecto, categoría y documento. El estado legado `currentView: "specs"` migrará a `ledger/specs`.

Se descarta crear una segunda vista superior para contratos porque separaría dos formas de revisar la verdad persistente. También se descarta exponer un explorador genérico del filesystem y cargar cuerpos documentales en `localStorage` por seguridad y por coherencia con la arquitectura local-first actual.

## Specification

### CR1 — Sección Ledger y categorías
- **Given** el viewer cargado con un proyecto vivo
- **When** el usuario selecciona la entrada superior `Ledger`
- **Then** ve exactamente las categorías internas `Specs`, `Project docs`, `Contract` y `Templates`
- **And** la categoría activa queda identificada visualmente y en `?view=ledger&project=<id>&category=<slug>`

### CR2 — Specs conserva su comportamiento
- **Given** la categoría `Specs`
- **When** el usuario busca, ordena, abre o navega entre specs
- **Then** conserva el grid rico, títulos, tags, extractos sanitizados, orden, Markdown, Mermaid, historial de graduación e interlinks actuales
- **And** abrir una spec añade `doc=<spec-name>` a la URL sin cambiar de categoría

### CR3 — Árbol documental allowlisted
- **Given** un proyecto seleccionado y archivos presentes en las fuentes permitidas
- **When** el viewer solicita el árbol Ledger
- **Then** `Project docs` contiene únicamente `README.md`, `AGENTS.md` e `INTENT.md` existentes en la raíz del proyecto
- **And** `Contract` contiene recursivamente solo `.md`, `.yml` y `.yaml` de `templates/contract/` instalado
- **And** `Templates` contiene recursivamente solo esos formatos del resto de `templates/`, sin el subárbol `contract/`
- **And** cada árbol está ordenado lexicográficamente, omite ausentes y symlinks que escapen de su raíz, y nunca expone paths absolutos

### CR4 — Lectura fail-closed
- **Given** `GET /api/ledger-document` con proyecto, categoría y path lógico
- **When** el path coincide exactamente con una entrada allowlisted, resuelve a un fichero regular dentro de su raíz y no supera 1 MiB
- **Then** responde `200` con `{ category, path, format, content }`, donde `format` es `markdown` o `source`
- **And** un proyecto desconocido responde `404 {"error":"no project"}` y uno registrado cuyo path desapareció responde `410 {"error":"project path is gone"}`
- **And** categoría desconocida, path vacío, absoluto, con NUL, backslash, segmentos vacíos, `.` o `..`, extensión no permitida, fichero no allowlisted o escape por symlink responde `404 {"error":"document not found"}` sin revelar paths locales
- **And** un fichero mayor de 1 MiB responde `413 {"error":"document too large"}` y un método distinto de GET responde `405` con `Allow: GET`

### CR5 — Presentación segura y navegable
- **Given** un documento allowlisted seleccionado
- **When** su formato es `markdown`
- **Then** el artículo usa la sanitización existente, Mermaid mantiene `securityLevel: "strict"` y no ejecuta HTML activo, URLs `javascript:` ni estilos inyectados
- **And** cuando su formato es `source`, el YAML aparece como texto escapado sin interpretación
- **And** un enlace relativo hacia otro documento allowlisted de la misma categoría navega dentro de Ledger; cualquier destino no permitido permanece inaccesible

### CR6 — URL compartible e historial
- **Given** una URL válida con `view=ledger`, proyecto, categoría y documento
- **When** se abre o recarga en otra pestaña
- **Then** el viewer restaura exactamente esa selección sin depender de `localStorage`
- **And** seleccionar proyecto, categoría o documento crea una entrada de history, mientras Back y Forward restauran la selección sin crear entradas adicionales
- **And** una categoría sin `doc` muestra el grid de Specs o, en categorías documentales, el árbol con el estado `Select a document`

### CR7 — Compatibilidad y errores explícitos
- **Given** un snapshot v1 con `currentView: "specs"` y sin parámetros Ledger válidos
- **When** arranca el viewer
- **Then** migra a `currentView: "ledger"` con categoría `specs`
- **And** parámetros URL válidos prevalecen sobre storage, mientras una URL sin selección conserva la restauración actual
- **And** un proyecto, categoría o documento solicitado que ya no existe muestra un estado explícito y no redirige silenciosamente a otro contenido
- **And** el polling de `/api/repo` no modifica history ni guarda cuerpos documentales en storage

### CR8 — Layout de lectura responsive
- **Given** una categoría documental abierta
- **When** el viewport es de escritorio
- **Then** el árbol y el artículo ocupan paneles contiguos con scroll independiente y el contenido aprovecha el ancho disponible
- **And** en viewport móvil los paneles se apilan sin overflow horizontal y permiten volver al árbol después de abrir un documento

## Plan

- [x] Escribir primero pruebas de allowlist, traversal, symlinks, tamaño y proyecto, y después implementar la lectura contenida en `src/viewer/domain.mjs`, `src/viewer/server/router.mjs` y `test/view.test.mjs`; verify: `node --test test/view.test.mjs test/repo.test.mjs` (CR3, CR4)
  - **Resolved:** `2026-07-28T16:11:25Z`
- [x] Escribir primero pruebas puras de query params, precedencia y history, y después crear el módulo de routing bajo `src/viewer/public/` y su test dedicado; verify: `node --test test/app-state.test.mjs test/viewer-routing.test.mjs` (CR6, CR7)
  - **Resolved:** `2026-07-28T16:16:16Z`
- [ ] Escribir primero la migración del snapshot v1 y después actualizar `src/viewer/public/app-state.js`, `src/viewer/public/index.html`, `test/app-state.test.mjs` y `test/viewer-metadata.test.mjs`; verify: `node --test test/app-state.test.mjs test/viewer-metadata.test.mjs` (CR1, CR7)
- [ ] Escribir primero regresiones del grid y detalle actuales y después integrar Specs dentro de Ledger en `src/viewer/public/app.js`, `src/viewer/public/view-renderers.js` y `src/viewer/public/view-parts.js`; verify: `node --test test/viewer-metadata.test.mjs test/viewer-sanitize.test.mjs` (CR1, CR2)
- [ ] Escribir primero pruebas de árbol, Markdown, YAML, enlaces y estados vacíos, y después implementar el navegador documental en `src/viewer/public/api.js`, `src/viewer/public/app.js`, módulos de render asociados y `src/viewer/public/styles.css`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs test/viewer-sanitize.test.mjs` (CR3, CR5, CR8)
- [ ] Escribir primero pruebas de integración de proyecto, categoría, documento y `popstate`, y después conectar el routing al ciclo de render en `src/viewer/public/app.js` y `test/viewer-routing.test.mjs`; verify: `node --test test/viewer-routing.test.mjs test/viewer-metadata.test.mjs` y validación manual de reload, URL compartida, Back/Forward y layout móvil/escritorio (CR2, CR6, CR7, CR8)
- [ ] Actualizar `.changeledger/specs/viewer.md` y `.changeledger/specs/architecture.md` y ejecutar la calidad completa; verify: `pnpm verify` (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8)

## Log

- **2026-07-28T14:18:59Z** `[note]` Draft creado para reunir Specs y documentos allowlisted bajo una navegación Ledger compartible.
- **2026-07-28T14:33:11Z** `[status]` draft → approved (human via conversation)
- **2026-07-28T16:04:49Z** `[status]` approved → in-progress
