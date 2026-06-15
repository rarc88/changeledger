---
id: "20260615-222617"
title: Usar un parser YAML maduro para frontmatter y config
type: refactor
status: draft
created: 2026-06-15T22:26:17Z
depends_on: []
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

- [ ] Añadir `yaml` como dependencia runtime justificada en `package.json` y documentación
- [ ] Reemplazar parseo/serialización en `src/yaml.mjs` o aislar el wrapper allí para minimizar cambios de importación
- [ ] Mantener tests de seguridad existentes: prototype pollution, claves duplicadas y coerción esperada
- [ ] Añadir casos de YAML válidos que hoy sean frágiles o difíciles para el parser propio
- [ ] Revisar comandos que escriben frontmatter (`status`, `task`, `owner`, `graduate`) para confirmar que no dependen de detalles accidentales del serializer actual
- [ ] Ejecutar `pnpm test -- test/yaml.test.mjs test/change.test.mjs test/spec.test.mjs test/writer.test.mjs test/check.test.mjs` y `pnpm check`

## Log
