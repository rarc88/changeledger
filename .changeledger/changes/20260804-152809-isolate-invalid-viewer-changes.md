---
id: "20260804-152809"
title: Aislar changes inválidos en el viewer
type: bug
status: approved
created: 2026-08-04T15:28:09Z
depends_on: []
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

- [ ] Escribir los tests rojos del cargador asíncrono y aislar los fallos de lectura o parseo de cada change en `loadRepoAsync`
  - **Target:** `src/repo.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR1, CR4, CR6
- [ ] Escribir los tests rojos de serialización y presentación, exponer los errores recuperables sin rutas absolutas y renderizar el aviso accesible sin interpretar markup
  - **Target:** `src/viewer/domain.mjs`, `src/viewer/public/`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR3, CR4
- [ ] Añadir la regresión del CLI que demuestra que `changeledger check` conserva su salida estricta ante el mismo frontmatter inválido
  - **Target:** `test/cli.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs`
  - **Criteria:** CR5
- [ ] Ejecutar la puerta de calidad completa
  - **Support:**
  - **Verify:** `pnpm verify`

## Log

- **2026-08-04T15:28:09Z** `[note]` Draft creado a partir de un fallo real del viewer: un change con YAML inválido impedía cargar todos los documentos válidos del proyecto.
- **2026-08-06T11:14:47Z** `[status]` draft → approved
