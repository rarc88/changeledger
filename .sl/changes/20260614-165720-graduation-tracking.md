---
id: "20260614-165720"
title: "Rastrear graduacion: listar pendientes y marcar revisados (graduated)"
type: feature
status: draft
created: 2026-06-14T16:57:20Z
depends_on: []
---

## Request

Cuando un change llega a `done`, su verdad puede graduar a un spec — pero hoy no
hay forma de saber **cuáles faltan** ni de marcar uno como **ya revisado** para
que no reaparezca. Muchos `done` (bugs, chores) no aportan verdad persistente y
no deben graduar; sin una marca de "revisado, sin spec", quedarían como
pendientes para siempre.

Queremos: un comando que liste pendientes de graduar y una forma de resolver cada
uno (graduar a spec, o descartar con razón).

## Investigation

- **"Graduado" hoy se infiere** de la marca `graduado a spec \`<file>\`` que
  `graduate()` escribe en el Log (`src/commands/graduate.mjs`). No cubre el caso
  "revisado, no necesita spec".
- **Falta una señal binaria de resolución.** Decidido (ver decisiones): frontmatter
  `graduated: true` = pregunta de graduación resuelta (por spec o por descarte).
  Opcional, como `owner`/`archived` (`src/writer.mjs` ya tiene `setOwner`/`setArchived`).
- **El writer es texto puro**; añadir `setGraduated(text, bool)` sigue el patrón
  de `setArchived` (inserta/quita la línea tras `depends_on`).
- **Sin nag en check** (decidido): listar pendientes es bajo demanda, no warning
  del gate — el repo arrastra ~30 `done` históricos ya consolidados que inundarían
  la salida. `check` solo valida que `graduated`, si está, sea booleano.
- **Backlog histórico** (decidido): backfill `graduated: true` en los `done`
  actuales (ya consolidados en `architecture.md`) → `--pending` arranca limpio.
- **Superficie**: extender `sl graduate` (cohesivo) en `bin/sl.mjs`, no comandos
  nuevos sueltos.

## Proposal

### Frontmatter

`graduated: true` opcional. Ausente = no resuelto. Lo ponen tanto la graduación a
spec como el descarte.

### Comandos (`sl graduate`)

- `sl graduate <id> <spec-slug>` — existente; **además** marca `graduated: true`.
- `sl graduate <id> --skip [razón]` — marca `graduated: true` sin crear spec y
  añade al Log `graduation skipped[: razón]`. Solo en `done`.
- `sl graduate --pending` — lista `done` con `graduated !== true` (formato de `sl list`).

### Helpers (`src/commands/graduate.mjs`)

- `skipGraduation(id, reason, cwd)` — valida `done`, `setGraduated` + `appendLog`.
- `pendingGraduation(cwd)` — devuelve los changes `done` no resueltos.

Descartado:
- **Warning en `check`** — ruidoso con el backlog; bajo demanda es suficiente.
- **Campo derivado sin `graduated`** — cruzar marca-de-log + flag-de-skip es menos
  explícito y no se ve en el viewer.
- **Guardar `done` en graduate-a-spec** — crear un spec es acto deliberado; no se
  restringe. El guard de `done` aplica solo a `--skip` (descarte fácil de disparar
  por error).

```mermaid
stateDiagram-v2
  [*] --> done
  done --> graduated: sl graduate <id> <spec>
  done --> graduated: sl graduate <id> --skip
  note right of done: aparece en --pending
  note right of graduated: graduated true
```

## Specification

### CR1 — graduar a spec marca graduated
- **Given** un change `done` con id `20260613-120000` cuyo frontmatter no tiene `graduated`
- **When** corro `sl graduate 20260613-120000 arch`
- **Then** el frontmatter del change contiene la línea `graduated: true`
- **And** se crea `arch.md` con `> Graduado del change 20260613-120000` (comportamiento existente intacto)

### CR2 — skip resuelve sin spec
- **Given** un change `done` `20260613-120000` sin `graduated`
- **When** corro `sl graduate 20260613-120000 --skip "bug fix, sin verdad persistente"`
- **Then** el frontmatter contiene `graduated: true`
- **And** el `## Log` gana una entrada que termina en `graduation skipped: bug fix, sin verdad persistente`
- **And** no aparece ningún archivo nuevo en `specs_dir`

### CR3 — skip sin razón
- **Given** un change `done` sin `graduated`
- **When** corro `sl graduate <id> --skip`
- **Then** el frontmatter contiene `graduated: true`
- **And** la entrada de Log termina exactamente en `graduation skipped`

### CR4 — pending lista solo done no resueltos
- **Given** tres changes: `20260101-000000` (done, `graduated: true`), `20260102-000000` (done, sin `graduated`), `20260103-000000` (draft)
- **When** corro `sl graduate --pending`
- **Then** la salida incluye `20260102-000000`
- **And** no incluye `20260101-000000` ni `20260103-000000`

### CR5 — graduated debe ser booleano
- **Given** un change con frontmatter `graduated: 1`
- **When** corro `sl check`
- **Then** los errores incluyen `graduated must be a boolean`

### CR6 — skip solo en done
- **Given** un change `20260102-000000` con status `in-progress`
- **When** corro `sl graduate 20260102-000000 --skip`
- **Then** falla con un error que indica que solo se gradúan/descartan changes `done`
- **And** no modifica el archivo

## Plan

- [ ] `setGraduated(text, graduated)` en `src/writer.mjs` (inserta/quita `graduated: true` tras `depends_on`); tests en `test/writer.test.mjs` (CR1, CR2, CR3)
- [ ] `graduate()` marca `graduated: true` tras la marca de Log en `src/commands/graduate.mjs`; test en `test/graduate.test.mjs` (CR1)
- [ ] `skipGraduation(id, reason, cwd)` en `src/commands/graduate.mjs` (valida `done`, `setGraduated`+`appendLog` `graduation skipped[: reason]`, sin spec); test en `test/graduate.test.mjs` (CR2, CR3, CR6)
- [ ] `pendingGraduation(cwd)` en `src/commands/graduate.mjs` (done con `graduated !== true`); test en `test/graduate.test.mjs` (CR4)
- [ ] Validar `graduated` booleano en `src/check.mjs`; test en `test/check.test.mjs` (CR5)
- [ ] Wire en `bin/sl.mjs`: `sl graduate --pending` y `sl graduate <id> --skip [reason]`, conservando `<id> <spec>` (CR1, CR2, CR3, CR4)
- [ ] Documentar `graduated` + comandos en `templates/AGENTS.md` (§9 helpers, §10 specs) (sin CR — docs)
- [ ] Backfill `graduated: true` en los `done` actuales de `.sl/changes/` (sin CR — migración)
- [ ] README: `sl graduate --pending` / `--skip` (sin CR — docs)

## Log
