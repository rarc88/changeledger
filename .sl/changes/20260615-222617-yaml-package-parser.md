---
id: "20260615-222617"
title: Usar un parser YAML maduro para frontmatter y config
type: refactor
status: done
created: 2026-06-15T22:26:17Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Reevaluar el parser YAML propio y reemplazarlo por una dependencia madura cuando
eso simplifique mantenimiento sin convertir Spec Ledger en una herramienta pesada.

## Proposal

Adoptar el paquete `yaml` para parsear y serializar YAML en `.sl/config.yml`,
frontmatter de changes y specs. La dependencia está enfocada, mantenida, no
arrastra dependencias transitivas runtime y cubre un dominio donde los detalles
del formato crecen rápido.

Alcance propuesto:

- Mantener el delimitador de frontmatter (`---`) como lógica local pequeña.
- Reemplazar el parser/serializer YAML propio por llamadas a `yaml`.
- Conservar validaciones de dominio en Spec Ledger: claves requeridas, tipos,
  stages, lifecycle, ids, referencias y protección contra rutas.
- Preservar la salida estable que los tests esperan, ajustando snapshots o tests
  solo cuando el nuevo serializador produzca YAML equivalente y más correcto.

Alternativas:

- `gray-matter`: útil si queremos delegar también la extracción de frontmatter,
  pero aporta más superficie para un problema que ya está bien delimitado.
- Seguir con parser propio: aceptable mientras el subset sea mínimo, pero la
  auditoría ya mostró que este punto concentra deuda y riesgo de compatibilidad.

## Plan

- [x] Añadir `yaml` como dependencia runtime justificada en `package.json` y documentación — 2026-06-15T22:55:08Z
- [x] Reemplazar parseo/serialización en `src/yaml.mjs` o aislar el wrapper allí para minimizar cambios de importación — 2026-06-15T22:55:08Z
- [x] Mantener tests de seguridad existentes: prototype pollution, claves duplicadas y coerción esperada — 2026-06-15T22:56:51Z
- [x] Añadir casos de YAML válidos que hoy sean frágiles o difíciles para el parser propio — 2026-06-15T22:55:08Z
- [x] Revisar comandos que escriben frontmatter (`status`, `task`, `owner`, `graduate`) para confirmar que no dependen de detalles accidentales del serializer actual — 2026-06-15T22:55:08Z
- [x] Ejecutar `pnpm test -- test/yaml.test.mjs test/change.test.mjs test/spec.test.mjs test/writer.test.mjs test/check.test.mjs` y `pnpm check` — 2026-06-15T22:55:08Z

## Log
- **2026-06-15T22:38:26Z** — status: draft → approved
- **2026-06-15T22:52:36Z** — status: approved → in-progress
- **2026-06-15T22:52:36Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:55:13Z** — status: in-progress → in-review
- **2026-06-15T22:56:41Z** — review → in-progress (retry): Plan pendiente detectado por revisión independiente
- **2026-06-15T22:56:54Z** — status: in-progress → in-review
- **2026-06-15T22:58:16Z** — review → in-progress (retry): AGENTS.md mantenía política runtime zero deps obsoleta
- **2026-06-15T22:58:32Z** — status: in-progress → in-review
- **2026-06-15T23:00:48Z** — review → in-progress (retry): parseYaml aceptaba escalares/arrays top-level y rompía validaciones de dominio
- **2026-06-15T23:01:07Z** — status: in-progress → in-review
- **2026-06-15T23:02:34Z** — review → done (delegated subagent, clean context)
- **2026-06-15T23:02:40Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:24Z** — archived
