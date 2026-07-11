---
id: "20260711-225638"
title: Mover marcadores múltiples al cuerpo del commit
type: feature
status: in-review
created: 2026-07-11T22:56:38Z
depends_on: [ "20260711-103757" ]
release_impact: minor
owner: Test
---

## Request

`changeledger commit` concatena todos los marcadores `[#id]` al subject. Cuando
un commit integra muchos changes, la lista domina la línea visible en clientes
Git y oculta la descripción útil. Se pide mantener subjects legibles trasladando
los marcadores múltiples a la descripción (cuerpo) del commit.

## Investigation

- `commit()` construye hoy un único subject y ejecuta `git commit -m <subject>`;
  para varios ids produce `feat(x): y [#A] [#B] ...`.
- `check --commits` usa `git log --pretty=%s` y `hasCommitMarker(subject)`, por lo
  que mover marcadores al cuerpo sin cambiar el lint rompería el quality gate.
- `gitRefs()` usa `git log --grep`, que busca el mensaje completo, pero devuelve
  solo el subject al viewer. Seguirá encontrando la relación aunque el subject
  quede limpio.
- Para un único change, el marcador corto en el subject preserva trazabilidad
  visible sin perjudicar legibilidad. El problema aparece únicamente en commits
  multi-change.

## Proposal

Mantener el formato actual cuando hay un solo id. Cuando hay dos o más, crear un
subject convencional limpio y un cuerpo canónico de una línea:

```text
ChangeLedger: [#A] [#B] [#C]
```

`check --commits` validará el mensaje completo con una regla excluyente: un
commit de un id requiere su marcador al final del subject; un commit con varios
ids requiere la línea canónica en el cuerpo y no permite marcadores en el
subject. Esto evita dos representaciones equivalentes y mantiene determinismo.

Alternativas descartadas:

- Mover también el marcador único al cuerpo: reduce la trazabilidad visible en
  el caso habitual sin resolver un problema real.
- Usar trailers repetidos (`ChangeLedger-Change: A`): son más estructurados pero
  abandonan innecesariamente la convención `[#id]` que ya usan búsqueda, specs y
  repos existentes.
- Permitir indistintamente subject o body: dificulta el lint y perpetúa subjects
  largos en lugar de establecer una salida canónica.

## Specification

### CR1 — Un único change conserva el marcador visible
- **Given** `changeledger commit -m "feat(cli): add helper" --id A`
- **When** se crea el commit
- **Then** el subject exacto es `feat(cli): add helper [#A]`
- **And** el cuerpo no contiene una línea ChangeLedger

### CR2 — Varios changes usan el cuerpo
- **Given** `changeledger commit -m "docs(context): checkpoint" --id A --id B`
- **When** se crea el commit
- **Then** el subject exacto es `docs(context): checkpoint`
- **And** el cuerpo contiene exactamente `ChangeLedger: [#A] [#B]`

### CR3 — El lint acepta ambas formas canónicas
- **Given** un rango con un commit single-change en el subject y otro multi-change en el cuerpo
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** ambos commits son válidos
- **And** merges y `chore(release)` mantienen sus exenciones actuales

### CR4 — El lint rechaza mensajes ambiguos o mal formados
- **Given** un commit sin marcador, con lista multi-change en el subject, o con `ChangeLedger:` mal formada en el cuerpo
- **When** se ejecuta el lint de commits
- **Then** reporta el sha y la causa concreta para cada mensaje inválido

### CR5 — La búsqueda mantiene trazabilidad multi-change
- **Given** un commit cuyo cuerpo contiene `ChangeLedger: [#A] [#B]`
- **When** el viewer consulta las referencias Git de A o B
- **Then** encuentra el commit y muestra su subject limpio

## Plan

- [x] Escribir tests red y adaptar `src/commands/commit.mjs` para subject/cuerpo según cardinalidad; verify: `node --test test/commit.test.mjs` (CR1, CR2) — 2026-07-11T23:11:30Z
- [x] Extender lectura y lint del mensaje en `src/git.mjs` y `src/commands/check.mjs`; verify: `node --test test/check.test.mjs test/git.test.mjs` (CR3, CR4) — 2026-07-11T23:11:30Z
- [x] Cubrir lookup por marcador en el cuerpo y presentación del subject en `src/git.mjs`; verify: `node --test test/git.test.mjs test/view.test.mjs` (CR5) — 2026-07-11T23:11:31Z
- [x] Actualizar `templates/contract/implement.md`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4) — 2026-07-11T23:11:31Z
- [x] Ejecutar `pnpm verify` después de los ciclos red-green (support) — 2026-07-11T23:11:31Z

## Log

- **2026-07-11T22:56:38Z** — Draft creado por evidencia visual de subjects ilegibles en commits que agrupan muchos changes.
- **2026-07-11T23:00:13Z** — status: draft → approved
- **2026-07-11T23:07:57Z** — status: approved → in-progress
- **2026-07-11T23:07:57Z** — owner → Test (auto)
- **2026-07-11T23:11:36Z** — Implementación TDD completa: un id permanece en subject; múltiples ids usan cuerpo ChangeLedger canónico; lint valida ambas formas y reporta formatos ambiguos; gitRefs conserva lookup con subject limpio. pnpm verify 658/658 y 189 changes válidos.
- **2026-07-11T23:11:36Z** — status: in-progress → in-review
