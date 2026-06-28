---
id: "20260628-215632"
title: Treat routine release preparation as operational work
type: feature
status: done
created: 2026-06-28T21:56:32Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Evitar que cada publicación genere automáticamente un chore de preparación de
release. El bump de versión, el manifiesto portable, los gates, el empaquetado,
el commit, el tag y la publicación son pasos operativos de entrega, no cambios
de producto por sí mismos. Documentarlos como changes introduce ruido y una
dependencia circular: el change que prepara el manifiesto puede terminar
intentando incluirse en el mismo manifiesto.

La regla debe estar visible en `changeledger context release`, que es el
contexto que consulta un agente al preparar una entrega, y no depender de que
recuerde una conversación anterior o descubra la política en un spec interno.

## Investigation

`templates/contract/release.md` ya separa responsabilidades: ChangeLedger
calcula membresía y SemVer, mientras el agente operativo modifica los archivos
de versión del stack, ejecuta gates y publica. Sin embargo, no dice
explícitamente si esos pasos requieren crear otro change.

La regla general de triage en el contexto de implementación sí afirma que
verificar, commitear, graduar, archivar o cerrar no crea un chore. Ese fragmento
no forma parte de `changeledger context release`, por lo que un agente puede
interpretar la ausencia como obligación de documentar una release rutinaria.

No conviene inferir esta política a partir del título o tipo de un draft ni
añadir warnings heurísticos al CLI. La distinción depende de la intención: una
operación de entrega no cambia el producto; un bug descubierto, una alteración
del workflow de publicación o documentación persistente sí requieren un change
independiente.

## Proposal

Añadir a `templates/contract/release.md` una sección breve y normativa que:

- clasifique como trabajo operativo el bump de versión, la creación del
  manifiesto, los gates, el empaquetado, commits, tags y publicación;
- prohíba crear un change únicamente para agrupar esos pasos rutinarios;
- indique que cualquier corrección funcional, cambio del workflow o verdad
  persistente descubierta durante la preparación se documenta como un change
  independiente;
- ordene completar ese change y recalcular el plan antes de registrar la
  release.

Cubrir la regla en `test/context.test.mjs` mediante el output público de
`changeledger context release`. La guía seguirá siendo portable: no asumirá npm,
GitHub ni un stack concreto.

## Specification

### CR1 — la preparación rutinaria no crea changes
- **Given** un agente que prepara una entrega sin modificar comportamiento
- **When** ejecuta `changeledger context release`
- **Then** la salida dice explícitamente que version bumps, release manifests,
  gates, packaging, commits, tags y publishing son operational work
- **And** indica que no debe crear un change solamente para esos pasos

### CR2 — el alcance real conserva trazabilidad
- **Given** que durante la preparación aparece una corrección funcional, un
  cambio del workflow de publicación o documentación persistente
- **When** el agente decide cómo continuar
- **Then** el contexto exige capturarlo como un change independiente
- **And** exige completarlo y volver a ejecutar `changeledger release plan`
  antes de `changeledger release record <version>`

### CR3 — la regla permanece portable y estable
- **Given** cualquier repositorio registrado, con independencia de su stack
- **When** se genera dos veces `changeledger context release`
- **Then** ambas salidas son byte-idénticas y no mutan archivos
- **And** la nueva guía no exige npm, GitHub ni nombres de archivos específicos

## Plan

- [x] Añadir primero pruebas fallidas de la política operativa y su secuencia en `test/context.test.mjs`; implementar la regla mínima en `templates/contract/release.md`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-06-28T21:58:56Z
- [x] Ejecutar el gate completo y comprobar el contexto público real; verify: `pnpm verify` y `node bin/changeledger.mjs context release` (support) — 2026-06-28T21:59:13Z

## Log
- **2026-06-28T21:57:31Z** — status: draft → approved
- **2026-06-28T21:58:16Z** — status: approved → in-progress
- **2026-06-28T21:58:16Z** — owner → Roberto Ruiz (auto)
- **2026-06-28T21:59:14Z** — Implementado con TDD: el contexto release clasifica la preparación rutinaria como trabajo operativo, evita chores circulares y exige resolver cambios reales antes de recalcular el plan. pnpm verify: 468 tests.
- **2026-06-28T21:59:14Z** — status: in-progress → in-review
- **2026-06-28T22:01:22Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-28T22:01:51Z** — validation → done (human accepted)
- **2026-06-28T22:02:31Z** — graduado a spec `releases.md`
- **2026-06-28T22:02:42Z** — archived
