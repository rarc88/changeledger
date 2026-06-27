---
id: "20260615-175731"
title: Symlink intermedio permite escapar del repositorio
type: bug
status: done
created: 2026-06-15T17:57:31Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Cerrar el bypass de containment que permite que `changes_dir` o `specs_dir`
atraviesen un symlink situado en un componente intermedio de una ruta cuyo
destino final todavía no existe. Ningún comando debe crear, leer o modificar
contenido fuera de la raíz del repositorio descubierto.

## Investigation

- `resolveRepoPath` valida por forma que la ruta resuelta permanezca bajo
  `repoRoot`, pero solo compara rutas reales cuando el destino final ya existe.
- Si `.sl/escape` es un symlink a un directorio externo y la configuración usa
  `.sl/escape/newdir`, `fs.existsSync(resolved)` es falso mientras `newdir` no
  exista. La validación retorna la ruta y un `mkdirSync(..., { recursive: true })`
  crea `newdir` en el target externo.
- La auditoría reprodujo el escape con el helper público: la ruta fue aceptada y
  el directorio apareció fuera del repositorio.
- El change `20260614-192817` cubrió traversal, rutas absolutas y el caso donde
  el directorio objetivo completo ya era symlink. Este defecto es el caso
  residual de un **ancestro existente** que es symlink y un **destino final
  inexistente**; por eso se registra como bug nuevo y no reabre aquel contrato.

## Specification

### CR1 — Ancestro symlink externo se rechaza
- **Given** un repositorio donde `.sl/escape` es symlink a un directorio externo
- **And** `changes_dir` apunta a `.sl/escape/newdir`, que todavía no existe
- **When** un comando resuelve o intenta crear `changes_dir`
- **Then** falla antes de crear el directorio
- **And** no modifica el target externo

### CR2 — Ancestro symlink interno sigue permitido
- **Given** un componente intermedio que es symlink a otro directorio dentro del
  mismo repositorio
- **When** se resuelve un destino hijo existente o inexistente
- **Then** la ruta se acepta
- **And** el destino real permanece bajo la raíz real del repositorio

### CR3 — Lecturas y escrituras comparten la protección
- **Given** el escape mediante un symlink intermedio
- **When** se ejecutan rutas de carga, `new`, `graduate`, `check` o `view`
- **Then** todas rechazan el mismo escape mediante el resolvedor compartido

### CR4 — Rutas normales conservan su comportamiento
- **Given** las rutas por defecto y rutas internas sin escape
- **When** se ejecuta el quality gate
- **Then** carga, creación, graduación y visor continúan funcionando

## Plan

- [x] Añadir un test de regresión en `test/repo.test.mjs` con symlink intermedio externo y destino final inexistente (CR1) — 2026-06-15T18:31:37Z
- [x] Endurecer `resolveRepoPath` en `src/config.mjs` comprobando la cadena existente de ancestros contra la raíz real (CR1, CR2) — 2026-06-15T18:31:38Z
- [x] Cubrir destino existente/inexistente y symlink interno/externo en las plataformas soportadas (CR1, CR2, CR3) — 2026-06-15T18:31:38Z
- [x] Ejecutar `pnpm verify` y el smoke test del tarball (CR3, CR4) — 2026-06-15T18:31:38Z

## Log
- **2026-06-15T18:29:26Z** — status: draft → approved
- **2026-06-15T18:30:40Z** — status: approved → in-progress
- **2026-06-15T18:30:40Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T18:31:38Z** — fix: realpath del ancestro existente más cercano cierra el escape por symlink intermedio (CR1); symlink interno sigue permitido (CR2)
- **2026-06-15T18:31:53Z** — status: in-progress → in-review
- **2026-06-15T18:32:52Z** — review → done (delegated subagent, clean context)
- **2026-06-15T20:47:34Z** — graduation skipped: bug de containment; sin verdad persistente nueva
- **2026-06-15T21:17:58Z** — archived
