---
id: "20260614-182513"
title: "owner desde el username de GitHub (fallback git name)"
type: feature
status: draft
created: 2026-06-14T18:25:13Z
depends_on: []
---

## Request

El owner se autoasigna desde `git config user.name` → "Roberto Ruiz": display con
espacios, no un handle estable tipo `ana`. Mejor el **username de GitHub** (p.ej.
`raruiz-hiberuscom`). Disponible vía `gh api user --jq .login` cuando `gh` está
instalado y autenticado. Si no, fallback a `git config user.name` (no email — no
exponerlo). Como en este repo solo trabajó una persona, backfill de los owners
históricos al login de GitHub.

## Investigation

- `gh api user --jq .login` devuelve el login (verificado: `raruiz-hiberuscom`).
  Depende de `gh` instalado + autenticado; puede faltar o ir offline → debe ser
  tolerante (igual que `gitUser`, que captura el fallo y devuelve '').
- Auto-owner vive en `status()` (`src/commands/agent.mjs:36`), hoy llama
  `gitUser(cwd)` (`src/git.mjs:15`), inyectable para test.
- `gh` es otro binario; necesita su propio runner inyectable, separado del de git.
- Solo afecta la autoasignación al entrar a `in-progress`; `sl owner` manual y los
  owners ya fijados no cambian (salvo el backfill explícito).

## Proposal

- `githubLogin(run)` en `src/git.mjs`: `gh api user --jq .login` (trim), tolerante
  (`''` si falla). Runner propio inyectable (default ejecuta `gh`).
- `ownerHandle(cwd, run, ghRun)` en `src/git.mjs`: devuelve `githubLogin(ghRun) ||
  gitUser(cwd, run)`. status() la usa en vez de `gitUser`.
- Backfill: cambiar `owner: Roberto Ruiz` → `owner: raruiz-hiberuscom` en los
  changes de `.sl/changes/` (este repo, un solo autor).
- Contrato (`templates/AGENTS.md` §3): owner auto = login de GitHub, fallback
  `git config user.name`.

Descartado:
- **Email / localpart** — el usuario no quiere exponer el email.
- **`os.userInfo().username`** — login del SO, no la identidad del repo.
- **Llamar `gh` siempre sin fallback** — rompe offline / sin `gh`.

## Specification

### CR1 — usa el login de GitHub
- **Given** un change `approved` sin owner y `gh` que resuelve login `raruiz-hiberuscom`
- **When** corro `sl status <id> in-progress`
- **Then** el frontmatter queda `owner: raruiz-hiberuscom`
- **And** el Log registra `owner → raruiz-hiberuscom (auto)`

### CR2 — fallback a git name
- **Given** un change `approved` sin owner, `gh` no disponible (lanza), y `git config user.name` = `Roberto Ruiz`
- **When** corro `sl status <id> in-progress`
- **Then** el frontmatter queda `owner: Roberto Ruiz`

### CR3 — no pisa owner explícito
- **Given** un change con `owner` ya asignado
- **When** pasa a `in-progress`
- **Then** el owner no se sobrescribe

### CR4 — tolerancia total
- **Given** ni `gh` ni `git user.name` disponibles (ambos lanzan)
- **When** pasa a `in-progress`
- **Then** no falla y el owner queda sin asignar

## Plan

- [ ] `githubLogin(run)` en `src/git.mjs` (`gh api user --jq .login`, tolerante); test en `test/git.test.mjs` (CR1, CR4)
- [ ] `ownerHandle(cwd, run, ghRun)` en `src/git.mjs` (`githubLogin || gitUser`); test en `test/git.test.mjs` (CR1, CR2, CR4)
- [ ] `status()` usa `ownerHandle` (inyectable) en `src/commands/agent.mjs`; tests en `test/agent.test.mjs` (CR1, CR2, CR3, CR4)
- [ ] Backfill `owner: Roberto Ruiz` → `owner: raruiz-hiberuscom` en `.sl/changes/` (migración, sin CR)
- [ ] Contrato: owner auto = GitHub login, fallback git name, en `templates/AGENTS.md` §3 (docs, sin CR)

## Log
