---
id: "20260722-185043"
title: Permitir migrar ledgers legacy previamente aceptados
type: bug
status: done
created: 2026-07-22T18:50:43Z
depends_on: ["20260721-193103"]
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260720-125007", "20260722-163405"]
---

## Request

La auditoría de producción `20260721-193106` reprodujo el cutover sobre un
ledger real que versiones estables anteriores de ChangeLedger habían aceptado.
El preview inventaría sus 184 documentos sin divergencias, pero `--create`
rechaza el snapshot completo porque muchos changes conservan metadata de tareas
antigua y eventos de Log no tipados. No existe un procedimiento de migración
seguro que transforme esos documentos sin reparar masivamente las ramas fuente.

El resultado actual deja a proyectos soportados sin camino de adopción del
almacén global. La solución debe incorporar una compatibilidad explícita,
determinista y auditable al plan de cutover; no puede relajar la validación del
estado nuevo ni modificar silenciosamente la historia legacy.

## Investigation

`previewStateMigration` inventaría blobs y resoluciones por identidad, pero no
valida su estructura con el contrato actual. Durante `--create`,
`candidateSnapshot` parsea todos los documentos elegidos y pasa el candidato a
`checkRepo`; cualquier estructura histórica ahora inválida aborta antes de
crear o publicar el baseline.

En el preflight real de `/Users/raruiz/repositories/github/backend-laravel`, la
source `d73df41f66fdb97397481f9116ef514d9e9a081c` produjo 184 documentos, cero
divergencias y el digest
`79e1b65c974b4afdd494888355dc32400b2913aa8fbf0a2821b15ec9c3d341c9`.
Sobre un clon y remoto bare desechables, `--create` falló con metadata de tareas
inválida, timestamps de resolución ausentes y eventos de Log no tipados. El
receipt confirmó `written: false`, `baseline: null`, `network: false` y la ref
remota `refs/heads/changeledger/state` permaneció ausente.

`changeledger fix --structured-sections` puede reescribir el worktree actual,
pero no forma parte del plan inmutable de migración ni transforma blobs de refs
fuente sin mutarlas. Exigir esa reparación repo-wide como precondición desplaza
el riesgo al operador, pierde la correspondencia original/resultado dentro del
manifest y no ofrece una decisión reproducible para cada documento.

Causa raíz: el contrato de `20260721-193103` valida el baseline solo contra el
esquema vigente, pero no definió cómo transportar documentos aceptados por
versiones anteriores. El preview tampoco eleva esta incompatibilidad como una
decisión de compatibilidad resoluble. Por la escala de `20260721-193106`, es un
hallazgo alto: un ledger soportado carece de migración segura.

La validación independiente posterior reprodujo un segundo hueco sobre el mismo
commit real: 8 de sus 149 changes reportan decisiones manuales del normalizador.
Seis contienen eventos de Log sin timestamp recuperable y dos metadata de tareas
ambigua. La prevalidación integral de la corrección descubrió otros 2 changes
cuyo formato legacy sí se transforma, pero cuyo resultado conserva una
contradicción de lifecycle o reglas de readiness que la versión previa no
exigía: son 10 reemplazos humanos en total. Todos tienen identidad derivable y
formato legacy reconocido, pero inventar los datos faltantes perdería
semántica. Abortarlos sin producir un plan vuelve a dejar al ledger sin salida;
normalizarlos silenciosamente violaría la inmutabilidad. El plan necesita una
tercera clasificación explícita (`requires-replacement`) que permita al
operador aportar un documento completo y verificable, sin convertir en
resoluble ningún fallo de transporte, parsing o identidad.

La misma auditoría encontró que los planes con divergencias no pueden validar
sus decisiones antes de `--create`: `state migrate --preview` rechazaba
`--plan`, y el candidato cerrado solo se construía durante el preview inicial
cuando todas las resoluciones eran automáticas. Por tanto, la primera
evaluación integral de una resolución humana ocurría en la operación de
creación. Se requiere un preview read-only del plan editado y cobertura
end-to-end equivalente en repositorios SHA-1 y SHA-256.

Acotación de alcance (decisión humana, ver Log): `20260721-193103` CR3 ya
exige que cualquier documento inválido rechace la source completa nombrando
OID y path; `20260722-163405` CR1 exige el mismo fail-closed, con mensaje
exacto, para blobs no UTF-8. Ninguno de los dos se relaja. Esta change abre una
válvula de escape estrecha para changes parseables, con identidad derivable y
un formato legacy reconocido por `migrateStructuredSections`: si la
transformación es inequívoca se clasifica `legacy-normalizable`; si faltan
datos que no pueden inferirse sin pérdida se clasifica `requires-replacement`
y queda sin resolución. Cualquier otra causa — estructura Git hostil,
encoding, documento no parseable, sin identidad derivable o defecto ajeno a
las secciones legacy reconocidas — sigue rechazando la source completa
exactamente como hoy.

## Specification

### CR1 — El preview diagnostica compatibilidad legacy por change
- **Given** una source con un change cuya única incompatibilidad es metadata de
  tareas antigua o eventos de Log no tipados, aceptados por una versión previa
  soportada de ChangeLedger y cubiertos por el normalizador versionado
  `migrateStructuredSections`
- **When** se ejecuta `state migrate --preview`
- **Then** el plan clasifica ese change como válido, legacy normalizable (con
  la regla/versión del normalizador aplicable) o `requires-replacement` cuando
  el formato legacy es reconocido pero faltan datos que no pueden inferirse
  sin pérdida, identificando source, commit, path y blob originales
- **And** preview y create coinciden: ningún documento verde en preview puede
  fallar en create por la misma regla
- **And** cualquier otra causa de rechazo — estructura Git hostil, encoding no
  UTF-8, documento no parseable, sin identidad derivable, o metadata legacy que
  no pertenece a las secciones reconocidas — sigue rechazando la source
  completa exactamente como hoy (`20260721-193103` CR3,
  `20260722-163405` CR1 permanecen intactos)
- **And** no publica baseline ni modifica ramas fuente, refs, config o estado
  público; el único archivo opcional es el plan pedido explícitamente con
  `--output`, y la observación remota conserva la semántica existente de fetch
  de objetos inmutables sin mover refs del usuario

### CR2 — La normalización es explícita e inmutable
- **Given** un plan con incompatibilidades transformables sin pérdida semántica
- **When** el operador selecciona su resolución
- **Then** el plan registra por documento el blob original, la regla/version de
  normalización y el hash exacto del resultado
- **And** un documento `requires-replacement` permanece sin resolución hasta
  que el operador aporta `replacement`, `basename` y `sha256`; el plan conserva
  el diagnóstico y los candidatos originales y nunca inventa metadata
- **And** `--create` revalida sources, decisiones y hashes antes de publicar
- **And** ninguna normalización ocurre implícitamente

### CR3 — El cutover no muta la verdad legacy
- **Given** un plan resuelto de compatibilidad
- **When** se crea el baseline
- **Then** la transformación se aplica al snapshot candidato sin escribir las
  ramas fuente ni el worktree
- **And** el manifest conserva procedencia suficiente para auditar contenido
  original y resultado normalizado

### CR4 — Solo el legacy reconocido admite reemplazo humano
- **Given** un change parseable y con identidad derivable cuyo formato de tarea
  o Log legacy es reconocido, pero cuya metadata ambigua o timestamp ausente no
  se puede normalizar sin inventar información
- **When** preview o create lo procesa
- **Then** preview lo clasifica `requires-replacement`, nombra identidad,
  source, commit y path y deja su resolución pendiente
- **And** preview del plan y create fallan cerrados hasta recibir un reemplazo
  explícito cuyo hash e identidad se validan
- **And** estructura Git hostil, encoding no UTF-8, documento no parseable, sin
  identidad derivable o un defecto ajeno al formato legacy reconocido rechazan
  la source completa sin producir una opción de reemplazo
- **And** ninguna metadata ausente se infiere para ese documento

### CR5 — La regresión cubre un ledger legacy representativo
- **Given** una fixture versionada equivalente al ledger real auditado, incluido
  un change normalizable como `20260716-124623` y casos
  `requires-replacement` equivalentes a los 10 bloqueos observados
- **When** se ejecutan preview, resolución, create y activate en SHA-1 y SHA-256
- **Then** el ledger migra sin pérdida semántica y las sources permanecen
  byte-a-byte iguales
- **And** fixtures inválidas que nunca fueron aceptadas siguen fallando cerradas

### CR6 — El preview valida el snapshot candidato cerrado y el plan editado
- **Given** un plan cuyas resoluciones requeridas están seleccionadas y cuyos
  documentos son válidos, legacy-normalizables o tienen reemplazos explícitos
- **When** se ejecuta `state migrate --preview --plan <plan>`
- **Then** construye en memoria el mismo snapshot candidato que usaría
  `--create` (aplicando solo normalizaciones y reemplazos explícitamente
  elegidos), revalida sources, digest, decisiones y hashes y aplica las mismas
  reglas locales y globales de `checkRepo`, incluidos ids duplicados,
  dependencias ausentes o cíclicas, graduaciones, releases y config
- **And** un fallo de esas reglas globales también rechaza la source completa,
  igual que `--create`, nombrando las identidades y paths involucrados
- **And** si sources, plan y resoluciones no cambian, un preview verde no puede
  fallar en create por ninguna regla de validación local o global ya evaluada
- **And** no publica baseline ni modifica refs, worktree, config o estado
  público; la observación remota conserva la semántica existente de fetch de
  objetos inmutables sin mover refs del usuario

## Plan

- [x] Versionar en `test/fixtures/` casos mínimos de tareas/Log legacy y una fixture integral para el comportamiento de `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` en SHA-1/SHA-256 (CR1, CR4, CR5)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Extender `src/state-migration.mjs` con diagnósticos y decisiones de compatibilidad por documento, hashes y reglas versionadas; verify: `node --test test/state-migration.test.mjs` cubriendo determinismo, no-escritura e integridad/TOCTOU (CR1, CR2)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Construir en `src/state-migration.mjs` el snapshot normalizado sin mutar sources/worktree y conservar procedencia en el manifest; verify: `node --test test/state-migration.test.mjs` cubriendo create/activate/recovery y comparación byte-a-byte (CR2, CR3, CR5)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Extender `src/state-migration.mjs` con tests fallidos de incompatibilidades globales entre documentos individualmente válidos y ejecutar sobre el preview el mismo candidato cerrado y `checkRepo` que usa create; verify: `node --test test/state-migration.test.mjs` cubriendo ids duplicados, dependencias/ciclos, graduación, releases y config sin escrituras (CR6)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Mejorar en `src/state-migration.mjs` el error de estructuras no normalizables con identidad y path; verify: `node --test test/state-migration.test.mjs` con resolución humana fail-closed (CR4)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Ejecutar la matriz focalizada y `pnpm verify` (support)
  - **Resolved:** `2026-07-23T10:23:13Z`
- [x] Clasificar en `src/state-migration.mjs` los changes legacy reconocidos pero no normalizables como `requires-replacement` y versionar en `test/fixtures/` regresiones para los 10 bloqueos del ledger real, sin relajar los rechazos de Git/UTF-8/parsing/identidad; verify: `node --test test/state-migration.test.mjs` (CR1, CR4, CR5)
  - **Resolved:** `2026-07-23T11:28:04Z`
- [x] Añadir en `src/state-migration.mjs`, `src/commands/state.mjs`, `bin/changeledger.mjs`, `templates/contract/core.md` y `README.md` `state migrate --preview --plan <plan>` para revalidar en memoria sources, inventario, decisiones, reemplazos, normalizaciones y el snapshot cerrado sin escrituras; verify: `node --test test/state-migration.test.mjs test/context.test.mjs test/cli-bin.test.mjs` (CR2, CR6)
  - **Resolved:** `2026-07-23T11:28:05Z`
- [x] Completar para `src/state-migration.mjs` en `test/state-migration.test.mjs` el flujo end-to-end preview→resolución→preview-plan→create→activate en SHA-1 y SHA-256, incluida una prevalidación read-only del commit real de backend-laravel; verify: `node --test test/state-migration.test.mjs` y evidencia en Log (CR3, CR5, CR6)
  - **Resolved:** `2026-07-23T11:28:05Z`
- [x] Ejecutar la matriz focalizada y `pnpm verify` tras la corrección (support)
  - **Resolved:** `2026-07-23T11:28:05Z`

- [x] Restringir en `src/state-migration.mjs` los residuos `requires-replacement` a errores legacy reconocidos de Plan/Log y añadir regresiones de defecto mixto no relacionado en `test/state-migration.test.mjs`; verify: `node --test test/state-migration.test.mjs` en SHA-1/SHA-256 (CR1, CR4, CR5)
  - **Resolved:** `2026-07-23T11:48:06Z`

- [x] Vincular en `src/state-migration.mjs` la identidad, kind y basename del reemplazo con el documento del plan durante preview/create/activation y añadir sustituciones adversariales en `test/state-migration.test.mjs`; verify: `node --test test/state-migration.test.mjs` en SHA-1/SHA-256 (CR2, CR3, CR4, CR6)
  - **Resolved:** `2026-07-23T11:48:06Z`

- [x] Exigir en `src/state-migration.mjs` procedencia legacy de la misma sección para cada residuo reemplazable y cubrir en `test/state-migration.test.mjs` que Plan legacy no oculte una contradicción de Log ya tipado; verify: `node --test test/state-migration.test.mjs` en SHA-1/SHA-256 y preflight read-only real (CR1, CR4, CR5, CR6)
  - **Resolved:** `2026-07-23T11:55:12Z`

## Log

- **2026-07-22T18:50:43Z** `[note]` Draft creado por el hallazgo alto LEGACY-02 de la auditoría 20260721-193106; no se implementa dentro del audit.
- **2026-07-22T20:41:30Z** `[note]` Readiness reforzada: preview debe validar el snapshot candidato cerrado con las mismas reglas locales y globales de create, no solo clasificar documentos individualmente.
- **2026-07-23T09:28:13Z** `[status]` draft → approved
- **2026-07-23T09:32:19Z** `[status]` approved → in-progress
- **2026-07-23T09:32:19Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T09:45:00Z** `[note]` Aclaración humana de alcance: la implementación inicial de CR1/CR4 abortaba el preview entero al primer `parseChange`/`parseSpec`/`parseYaml` fallido, lo que habría relajado `20260721-193103` CR3 ("documento inválido" → rechaza la source completa) y el mensaje exacto de `20260722-163405` CR1 para blobs no UTF-8. Decisión: ninguno de esos dos contratos se toca. CR1/CR4/CR6 se acotan a una única válvula de escape: un change cuya única incompatibilidad es metadata de tarea legacy o Log no tipado, emparejado por el normalizador versionado `migrateStructuredSections`, se clasifica legacy-normalizable en vez de abortar. Estructura Git hostil, encoding, documentos no parseables, sin identidad derivable o legacy no cubierto por el normalizador siguen rechazando la source completa; CR4 ahora exige que ese rechazo nombre identidad/source/commit/path en vez de un resumen repo-wide. `related_to` gana `20260722-163405`.
- **2026-07-23T10:23:31Z** `[note]` Implementado: candidateFromEntry gana una única válvula de escape (change legacy vía migrateStructuredSections, rule structured-sections v1) que clasifica compatibility valid/legacy sin relajar el resto — cualquier otra causa (Git hostil, encoding, no parseable, sin identidad, legacy ambiguo) sigue rechazando la source completa nombrando identidad/source/commit/path (CR1,CR4). create exige resolution.normalize explícito antes de aplicar la normalización y registra blob original + regla/versión + hash en manifest.decisions; validateManifestDecisions verifica el blob normalizado contra ese hash en activate (CR2,CR3). previewStateMigration corre candidateSnapshot en modo simulate (checkRepo con nuevo opts.aggregateOnly en check.mjs) cuando todas las resoluciones están determinadas, sin escribir nada (CR6). Fixtures reales test/fixtures/legacy-ledger{,-unnormalizable}/ basadas en el formato legacy real de este propio repo (commit 75de8cba). 42/42 tests de state-migration (SHA-1/SHA-256), pnpm verify completo: 954/954 tests, lint y changeledger check limpios.
- **2026-07-23T10:23:37Z** `[status]` in-progress → in-review
- **2026-07-23T10:38:16Z** `[review]` in-review → in-progress (retry): classifyLegacyChange checked !migrated.changed before migrated.manual.length; migrateStructuredSections can leave text byte-identical (changed:false) while still recording an unmigratable defect in manual (e.g. a lone untyped Log line with no other legacy pattern), so that document was silently classified compatible:true at preview, then rejected later at create -- breaking CR1 preview/create parity and CR4's untyped-Log case.
- **2026-07-23T10:44:39Z** `[status]` in-progress → in-review
- **2026-07-23T10:51:19Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-23T10:51:39Z** `[note]` Corrección tras review fail-retry (revisor 1): classifyLegacyChange chequeaba !migrated.changed antes que migrated.manual.length -- un evento de Log sin timestamp reconocible sin otro patrón legacy que reescribir (changed:false, manual poblado) se clasificaba compatible:true, rompiendo paridad preview/create de CR1 y el caso de CR4. Orden corregido; fixture y test de regresión aislado (test/fixtures/legacy-ledger-untyped-log-only/, sha1/sha256) agregados. Revisor 2 (independiente) encontró un segundo bug antes de que se registrara el pass: candidateSnapshot en modo simulate corría checkRepo con opts.aggregateOnly, que se saltaba TODO chequeo local (frontmatter, stages, tasks, secuencia de Log) -- un change moderno no-legacy con un defecto local ordinario (ej. falta title) tenía preview verde y sólo fallaba en create, violando CR1/CR6. Corrección: aggregateOnly eliminado por completo de check.mjs; candidateSnapshot en simulate corre el mismo checkRepo completo que create (única diferencia inerte: skipAdvisory, que sólo afecta warnings ya descartadas por ambos llamadores). Test 202101 CR1 actualizado (preview ahora también produce el diagnóstico acotado, no sólo create) y test nuevo con un change moderno con defecto local aislado. Revisor 3 (independiente, contexto limpio) verificó ambas correcciones combinadas: PASS. 141/141 focused, 957/957 pnpm verify, lint y changeledger check limpios.
- **2026-07-23T11:05:33Z** `[validation]` in-validation → in-progress (agent rejected): Audit found that the real backend-laravel ledger still aborts on 8 historically accepted manual legacy documents, edited divergent plans cannot be previewed read-only, and SHA-256 lacks end-to-end migration coverage.
- **2026-07-23T11:05:33Z** `[note]` Alcance de corrección autorizado por el humano: incorporar `requires-replacement` solo para changes parseables, con identidad derivable y secciones legacy reconocidas que no admiten normalización sin pérdida; agregar preview read-only del plan editado; y cerrar la matriz end-to-end SHA-1/SHA-256. Los contratos fail-closed de Git hostil, UTF-8, parsing e identidad permanecen intactos.
- **2026-07-23T11:28:19Z** `[note]` Corrección integral tras auditoría: el plan distingue valid, legacy-normalizable y requires-replacement. La última clasificación solo se activa después de parseChange e identidad derivable cuando migrateStructuredSections reconoce secciones legacy pero reporta decisiones manuales o deja errores residuales; Git hostil, UTF-8, parsing e identidad permanecen fail-closed. Reemplazos quedan resolution:null hasta que el operador aporta replacement+basename+sha256; preview-plan y create revalidan source OIDs, inventario, decisión, hash y el mismo snapshot cerrado. El modo nuevo state migrate --preview --plan valida el plan editado sin publicar y exige normalizaciones explícitas. Regresión versionada: 10 casos reales equivalentes (6 Log sin timestamp, 2 tareas ambiguas, 1 contradicción de lifecycle, 1 readiness legacy) más preview de divergencias y replacement TOCTOU. Matriz end-to-end preview→preview-plan→create→activate pasa en SHA-1 y SHA-256. Preflight read-only real de backend-laravel@d73df41f: 184 documentos, 135 legacy-normalizable, 10 requires-replacement, written:false, network:false, baseline:null; source ref intacta y refs/heads/changeledger/state ausente. Gate completo fuera del sandbox: Biome limpio, 963/963 tests, changeledger check 234/234.
- **2026-07-23T11:28:30Z** `[status]` in-progress → in-review
- **2026-07-23T11:37:50Z** `[review]` in-review → in-progress (retry): A recognized legacy rewrite can launder unrelated residual validation errors into requires-replacement, and replacement content/hash is not bound to the plan document identity in preview/create or activation. Add fail-closed mixed-defect and identity-substitution regressions in SHA-1/SHA-256.
- **2026-07-23T11:48:11Z** `[note]` Corrección adversarial completada: defectos ajenos a Plan/Log vuelven a rechazar la fuente; reemplazos vinculados a identidad/kind/basename en preview, create y activation; 56/56 tests de state-migration pasan en SHA-1/SHA-256. Preflight read-only sobre backend-laravel d73df41: 184 documentos = 39 válidos + 135 normalizables + 10 requires-replacement; written=false, network=false, branch/tree/state ref sin cambios.
- **2026-07-23T11:48:31Z** `[status]` in-progress → in-review
- **2026-07-23T11:54:50Z** `[review]` in-review → in-progress (retry): Plan legacy could authorize an unrelated fully typed Log/frontmatter contradiction; require same-section legacy provenance and add SHA-1/SHA-256 cross-section regression.
- **2026-07-23T11:55:12Z** `[note]` Corrección de tercera revisión: cada residuo requiere procedencia legacy de su propia sección (Plan por task metadata migrada; Log por eventos migrados), eliminando el acoplamiento manual Plan→Log. Regresión adversarial SHA-1/SHA-256 confirma que una tarea ambigua no oculta una contradicción de Log ya tipado. Fixtures de readiness/lifecycle reproducen su sintaxis legacy real por sección. Preflight backend-laravel@d73df41 preserva 184 = 39 válidos + 135 normalizables + 10 reemplazos, sin escrituras ni cambios de refs/árbol.
- **2026-07-23T11:56:04Z** `[status]` in-progress → in-review
- **2026-07-23T12:01:06Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-24T16:45:16Z** `[validation]` in-validation → done (human accepted)
