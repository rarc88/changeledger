---
title: Modelo de datos e identidad
updated: 2026-10-21T18:10:47Z
tags: [ data-model ]
graduated_from: ["20260613-205854", "20260616-151230", "20260616-162020", "20260616-162017", "20260616-212314", "20260715-122950", "20260718-111457", "20260718-105456", "20260720-125007", "20260805-052741", "20261001-155216", "20261002-133728", "20261019-184719", "20261020-172221"]
---

## Modelo de datos

- **change**: un archivo markdown. Frontmatter estructurado (`id`, `title`,
  `type`, `status`, `created`, `depends_on`, `related_to` opcional, `parent`
  opcional, `owner`
  opcional, `branch` opcional, `archived` opcional, `reviewed` opcional,
  `release_impact` opcional, `tdd` opcional, `integrates_into` opcional,
  `accepted_at` opcional) + etapas. `type` es `change` o `epic` y las etapas
  son cuatro, canónicas y en este orden: `## Request`, `## Specification`,
  `## Plan` y `## Log`; ambas listas están fijadas en código (`CHANGE_TYPES` y
  `CANONICAL_STAGES`, `src/change.mjs`) y ninguna clave de configuración las
  declara. Un change lleva las etapas que necesita; un `epic` agrupa hijos, no
  se implementa y nunca lleva `## Specification` ni `## Plan`. `## Request`
  lleva `### Objective` y `### Frontier`, lo que el humano aprueba;
  Investigation y Proposal son prosa libre bajo encabezados `###` dentro de la
  Request o de la Specification, no etapas. `tdd: false` exime a un change de
  la política test-first global y su Log dice por qué; `release_impact`
  (`none`, `patch`, `minor` o `major`) prevalece sobre `release.default_impact`
  de la configuración, y un `epic` pesa siempre `none`, porque el impacto lo
  llevan sus hijos; `integrates_into` (`integration` o `release`) nombra el
  rol de la rama de la que parte el change y en la que se integra.
  `branch` es un dato **por change** — la rama de implementación de ese change
  — y no debe confundirse con `config.git.integration_branch`, que es la rama
  de integración del repositorio entero. Tiene ciclo de vida (ver
  **Ciclo de vida y gate de revisión**). Cada tarea de `## Plan` ocupa una línea
  checklist (`[ ]`/`[x]`/`[!]`); una tarea resuelta exige una única línea hija
  ``  - **Resolved:** `<timestamp ISO UTC>` ``, y una bloqueada una única línea
  hija `  - **Blocked:** <reason>`. Una tarea pendiente no admite ninguna de
  las dos; los hijos descriptivos `Target`, `Verify`, `Criteria` y `Support`
  valen en cualquier estado, como mucho una vez cada uno. La
  descripción y la razón son texto libre y nunca se interpretan mediante
  separadores de puntuación.
- **spec**: un archivo markdown sin ciclo de vida. Frontmatter mínimo (`title`,
  `updated`, `tags`, `graduated_from`) + cuerpo libre. Es la verdad persistente; un change `done`
  gradúa su verdad aquí.
- **release**: manifiesto YAML inmutable en `.changeledger/releases/<version>.yml` con
  versión SemVer estable, timestamp y ids de changes. La pertenencia se deriva
  solo de estos manifiestos y no se duplica en cada change.
- **registro de consumo**: JSON `schema: 1` inmutable en la colección `usage`
  del ledger, uno por foto del colector, nombrado
  `<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json`; su contenido y su ciclo están en
  `usage.md`.
- **configuración**: `.changeledger/config.yml` en el schema `7` declara
  `schema_version`, `min_cli_version`, `language`, `tdd`,
  `release.default_impact`, `changes_dir`, `specs_dir`, `git`
  (`integration_branch`, `release_branch`, `change_branch_format`) y
  `statuses`. No declara tipos, etapas ni impactos por tipo: `check` reporta
  `types`, `stages`, `release.impacts` y `readiness` como claves retiradas que
  `changeledger config migrate` elimina.

## Identidad

`id` = instante UTC de creación `YYYYMMDD-HHMMSS`, derivado de `created`. Único
sin coordinación central; `changeledger new` incrementa 1s ante colisión en el mismo
segundo. La forma `YYYYMMDD-HHMMSS` tiene una única sede, `CHANGE_ID_FORM`
(`src/lifecycle.mjs`): la leen `check` para `id`, `parent` y el enlace de
hijos, y la gramática de `[finding]` para el brazo `promoted`. La reserva se hace de forma atómica por id (`wx` sobre un lock temporal
y escritura exclusiva del archivo final), de modo que dos procesos concurrentes
no pueden escribir el mismo id. El lock incluye metadata del proceso propietario:
si queda huérfano por una terminación abrupta, `changeledger new` lo puede recuperar; si el
lock desaparece durante la comprobación, el comando reintenta sin fallar. El slug
estructural se normaliza a kebab ASCII y se rechaza si queda vacío. Ordenable
cronológicamente.

La normalización de slugs vive en un helper compartido por `changeledger new` y
`changeledger graduate`: minúsculas, diacríticos fuera, separadores no alfanuméricos a
guiones y rechazo cuando no queda ninguna letra o número ASCII. Así los nombres
estructurales mantienen la misma política en changes y specs.

## Escritura atómica

Las mutaciones de frontmatter en `writer.mjs` preservan el formato textual del
documento: el parser YAML identifica de forma estructural la pareja raíz y sus
rangos fuente, y el writer parchea solo el valor o la pareja objetivo sin
reserializar las regiones ajenas. Las inserciones opcionales se colocan después
de `depends_on`; comentarios, quoting, colecciones flow, escalares multilineales,
mappings anidados y cuerpo permanecen byte-for-byte intactos. El writer falla
explícitamente ante YAML inválido, claves duplicadas o si no encuentra la pareja
ancla que debe editar o usar para insertar (`status`, `depends_on`, `updated`). Así una orden
del CLI no puede aparentar éxito cuando el frontmatter está parcialmente roto.
Las escrituras que reemplazan documentos o estado local pasan por
`writeFileAtomic`: escriben a un temporal en el mismo directorio, sincronizan el
descriptor, hacen `rename` sobre el destino y limpian el temporal si algo falla.
Las creaciones que dependen de exclusividad, como `changeledger new`, conservan `flag:
'wx'` para no perder la reserva atomica del id.

Las mutaciones read-modify-write de un documento usan `mutateFileAtomic`: toman
un lock por archivo (`.<basename>.lock`), releen la versión actual bajo esa
sección crítica, aplican la transformación y escriben con `writeFileAtomic`.
Así dos comandos sobre el mismo change se serializan sin perder tareas ni Log,
mientras cambios distintos usan locks distintos y no comparten un bloqueo global.
El lock se borra en `finally`; si otro proceso encuentra un lock existente, espera
hasta un timeout y falla sin borrarlo, porque expirar un lock solo por edad puede
romper la exclusión si una mutación legítima tarda más de lo esperado.

Antes de mutar una tarea, el parser valida el bloque completo y falla sin
escribir ante metadatos ausentes, duplicados, desconocidos o huérfanos. Completar
una tarea ya resuelta es idempotente y conserva el timestamp original. El Log
usa eventos tipados con timestamp y uno de los tipos `status`, `review`,
`validation`, `owner`, `branch`, `graduation`, `archive`, `note`, `version` o
`finding`, declarados en `LOG_EVENT_DEFINITIONS` (`src/lifecycle.mjs`). Un único
parser y serializador alimenta lifecycle, métricas, graduación y archivado; el
payload es opaco salvo por el esquema del tipo declarado. `changeledger log`
siempre crea un evento `note`, por lo que su texto no puede simular una
transición operativa.
El tipo no transicional `version` registra la versión de ChangeLedger que
modifica el change, con la forma `<semver>` para el primer sello y
`<semver> → <semver>` cuando cambia; acepta prerelease y metadata de build con la
misma gramática que `min_cli_version`. La creación del change (`new` y el
`target: "new"` de `apply`) sella la versión con el instante `created`, y
`appendLogEvent` sella antes de cualquier otro evento cuando el Log no tiene
sello o su último sello difiere textualmente de la versión instalada, de modo
que una versión inferior permitida por el mínimo también queda registrada. Cada
evento pertenece a la última versión sellada antes que él. `edit`, los
documentos de `apply` sobre changes existentes, `fix` y `task` no escriben
eventos y no sellan; los changes anteriores al sello no se rellenan. Como el
sello de aceptación de `sync` pasa por `appendLogEvent` y alcanza a los
archivados, un change archivado bajo una CLI anterior puede recibir su línea
`version` junto con la de aceptación.

El tipo no transicional `finding` registra un hallazgo fuera de la frontera del
change activo con tres formas de payload: `<texto>` lo abre,
`<n> promoted #<id>` lo enlaza con el change en que se convirtió y
`<n> dropped: <razón>` lo cierra con una razón. El ordinal `n` no se escribe en
la línea de apertura: es la posición de su apertura entre las aperturas del mismo
Log, resueltas incluidas, y `findingsInLog` (`src/lifecycle.mjs`) es la única lectura que lo deriva,
compartida por `finding`, `list --pending findings` y `check`. Una apertura
cuyo texto se leería como resolución se rechaza al escribir, y `check` rechaza
con su línea, en documentos vivos, la resolución que no nombra un hallazgo
abierto antes que ella o que resuelve uno ya resuelto. Ningún gate lee los
hallazgos.

`accepted_at` lleva el instante del commit de merge en ISO 8601 UTC. Es
telemetría derivada de git —la aceptación humana es el merge, no un estado ni
un comando— y no condiciona ninguna transición; lo escriben la graduación y
`sync`.
Un documento vivo con un tipo o una etapa retirados se pone al día de forma
explícita con `changeledger fix`, que admite `--dry-run` y escribe de forma
atómica por archivo: el tipo retirado pasa a `change` y el frontmatter recibe
lo que ese tipo implicaba (`release_impact`, `integrates_into: release` de
`hotfix`, `tdd: false` de `documentation`) salvo que ya lo declare, y
`## Investigation`/`## Proposal` pasan bajo `## Request` como `###`. Lo que
requiere una decisión manual queda intacto y listado; la historia congelada
(archivada o descartada) sólo recibe las reparaciones mecánicas del Plan.

## Dependencias y relaciones entre changes

Una entrada de `depends_on` con la forma `<proyecto>:<changeId>` es una
dependencia **cross-proyecto**: `check` no la valida localmente (apunta a otro
repo) ni la mete en el grafo de ciclos; el visor global la resuelve por id o
nombre de proyecto y navega a ese change.

`parent` es el tercer enlace estructural y el único jerárquico: un change
declara como mucho uno, con el id de la épica a la que pertenece. Es
**exclusivo y no transitivo** — compartir padre no conecta a dos hermanos — y
deliberadamente queda fuera del grafo que `check` recorre para ciclos y
backlinks de `depends_on` y `related_to`, que es lo que impide que la
agrupación se convierta en una tercera vía de colapsar el repositorio en un
solo componente. La jerarquía tiene **dos niveles**: `check` rechaza que el
padre declare padre propio y distingue ese tercer nivel de un ciclo de
cualquier longitud, porque un ciclo es una contradicción y un tercer nivel una
decisión de modelado. Como los otros dos enlaces declarados, es exento del
aviso de mención no clasificada **en ambas direcciones**: ni el hijo que nombra
a su épica ni la épica que nombra a un hijo avisan.

`depends_on` expresa un requisito de ejecución: entra en el grafo de ciclos de
`check` y el contexto del change lo presenta con el título y el status de cada
dependencia local. `related_to` expresa contexto compartido sin imponer orden: acepta
ids locales o referencias `<proyecto>:<changeId>`, no participa en ciclos ni
bloquea ningún estado. Una relación local se declara una sola vez; el contexto y
el visor derivan el backlink entrante y la presentan como bidireccional para
descubrimiento. `check` valida la forma, la existencia de destinos locales y que
un change no se relacione consigo mismo. Además advierte, sin fallar, cuando un
change activo menciona otro id local en una etapa semántica sin clasificarlo como
dependencia o relación; ignora Log, bloques de código y changes cerrados.
