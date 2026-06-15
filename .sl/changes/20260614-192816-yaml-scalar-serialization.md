---
id: "20260614-192816"
title: Preservar escalares al generar frontmatter YAML
type: bug
status: done
created: 2026-06-14T19:28:16Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Preservar exactamente los valores de texto que el CLI escribe en frontmatter.
Títulos, owners y nombres de proyecto no deben cambiar de tipo, truncarse por
comentarios YAML ni producir documentos inválidos al volver a cargarlos.

## Investigation

- `newChange`, `graduate`, `setOwner` e `init` interpolan valores directamente
  después de `key:` sin serialización YAML.
- El parser coerciona escalares: `true` pasa a booleano, `123` a número y
  `[draft]` a array.
- Un valor como `hello # world` se vuelve `hello` porque el resto se interpreta
  como comentario.
- Saltos de línea, comillas y caracteres de control tampoco tienen una política
  de escritura centralizada.
- El problema no se resuelve endureciendo solo el parser: los archivos generados
  deben ser YAML válido e interoperable con parsers estándar.

## Specification

### CR1 — Títulos ambiguos siguen siendo strings
- **Given** títulos `true`, `123`, `[draft]` y `hello # world`
- **When** `sl new` escribe y vuelve a leer cada change
- **Then** cada `frontmatter.title` es el string original exacto

### CR2 — Owners se preservan
- **Given** un owner con `#`, `:`, comillas o aspecto booleano/numérico
- **When** `sl owner` lo escribe y el repo se recarga
- **Then** el owner es el string original exacto

### CR3 — Graduación produce YAML válido
- **Given** un change con un título que requiere escaping YAML
- **When** se gradúa a un spec
- **Then** el spec se puede parsear
- **And** conserva el título exacto tanto en frontmatter como en el heading

### CR4 — Identidad de proyecto se preserva
- **Given** un directorio cuyo nombre requiere quoting YAML
- **When** `sl init` genera `project_name`
- **Then** la configuración se vuelve a cargar con el nombre exacto

## Plan

- [x] Introducir un serializador único para escalares YAML del subconjunto soportado — 2026-06-15T11:40:49Z
- [x] Usar el serializador al generar changes y specs — 2026-06-15T11:40:50Z
- [x] Usar el serializador en mutaciones de frontmatter e identidad de proyecto — 2026-06-15T11:40:50Z
- [x] Añadir tests round-trip con comentarios, tipos ambiguos, comillas, dos puntos y saltos de línea o rechazo explícito de estos últimos — 2026-06-15T11:40:50Z
- [x] Ejecutar `pnpm verify` (CR1, CR2, CR3, CR4) — 2026-06-15T11:40:50Z

## Log
- **2026-06-15T11:38:39Z** — status: draft → approved
- **2026-06-15T11:39:08Z** — status: approved → in-progress
- **2026-06-15T11:39:08Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T11:40:50Z** — status: in-progress → done
