---
id: "20260711-103802"
title: Retirar el comando unarchive sin uso
type: refactor
status: in-progress
created: 2026-07-11T10:38:02Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
---

## Request

`changeledger unarchive <id>` no registra ni un solo uso observado: cero
menciones en los 325 changes de los tres repos analizados (las dos únicas
apariciones en este repo son el change que lo introdujo y la restauración del
contrato) y cero commits que lo referencien. El INTENT trata la complejidad del
core como presupuesto: la superficie muerta se retira.

## Proposal

- Eliminar el subcomando `unarchive` de `bin/changeledger.mjs`, la rama
  `unarchived` de `src/commands/agent.mjs`, su mención en el help general y sus
  tests.
- La reversión de un archivado accidental queda como edición manual del
  frontmatter (`archived: false`) — los archivos son la fuente de verdad — y se
  documenta en una línea del help de `changeledger archive`.
- Impacto de release: retirar un comando es breaking, pero en pre-1.0 se
  entrega como `minor` según la convención SemVer 0.x.

Alternativas descartadas:

- Mantenerlo como "undo barato": su coste real es superficie de CLI, help,
  docs y tests para un caso jamás observado en dos meses de uso; la edición
  manual cubre la emergencia sin coste permanente.
- Ocultarlo del help conservando el código: superficie zombie, peor que
  cualquiera de las dos opciones anteriores.

## Plan

- [ ] Eliminar el subcomando y su implementación en `bin/changeledger.mjs` y `src/commands/agent.mjs`, incluidos sus tests (support)
- [ ] Añadir la nota de reversión manual al help de `archive` en `bin/changeledger.mjs` (support)
- [ ] Buscar y retirar menciones de `unarchive` en `templates/contract/` y specs del repo (support)
- [ ] Ejecutar `pnpm verify` completo tras la implementación (support)

## Log
- **2026-07-11T10:47:27Z** — status: draft → approved
- **2026-07-11T10:53:20Z** — status: approved → in-progress
- **2026-07-11T10:53:20Z** — owner → raruiz-hiberuscom (auto)
