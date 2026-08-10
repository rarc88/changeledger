---
id: "20260804-152809"
title: Aislar changes inválidos en el viewer
type: bug
status: done
created: 2026-08-04T15:28:09Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260617-190008", "20260731-161656"]
owner: Roberto Ruiz
---

## Request

Un error de sintaxis en el frontmatter de un change no debe impedir que
`changeledger view` cargue el proyecto completo. El viewer debe conservar
visibles y operables los changes válidos y señalar cada documento que no pudo
cargar con un diagnóstico localizado.

La validación estricta no cambia: `changeledger check` debe seguir rechazando el
repositorio mientras exista el documento inválido. Este change no amplía la
tolerancia a specs, releases ni configuración.

## Investigation

El incidente se reprodujo con un título YAML que cerraba sus comillas antes de
terminar el valor:

```yaml
title: "Volver a la agenda" salta al primer trayecto programado
```

`parseChange` detecta correctamente el error. El problema aparece después:
`loadRepoAsync` recorre los `.md` de `changes_dir` y propaga el primer fallo de
lectura o parseo. El endpoint `GET /api/repo` convierte esa excepción en una
respuesta 500 y el cliente sustituye el contenido del viewer por el error. Un
documento defectuoso se convierte así en un fallo del proyecto entero.

El cargador síncrono `loadRepo`, usado por `changeledger check`, también falla
rápido, pero allí esa semántica es deliberada: el CLI debe devolver código 1 y
evitar que un repositorio inválido parezca correcto. La causa raíz es que la
ruta HTTP del viewer no tiene un canal de errores recuperables por documento y
hereda la frontera fail-fast del CLI.

La solución elegida es hacer tolerante únicamente la lectura asíncrona de
changes para el viewer. `loadRepoAsync` conservará los changes válidos y
acumulará los fallos por nombre de archivo; `serialize` los expondrá como datos
del proyecto y la UI mostrará un aviso persistente y accesible. El diagnóstico
no incluirá rutas absolutas y se insertará como texto. Errores de configuración
o del repositorio que no pertenezcan a un change individual continuarán siendo
fatales.

Los changes `20260617-190008` y `20260731-161656` son contexto relacionado por
la normalización segura de errores y la afinidad de respuestas a proyecto,
respectivamente; ninguno es requisito de ejecución porque ambos están cerrados
y su comportamiento ya forma parte de la base actual.

## Specification

### CR1 — Un change inválido no bloquea los válidos
- **Given** un proyecto cuyo `changes_dir` contiene un change válido con id `20260804-120000` y otro cuyo frontmatter contiene `title: "Texto" fuera`
- **When** el viewer solicita `GET /api/repo` para ese proyecto
- **Then** la respuesta HTTP es 200 y `changes` contiene el change `20260804-120000`
- **And** la respuesta contiene un error recuperable para el archivo inválido con su nombre y la causa de parseo

### CR2 — El viewer presenta un diagnóstico localizado
- **Given** una respuesta de repositorio con el change válido `20260804-120000` y un error recuperable para `20260804-120001-invalid.md`
- **When** el cliente aplica y renderiza esa respuesta
- **Then** el change válido permanece visible y operable en la vista activa
- **And** un aviso accesible muestra `20260804-120001-invalid.md` y la causa sin reemplazar el contenido del proyecto

### CR3 — Los errores recuperables no filtran ni interpretan contenido
- **Given** un archivo inválido llamado `20260804-120001-invalid.md` cuyo error del parser contiene markup y cuya ruta está bajo `/Users/alice/private-project/`
- **When** el servidor serializa el fallo y el cliente lo presenta
- **Then** la respuesta no contiene `/Users/alice/private-project/`
- **And** el nombre y el diagnóstico se insertan como texto sin crear elementos o atributos desde el markup

### CR4 — Varios documentos inválidos se aíslan de forma determinista
- **Given** un proyecto con un change válido y dos changes inválidos llamados `b-invalid.md` y `a-invalid.md`
- **When** el viewer solicita `GET /api/repo`
- **Then** la respuesta conserva el change válido y contiene ambos errores recuperables ordenados por nombre de archivo
- **And** las métricas y filtros se calculan únicamente con los changes válidos

### CR5 — La validación CLI permanece estricta
- **Given** el mismo proyecto con `title: "Texto" fuera` en un change
- **When** se ejecuta `changeledger check`
- **Then** el comando devuelve código 1 y nombra el documento inválido
- **And** no lo omite ni informa que el repositorio es válido

### CR6 — Los fallos estructurales siguen siendo fatales
- **Given** un proyecto cuya configuración de ChangeLedger no puede cargarse
- **When** el viewer solicita `GET /api/repo`
- **Then** el endpoint mantiene una respuesta de error y no la transforma en un error recuperable de change

## Plan

- [x] Escribir los tests rojos del cargador asíncrono y aislar los fallos de lectura o parseo de cada change en `loadRepoAsync`
  - **Target:** `src/repo.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR1, CR4, CR6
  - **Resolved:** `2026-08-06T11:27:20Z`
- [x] Escribir los tests rojos de serialización y presentación, exponer los errores recuperables sin rutas absolutas y renderizar el aviso accesible sin interpretar markup
  - **Target:** `src/viewer/domain.mjs`, `src/viewer/public/`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR3, CR4
  - **Resolved:** `2026-08-06T11:27:21Z`
- [x] Añadir la regresión del CLI que demuestra que `changeledger check` conserva su salida estricta ante el mismo frontmatter inválido
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-08-06T11:27:21Z`
- [x] Ejecutar la puerta de calidad completa
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-06T11:27:21Z`

## Log

- **2026-08-04T15:28:09Z** `[note]` Draft creado a partir de un fallo real del viewer: un change con YAML inválido impedía cargar todos los documentos válidos del proyecto.
- **2026-08-06T11:14:47Z** `[status]` draft → approved
- **2026-08-06T11:16:18Z** `[status]` approved → in-progress
- **2026-08-06T11:27:33Z** `[note]` Implementación verificada con 214 tests focalizados del viewer, 54 tests del CLI y pnpm verify (1124 tests); los mutantes confirmaron aislamiento, orden, redacción, render seguro, CLI estricto y fallos estructurales fatales.
- **2026-08-06T11:27:42Z** `[status]` in-progress → in-review
- **2026-08-06T11:28:39Z** `[note]` Mandato de revisión: auditoría completa de baseline 7523317882496049c0ac0970655bd1490b7e6d51..HEAD contra CR1–CR6, Plan, seguridad del diagnóstico y separación entre viewer tolerante y CLI estricto.
- **2026-08-06T11:34:12Z** `[review]` in-review → in-progress (retry): serializer leaks absolute paths embedded in parser diagnostics
- **2026-08-06T11:39:07Z** `[note]` Corrección del review: los diagnósticos recuperables redactan rutas absolutas POSIX, drive Windows y UNC con <path>; conservan URLs y barras ordinarias. Test focalizado 114/114 y pnpm verify 1124/1124.
- **2026-08-06T11:39:07Z** `[status]` in-progress → in-review
- **2026-08-06T11:39:13Z** `[note]` Mandato de revisión de confirmación: verificar únicamente que la corrección elimina rutas absolutas embebidas en diagnósticos recuperables sin alterar URLs, texto ordinario, render seguro ni semánticas ya aprobadas.
- **2026-08-06T11:42:23Z** `[review]` in-review → in-progress (retry): absolute POSIX, Windows drive, and UNC paths containing spaces or delimiter characters are only partially redacted and leak their suffixes
- **2026-08-06T11:47:19Z** `[note]` Segunda corrección del review: la redacción ya no intenta adivinar el final del path; elimina el resto del segmento no-URL desde el primer inicio absoluto, incluidos espacios y delimitadores. Test focalizado 114/114 y pnpm verify 1124/1124.
- **2026-08-06T11:47:19Z** `[status]` in-progress → in-review
- **2026-08-06T11:47:19Z** `[note]` Mandato de revisión de confirmación: verificar sólo el defecto de sufijos filtrados en paths con espacios o delimitadores y regresiones de la estrategia conservadora sobre URLs, texto ordinario y diagnóstico accionable.
- **2026-08-06T11:49:45Z** `[review]` in-review → in-progress (retry): URL segmentation treats URL-adjacent absolute POSIX, Windows-drive, and UNC paths as part of the URL span, leaving private path text unredacted
- **2026-08-06T11:52:27Z** `[note]` Tercera corrección del review: los spans URL terminan en delimitadores de prosa para que un path POSIX, drive o UNC adyacente vuelva al segmento redactable. Test focalizado 114/114 y pnpm verify 1124/1124.
- **2026-08-06T11:52:27Z** `[status]` in-progress → in-review
- **2026-08-06T11:52:27Z** `[note]` Mandato de revisión de confirmación: verificar sólo paths absolutos adyacentes a URLs y regresiones de la nueva frontera de delimitadores sobre URLs standalone, paths con espacios/delimitadores y texto ordinario.
- **2026-08-06T11:55:23Z** `[review]` in-review → in-progress (retry): URL-terminating closing delimiters and backslash are missing from the path-prefix boundary set, allowing adjacent absolute path suffixes to leak
- **2026-08-06T11:59:09Z** `[note]` Cuarta corrección del review: la frontera de inicio de path reconoce los 13 delimitadores que terminan los spans URL; la matriz POSIX, drive y UNC impide que sus rutas adyacentes queden visibles. Test focalizado 114/114 y pnpm verify 1124/1124.
- **2026-08-06T11:59:11Z** `[status]` in-progress → in-review
- **2026-08-06T11:59:24Z** `[note]` Mandato de revisión de confirmación: verificar sólo que los delimitadores de cierre y backslash que terminan una URL permiten detectar y redactar paths POSIX, drive y UNC adyacentes, más regresiones introducidas por esa frontera sobre URLs standalone, texto ordinario, markup como texto y diagnóstico accionable.
- **2026-08-06T12:02:15Z** `[review]` in-review → in-progress (retry): backslash-delimited UNC adjacency drops the URL-terminating backslash instead of preserving it before <path>
- **2026-08-06T12:05:22Z** `[note]` Quinta corrección del review: la redacción conserva el delimitador que corta el span URL antes de procesar el segmento restante; la matriz ejecutada de 13 delimitadores por 3 familias de path queda 39/39. Test focalizado 114/114 y pnpm verify 1124/1124.
- **2026-08-06T12:05:25Z** `[status]` in-progress → in-review
- **2026-08-06T12:05:37Z** `[note]` Mandato de revisión de confirmación: verificar sólo la preservación del delimitador URL y la redacción completa en la matriz ejecutada de 13 delimitadores por paths POSIX, drive y UNC, especialmente backslash más UNC; comprobar regresiones introducidas sobre URL standalone, texto ordinario, markup como texto y diagnóstico accionable.
- **2026-08-06T12:07:54Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-06T16:36:10Z** `[validation]` in-validation → done (human accepted)
- **2026-08-06T16:38:23Z** `[graduation]` spec: `viewer.md`
- **2026-08-06T16:38:45Z** `[archive]` archived
