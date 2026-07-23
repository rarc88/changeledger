---
id: "20260723-202646"
title: Autoridad de estado independiente del checkout
type: feature
status: draft
created: 2026-07-23T20:26:46Z
depends_on: ["20260722-202057"]
related_to: ["20260721-193101", "20260721-193103", "20260721-193106"]
release_impact: minor
---

## Request

La auditoría externa del 2026-07-23 sobre el baseline `3267a28b` encontró un crítico arquitectónico: la activación del estado global vive en `.changeledger/authority.yml`, un archivo del working tree. Cambiar a una rama creada antes del cutover (o borrar el archivo) hace desaparecer la autoridad y el ledger cae al modo legacy aunque el clon conserve `refs/changeledger/confirmed` — verdades distintas según la rama, lo contrario del objetivo del estado global. La contención inmediata (autoridad ausente + refs v2 → fail closed) se entrega en [20260722-202057]; este change decide y entrega la resolución de autoridad que no depende del checkout.

## Investigation

- `loadLedgerStore` selecciona el modo leyendo `authorityFor(changeledgerDir)` — un `parseYaml` del archivo del worktree. Toda la cadena (validación, réplica, viewer) hereda esa decisión por checkout.
- Los refs de réplica (`refs/changeledger/confirmed|pending|observed`) ya son por-repositorio (git common dir), igual que `refs/heads/changeledger/state`: la mitad del sistema ya es independiente del checkout; solo la activación no lo es.
- El cutover ([20260721-193103]) escribe `authority.yml` y lo committea en las ramas post-cutover; las ramas anteriores no lo tienen y los worktrees pueden mezclar ambas épocas.
- Alcance a cubrir explícitamente: ramas pre-cutover, worktrees múltiples del mismo repo, clones nuevos (con y sin activación local), y repos legacy sin estado.

## Proposal

Alternativas evaluadas:

1. **Metadata de activación en el git common dir** (`<common-dir>/changeledger/authority.yml`), escrita por `state activate` y verificada contra el baseline firmado en los refs. Ventajas: independiente de rama y compartida por todos los worktrees; coste local nulo; sin red. Inconvenientes: un clon nuevo no la tiene hasta activar (mitigable: `state doctor`/error accionable ya la piden).
2. **Resolución desde la rama de integración protegida** (leer `authority.yml` de `refs/remotes/origin/<integration>` o del tip local). Ventajas: clones nuevos la resuelven solos. Inconvenientes: acopla lecturas locales a un ref que puede faltar u obsolescer; más superficie de fallo.
3. **Solo contención** (fail closed permanente sin autoridad). Descartada: convierte ramas pre-cutover en callejones sin salida permanentes.

Elegida: **1**, con el archivo del worktree como fuente de MIGRACIÓN únicamente — `state activate` (y una reactivación guiada) promueven la metadata al common dir; después el archivo del worktree pasa a ser redundante y su ausencia deja de importar. Escenario degradado: clon nuevo sin activación → fail closed con guía (comportamiento de [20260722-202057]).

## Specification

### CR1 — La verdad no cambia con la rama
- **Given** un repo activado (metadata en el common dir) con `refs/changeledger/confirmed` publicado
- **When** se cambia a una rama creada antes del cutover que no contiene `authority.yml` y se ejecuta `changeledger context`
- **Then** el ledger carga en modo state con la misma revisión confirmada que en la rama post-cutover

### CR2 — Todos los worktrees comparten la activación
- **Given** el mismo repo con un worktree adicional en una rama pre-cutover
- **When** se carga el ledger desde ese worktree
- **Then** el modo es state y la revisión coincide con la del worktree principal

### CR3 — La activación se promueve al common dir
- **Given** un repo con `authority.yml` válido en el worktree y sin metadata en el common dir
- **When** se ejecuta `changeledger state activate` (o el comando de promoción definido en el Plan)
- **Then** la metadata queda en `<common-dir>/changeledger/` verificada contra el baseline y las cargas dejan de leer el archivo del worktree

### CR4 — Clon nuevo sin activación falla cerrado con guía
- **Given** un clon nuevo con refs v2 pero sin metadata en el common dir ni `authority.yml`
- **When** se carga el ledger
- **Then** falla con el error accionable de 20260722-202057 (nombra el ref v2 y el paso de activación), nunca cae a legacy

### CR5 — Los repos legacy no cambian
- **Given** un repo sin refs v2 ni metadata de activación
- **When** se carga el ledger
- **Then** modo worktree exactamente igual que hoy

## Plan

- [ ] Definir el formato y la verificación de `<common-dir>/changeledger/authority.yml` en `src/ledger-store.mjs` (lectura) y `src/state-migration.mjs` (escritura en activate), con test rojo previo de resolución por common dir; verify: `node --test test/ledger-store.test.mjs test/state-migration.test.mjs` (CR1, CR3)
- [ ] Cubrir worktrees múltiples resolviendo el common dir real (`git rev-parse --git-common-dir`) en `src/repo.mjs` o helper de `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs` (CR2)
- [ ] Mantener el fail-closed de clones sin activación y el passthrough legacy en `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs` (CR4, CR5)
- [ ] Actualizar contrato y runbook (`templates/contract/`, README sección de adopción) a la autoridad por common dir; verify: `node bin/changeledger.mjs check` (support)
- [ ] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)

## Log
