---
id: "20260626-174204"
title: Optimizar AGENTS.md para atención de agentes
type: refactor
status: draft
created: 2026-06-26T17:42:04Z
depends_on: []
---

## Request

El contrato canónico `templates/AGENTS.md` está pensado para agentes, no para
humanos. Después de añadir reglas de readiness, trazabilidad, revisión y
delegación, el documento sigue siendo correcto pero empieza a competir por
atención dentro del contexto principal del agente.

Queremos reorganizarlo para que un agente entienda primero el camino operativo
seguro y luego profundice en los detalles cuando los necesite. En particular:

- Añadir un "Agent Fast Path" o equivalente al inicio, con las decisiones que un
  agente debe seguir casi siempre.
- Reducir la sección de helpers de CLI para no mantener una lista extensa que
  pueda volverse ruido; los comandos críticos deben seguir inline, y el resto
  puede apuntar a `sl --help` / `sl <command> --help` si eso es más efectivo.
- Conservar la semántica ya aceptada: lifecycle, ownership humano, readiness,
  revisión independiente, graduación, archivado y delegación económica.

## Proposal

Refactorizar solo la presentación del contrato canónico:

- Introducir una ruta rápida al inicio de `templates/AGENTS.md` que priorice:
  leer el contrato, crear/usar un change, no implementar sin aprobación,
  mantener trazabilidad git, ejecutar revisión cuando aplique, esperar
  validación humana antes de `done`, graduar/archivar al cierre y delegar con
  criterio económico.
- Compactar la sección de CLI helpers para que enseñe los comandos esenciales
  del flujo y remita a `sl --help` / `sl <command> --help` para el resto,
  evitando duplicar documentación que el CLI ya expone.
- Mantener las reglas detalladas debajo como referencia normativa. El objetivo
  es mejorar la atención del agente, no cambiar el contrato.

## Plan

- [ ] Reorganizar `templates/AGENTS.md` con una ruta rápida para agentes y
  verificar que el contrato sigue mencionando los gates críticos.
- [ ] Compactar la sección de CLI helpers, conservando los comandos esenciales y
  apuntando a `sl --help` / `sl <command> --help` para detalle operativo.
- [ ] Ejecutar `node bin/sl.mjs check 20260626-174204` para validar el change.
- [ ] Ejecutar `CI=true pnpm verify` para confirmar que el contrato instalado y
  los tests del repo siguen sanos.

## Log

- **2026-06-26T17:42:04Z** — draft created
