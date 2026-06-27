---
id: "20260615-175733"
title: El parser YAML permite prototype pollution y claves duplicadas
type: bug
status: done
created: 2026-06-15T17:57:33Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Endurecer el parser YAML mínimo para que archivos controlados por un repositorio
no alteren el prototipo de los objetos resultantes ni oculten errores mediante
claves duplicadas. La configuración y el frontmatter deben producir estructuras
de datos explícitas y deterministas.

## Investigation

- `parseYaml` y `build` crean objetos con `{}` y asignan claves directamente.
- La clave especial `__proto__` cambia el prototipo del objeto en vez de quedar
  como propiedad normal. La auditoría reprodujo un objeto cuyo
  `frontmatter.polluted` se heredaba desde el prototipo.
- Claves como `status` repetidas se sobrescriben silenciosamente; el último valor
  gana y `sl check` no puede informar que el documento era ambiguo.
- El parser procesa contenido de repos clonados en `sl check`, comandos y visor.
  Aunque no se observó una cadena de explotación adicional, aceptar estructuras
  con prototipo controlado amplía innecesariamente la superficie y puede alterar
  validaciones basadas en `in`, acceso de propiedades o enumeración.
- El change `20260614-192816` corrigió la **serialización** y round-trip de
  escalares escritos por el CLI. Este concern es la seguridad e integridad del
  **parser**, por lo que no duplica ese contrato.

## Specification

### CR1 — Claves de prototipo no contaminan objetos
- **Given** YAML con claves `__proto__`, `prototype` o `constructor`
- **When** se parsea una configuración, change o spec
- **Then** el resultado no hereda propiedades controladas por el documento
- **And** `Object.prototype` permanece intacto

### CR2 — Claves duplicadas se rechazan
- **Given** dos entradas con la misma clave en el mismo nivel de indentación
- **When** se parsea el documento
- **Then** el parser falla con un mensaje que identifica la clave duplicada
- **And** no selecciona silenciosamente uno de los valores

### CR3 — La detección respeta niveles
- **Given** una clave con el mismo nombre en mapas anidados diferentes
- **When** se parsea el documento
- **Then** ambos valores se conservan porque pertenecen a niveles distintos

### CR4 — El subconjunto YAML soportado no cambia
- **Given** los configs y frontmatters válidos actuales
- **When** se ejecutan parser, CLI, check y viewer
- **Then** escalares, arrays inline, comentarios y mapas anidados mantienen su
  comportamiento documentado

## Plan

- [x] Añadir tests de regresión en `test/yaml.test.mjs` para prototype pollution, claves reservadas y duplicados por nivel (CR1, CR2, CR3) — 2026-06-15T18:37:44Z
- [x] Construir mapas del parser con una representación sin prototipo o rechazar explícitamente claves peligrosas (CR1) — 2026-06-15T18:37:44Z
- [x] Detectar claves duplicadas durante `build` y emitir errores accionables sin romper mapas anidados válidos (CR2, CR3) — 2026-06-15T18:37:44Z
- [x] Ejecutar `pnpm verify` y smoke de carga de config/change/spec existentes (CR4) — 2026-06-15T18:37:44Z

## Log
- **2026-06-15T18:29:26Z** — status: draft → approved
- **2026-06-15T18:35:32Z** — status: approved → in-progress
- **2026-06-15T18:35:33Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T18:37:44Z** — fix: build() rechaza claves reservadas (__proto__/constructor/prototype) (CR1) y duplicados por nivel via Object.hasOwn (CR2); niveles anidados intactos (CR3)
- **2026-06-15T18:37:54Z** — status: in-progress → in-review
- **2026-06-15T18:39:07Z** — review → done (delegated subagent, clean context)
- **2026-06-15T20:47:34Z** — graduation skipped: bug de hardening del parser; sin verdad persistente nueva
- **2026-06-15T21:17:59Z** — archived
