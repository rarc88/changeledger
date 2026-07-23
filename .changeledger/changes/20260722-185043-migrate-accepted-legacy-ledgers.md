---
id: "20260722-185043"
title: Permitir migrar ledgers legacy previamente aceptados
type: bug
status: in-validation
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

Acotación de alcance (decisión humana, ver Log): `20260721-193103` CR3 ya
exige que cualquier documento inválido rechace la source completa nombrando
OID y path; `20260722-163405` CR1 exige el mismo fail-closed, con mensaje
exacto, para blobs no UTF-8. Ninguno de los dos se relaja. Esta change abre una
única válvula de escape, estrecha y versionada: un change cuya única
incompatibilidad es metadata de tarea legacy o un evento de Log no tipado, y
que un normalizador explícito (`migrateStructuredSections`) puede reescribir
sin pérdida semántica, se clasifica como legacy-normalizable en vez de
abortar. Cualquier otra causa — estructura Git hostil, encoding, documento no
parseable, sin identidad derivable, o legacy que el normalizador no cubre —
sigue rechazando la source completa exactamente como hoy.

## Specification

### CR1 — El preview diagnostica compatibilidad legacy por change
- **Given** una source con un change cuya única incompatibilidad es metadata de
  tareas antigua o eventos de Log no tipados, aceptados por una versión previa
  soportada de ChangeLedger y cubiertos por el normalizador versionado
  `migrateStructuredSections`
- **When** se ejecuta `state migrate --preview`
- **Then** el plan clasifica ese change como válido o legacy normalizable (con
  la regla/versión del normalizador aplicable), identificando source, commit,
  path y blob originales
- **And** preview y create coinciden: ningún documento verde en preview puede
  fallar en create por la misma regla
- **And** cualquier otra causa de rechazo — estructura Git hostil, encoding no
  UTF-8, documento no parseable, sin identidad derivable, o metadata legacy que
  el normalizador no cubre — sigue rechazando la source completa exactamente
  como hoy (`20260721-193103` CR3, `20260722-163405` CR1 permanecen intactos)
- **And** no modifica objetos, refs, worktree, config ni estado público

### CR2 — La normalización es explícita e inmutable
- **Given** un plan con incompatibilidades transformables sin pérdida semántica
- **When** el operador selecciona su resolución
- **Then** el plan registra por documento el blob original, la regla/version de
  normalización y el hash exacto del resultado
- **And** `--create` revalida sources, decisiones y hashes antes de publicar
- **And** ninguna normalización ocurre implícitamente

### CR3 — El cutover no muta la verdad legacy
- **Given** un plan resuelto de compatibilidad
- **When** se crea el baseline
- **Then** la transformación se aplica al snapshot candidato sin escribir las
  ramas fuente ni el worktree
- **And** el manifest conserva procedencia suficiente para auditar contenido
  original y resultado normalizado

### CR4 — Lo no cubierto por el normalizador sigue fatal para la source
- **Given** un change cuyo defecto no coincide con ningún normalizador
  versionado (p. ej. metadata de tarea ambigua, evento de Log sin timestamp
  reconocible) — o cualquier otro documento estructuralmente inválido
- **When** preview o create lo procesa
- **Then** rechaza la source completa, igual que hoy (`20260721-193103` CR3)
- **And** el mensaje nombra identidad, source, commit y path del documento en
  vez de perderse en un resumen repo-wide sin ubicación
- **And** ninguna normalización se infiere para ese documento

### CR5 — La regresión cubre un ledger legacy representativo
- **Given** una fixture versionada equivalente al ledger real auditado, incluido
  un change como `20260716-124623`
- **When** se ejecutan preview, resolución, create y activate en SHA-1 y SHA-256
- **Then** el ledger migra sin pérdida semántica y las sources permanecen
  byte-a-byte iguales
- **And** fixtures inválidas que nunca fueron aceptadas siguen fallando cerradas

### CR6 — El preview valida el snapshot candidato cerrado
- **Given** un plan cuyas resoluciones requeridas están seleccionadas y cuyos
  documentos son válidos o legacy-normalizables por el normalizador versionado
- **When** se ejecuta `state migrate --preview`
- **Then** construye en memoria el mismo snapshot candidato que usaría
  `--create` (aplicando la normalización elegida) y aplica las mismas reglas
  globales de `checkRepo`, incluidos ids duplicados, dependencias ausentes o
  cíclicas, graduaciones, releases y config
- **And** un fallo de esas reglas globales también rechaza la source completa,
  igual que `--create`, nombrando las identidades y paths involucrados
- **And** si sources, plan y resoluciones no cambian, un preview verde no puede
  fallar en create por ninguna regla de validación local o global ya evaluada
- **And** no escribe objetos, refs, worktree, config ni estado público

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
