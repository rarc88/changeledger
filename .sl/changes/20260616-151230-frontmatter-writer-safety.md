---
id: "20260616-151230"
title: Hacer seguras las mutaciones de frontmatter
type: refactor
status: done
created: 2026-06-16T15:12:30Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Reducir el riesgo de mutaciones silenciosas en frontmatter. La auditoría detectó
que `writer.mjs` edita YAML como texto con regex. Ese enfoque preserva formato,
pero algunos helpers dependen de que exista una línea `depends_on:` o
`updated:`; si el bloque está parcialmente roto, pueden devolver texto sin haber
aplicado la mutación esperada.

## Proposal

Mantener la edición textual para preservar el formato del documento, pero hacer
los helpers fail-fast:

- Cada helper debe comprobar que la línea ancla existe antes de insertar o
  reemplazar.
- Si una mutación requerida no cambia el frontmatter, debe lanzar un error
  explícito.
- Reusar `parseYaml()` como validación estructural posterior del bloque
  frontmatter cuando sea razonable.
- Mantener el output byte-for-byte compatible en documentos sanos.

No se propone reserializar todo el frontmatter todavía: eso simplificaría algunas
mutaciones, pero produciría churn de formato y más riesgo en cambios históricos.

## Plan

- [x] Añadir tests negativos en `test/writer.test.mjs` para `setOwner`, `setArchived` y `setReviewed` cuando falta `depends_on` — 2026-06-16T15:28:18Z
- [x] Añadir test negativo en `test/writer.test.mjs` para `setSpecUpdated` cuando falta `updated` — 2026-06-16T15:28:18Z
- [x] Actualizar `src/writer.mjs` para lanzar errores explícitos cuando no encuentre líneas ancla o no aplique la sustitución — 2026-06-16T15:28:18Z
- [x] Confirmar con tests existentes que los documentos sanos conservan su formato esperado — 2026-06-16T15:28:18Z
- [x] Ejecutar `pnpm verify` y registrar el resultado en `## Log` — 2026-06-16T15:28:19Z

## Log
- **2026-06-16T15:15:16Z** — status: draft → approved
- **2026-06-16T15:27:07Z** — status: approved → in-progress
- **2026-06-16T15:27:07Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T15:28:19Z** — Implemented fail-fast frontmatter anchors; pnpm verify passed with one unrelated support-task warning.
- **2026-06-16T15:28:19Z** — status: in-progress → in-review
- **2026-06-16T15:29:31Z** — review → done (delegated subagent, clean context)
- **2026-06-16T15:29:31Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
