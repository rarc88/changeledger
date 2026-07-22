---
id: "20260722-185043"
title: Permitir migrar ledgers legacy previamente aceptados
type: bug
status: draft
created: 2026-07-22T18:50:43Z
depends_on: ["20260721-193103"]
related_to: ["20260721-193106", "20260720-125007"]
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

## Specification

### CR1 — El preview diagnostica compatibilidad por documento
- **Given** una source con cualquier documento que `--create` rechazaría —
  metadata de tareas antigua, eventos de Log no tipados u otra incompatibilidad
  estructural
- **When** se ejecuta `state migrate --preview`
- **Then** el plan clasifica cada documento como válido, legacy normalizable
  (con la transformación segura disponible) o inválido nunca soportado (con el
  motivo que exige resolución humana), identificando source, commit, path y
  blob originales
- **And** preview y create coinciden: ningún documento verde en preview puede
  fallar en create por la misma regla
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

### CR4 — Lo no normalizable falla cerrado
- **Given** un documento cuya intención no puede preservarse mecánicamente
- **When** preview o create lo procesa
- **Then** no publica estado y exige una decisión humana específica para ese
  documento
- **And** el diagnóstico no se pierde en una lista repo-wide sin paths

### CR5 — La regresión cubre un ledger legacy representativo
- **Given** una fixture versionada equivalente al ledger real auditado, incluido
  un change como `20260716-124623`
- **When** se ejecutan preview, resolución, create y activate en SHA-1 y SHA-256
- **Then** el ledger migra sin pérdida semántica y las sources permanecen
  byte-a-byte iguales
- **And** fixtures inválidas que nunca fueron aceptadas siguen fallando cerradas

## Plan

- [ ] Versionar en `test/fixtures/` casos mínimos de tareas/Log legacy y una fixture integral para el comportamiento de `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` en SHA-1/SHA-256 (CR1, CR4, CR5)
- [ ] Extender `src/state-migration.mjs` con diagnósticos y decisiones de compatibilidad por documento, hashes y reglas versionadas; verify: `node --test test/state-migration.test.mjs` cubriendo determinismo, no-escritura e integridad/TOCTOU (CR1, CR2)
- [ ] Construir en `src/state-migration.mjs` el snapshot normalizado sin mutar sources/worktree y conservar procedencia en el manifest; verify: `node --test test/state-migration.test.mjs` cubriendo create/activate/recovery y comparación byte-a-byte (CR2, CR3, CR5)
- [ ] Mejorar en `src/state-migration.mjs` el error de estructuras no normalizables con identidad y path; verify: `node --test test/state-migration.test.mjs` con resolución humana fail-closed (CR4)
- [ ] Ejecutar la matriz focalizada y `pnpm verify` (support)

## Log

- **2026-07-22T18:50:43Z** `[note]` Draft creado por el hallazgo alto LEGACY-02 de la auditoría 20260721-193106; no se implementa dentro del audit.
