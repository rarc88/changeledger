---
id: "20260614-192817"
title: Confinar changes_dir y specs_dir dentro del repositorio
type: bug
status: approved
created: 2026-06-14T19:28:17Z
depends_on: []
---

## Request

Impedir que `changes_dir` o `specs_dir` configurados apunten fuera de la raíz
del repositorio. Todos los comandos deben leer y escribir únicamente dentro del
repo Spec Ledger que descubrieron.

## Investigation

- Varias rutas se construyen con `path.join(repoRoot, config.changes_dir)` y el
  equivalente de `specs_dir`, sin comprobar el resultado.
- Valores como `../outside` resuelven fuera del repo y afectan carga, creación,
  mutaciones, graduación, check, búsqueda y visor.
- Un repositorio clonado no es necesariamente confiable. Ejecutar `sl view`,
  `sl check` o un comando de escritura no debe convertir su config en una
  capacidad arbitraria sobre el filesystem.
- La validación debe considerar separadores de plataforma, rutas absolutas,
  normalización y symlinks existentes en los directorios objetivo.

## Specification

### CR1 — Traversal se rechaza
- **Given** `changes_dir: ../outside`
- **When** cualquier comando intenta resolver el repositorio
- **Then** falla con un mensaje que identifica `changes_dir`
- **And** no lee ni escribe fuera de la raíz

### CR2 — Ruta absoluta se rechaza
- **Given** un `changes_dir` o `specs_dir` absoluto
- **When** se carga la configuración
- **Then** se rechaza antes de acceder al directorio

### CR3 — Symlink de escape se rechaza
- **Given** un directorio configurado dentro del repo que es symlink a una ruta
  externa
- **When** un comando va a leer o escribir allí
- **Then** se rechaza el escape
- **And** no modifica el target externo

### CR4 — Rutas internas válidas funcionan
- **Given** las rutas por defecto y una ruta interna normalizada
- **When** se ejecutan `new`, `check`, `graduate` y `view`
- **Then** mantienen su comportamiento actual

## Plan

- [ ] Crear un resolvedor compartido que valide rutas relativas y containment real dentro de `repoRoot` — módulo de paths/config (CR1, CR2, CR3)
- [ ] Sustituir resoluciones directas en carga y comandos por el helper compartido — `src/repo.mjs`, `src/commands/*.mjs` afectados (CR1, CR2, CR3, CR4)
- [ ] Añadir validación accionable en `sl check` para ambos campos de config (CR1, CR2, CR3)
- [ ] Añadir tests de traversal, absoluta, symlink externo y rutas internas en las plataformas soportadas — tests de repo/CLI/graduate (CR1, CR2, CR3, CR4)
- [ ] Ejecutar `pnpm verify` (CR1, CR2, CR3, CR4)

## Log
- **2026-06-15T11:38:40Z** — status: draft → approved
