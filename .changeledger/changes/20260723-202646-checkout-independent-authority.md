---
id: "20260723-202646"
title: Autoridad de estado independiente del checkout
type: feature
status: draft
created: 2026-07-23T20:26:46Z
depends_on: ["20260722-202057"]
related_to: ["20260721-193101", "20260721-193103", "20260721-193104", "20260721-193106", "20260722-163406", "20260722-181234", "20260722-203030"]
release_impact: minor
---

## Request

La auditoría externa del 2026-07-23 sobre el baseline `3267a28b` encontró un crítico arquitectónico: la activación del estado global vive en `.changeledger/authority.yml`, un archivo del working tree. Cambiar a una rama creada antes del cutover (o borrar el archivo) hace desaparecer la autoridad y el ledger cae al modo legacy aunque el clon conserve `refs/changeledger/confirmed` — verdades distintas según la rama, lo contrario del objetivo del estado global. La contención inmediata (autoridad ausente + refs v2 → fail closed) se entrega en [20260722-202057]; este change decide y entrega la resolución de autoridad que no depende del checkout.

## Investigation

- `loadLedgerStore` selecciona el modo leyendo `authorityFor(changeledgerDir)` — un `parseYaml` del archivo del worktree. Toda la cadena (validación, réplica, viewer) hereda esa decisión por checkout.
- Los refs de réplica (`refs/changeledger/confirmed|pending|observed`) ya son por-repositorio (git common dir), igual que `refs/heads/changeledger/state`: la mitad del sistema ya es independiente del checkout; solo la activación no lo es.
- El cutover ([20260721-193103]) escribe `authority.yml` y lo committea en las ramas post-cutover; las ramas anteriores no lo tienen y los worktrees pueden mezclar ambas épocas.
- `state activate --prepare` solo crea la rama candidata: en ese momento aún no hubo merge ni decisión humana, así que la instalación de la activación debe ser un paso posterior y separado.
- `state export --recovery-branch` ([20260722-181234], [20260722-163406]) elimina `authority.yml` de la rama: el diseño debe cubrir también la desactivación, o el recovery dejaría un repo que sigue en modo state.
- Alcance a cubrir explícitamente: ramas pre-cutover, worktrees múltiples, clones nuevos (que NO reciben `refs/changeledger/*` al clonar), repos legacy, y la precedencia entre activación local y el `authority.yml` de la rama visible. La separación autoridad-local vs enforcement-remoto de [20260721-193104] y el alcance documentado en [20260722-203030] se mantienen.

## Proposal

Alternativas evaluadas:

1. **Ref interno de activación** — `refs/changeledger/activation` apunta al commit exacto que contiene la autoridad activa; las cargas leen `<commit>:.changeledger/authority.yml`. Ventajas: compartido por todos los worktrees vía common dir; el commit queda alcanzable; actualizaciones CAS y crash-safe con `update-ref`; una sola copia de la verdad (no hay segundo YAML que pueda divergir). Coste: instalación explícita en clones nuevos (igual que cualquier alternativa local).
2. **Metadata YAML en el git common dir**. Descartada frente a 1: duplica la autoridad en un segundo archivo mutable sin CAS ni alcanzabilidad.
3. **Resolución desde la rama de integración protegida**. Descartada como mecanismo primario: acopla lecturas locales a un ref remoto que puede faltar u obsolescer; queda solo como fuente del bootstrap explícito de clones nuevos.
4. **Solo contención** (fail closed permanente sin autoridad). Descartada: ramas pre-cutover serían callejones sin salida permanentes.

Elegida: **1**. Momentos separados: `state activate --prepare` no toca la activación; un paso explícito de instalación (`state activate --install` o equivalente) fija el ref solo tras verificar que el commit pertenece a la rama de integración activa y coincide con baseline, manifest y project_id. El `authority.yml` del worktree pasa a ser artefacto de transporte (cutover/bootstrap), nunca la autoridad operativa; su presencia o ausencia deja de decidir el modo cuando existe el ref de activación.

Precedencia (con `refs/changeledger/activation` presente, la activación manda):

| Situación del worktree | Resultado |
|---|---|
| activación + authority ausente (rama pre-cutover) | modo state por activación |
| activación + authority v1 antigua | modo state por activación; v1 visible se ignora con aviso |
| activación + authority v2 idéntica | modo state, sin aviso |
| activación + authority v2 divergente | fail closed nombrando ambas fuentes |
| authority v2 sin activación | contención de [20260722-202057]: instalar o fail closed |
| refs v2 sin ninguna authority | fail closed ([20260722-202057]) |
| clon de rama pre-cutover sin refs ni activación | indistinguible de legacy: modo worktree; el bootstrap explícito desde un ref de integración exacto es el camino soportado y queda documentado |

Desactivación (camino inverso del recovery): retirar la activación es una operación explícita, atómica e idempotente que exige: sin pending, confirmed/observed consistentes, y la rama de integración ya recuperada sin `authority.yml`. Afecta a todos los worktrees a la vez (es un ref del common dir).

## Specification

### CR1 — La verdad no cambia con la rama
- **Given** un repo con `refs/changeledger/activation` instalado y `refs/changeledger/confirmed` publicado
- **When** se cambia a una rama pre-cutover sin `authority.yml` y se ejecuta `changeledger context`
- **Then** el ledger carga en modo state con la misma revisión confirmada que en la rama post-cutover

### CR2 — Todos los worktrees comparten la activación
- **Given** el mismo repo con un worktree adicional en una rama pre-cutover
- **When** se carga el ledger desde ese worktree
- **Then** el modo es state y la revisión coincide con la del worktree principal

### CR3 — prepare no instala; install verifica y fija el ref
- **Given** un repo donde `state activate --prepare` creó la rama candidata y ningún merge ocurrió
- **When** se carga el ledger en cualquier worktree
- **Then** el modo no cambia (la preparación no activa nada)
- **And** el paso de instalación posterior fija `refs/changeledger/activation` solo si el commit pertenece a la rama de integración activa y coincide con baseline, manifest y project_id, con CAS (`update-ref` con old value) y error exacto si la verificación falla

### CR4 — Precedencia con authority divergente
- **Given** activación instalada y un worktree cuya `authority.yml` v2 difiere de la del commit de activación
- **When** se carga el ledger
- **Then** falla cerrado nombrando el ref de activación y el archivo divergente
- **And** con una v1 antigua o sin archivo, carga en modo state por activación

### CR5 — Desactivación atómica para recovery
- **Given** un repo activado sin pending, con confirmed/observed consistentes y la integración recuperada sin `authority.yml`
- **When** se ejecuta el paso explícito de desactivación
- **Then** `refs/changeledger/activation` desaparece atómicamente, la operación es idempotente y todos los worktrees vuelven al modo que dicte su checkout
- **And** con pending presente o integración aún con authority, la desactivación se rechaza con la precondición exacta incumplida

### CR6 — Clon nuevo: bootstrap explícito o legacy honesto
- **Given** un clon nuevo de una rama pre-cutover (sin `refs/changeledger/*` ni activación)
- **When** se carga el ledger
- **Then** modo worktree (indistinguible de legacy) — y el bootstrap documentado desde un ref de integración exacto instala la activación tras las verificaciones de CR3

### CR7 — Los repos legacy no cambian
- **Given** un repo sin refs v2, sin activación y sin authority
- **When** se carga el ledger
- **Then** modo worktree exactamente igual que hoy

## Plan

- [ ] Resolver la activación en `src/ledger-store.mjs`: leer `refs/changeledger/activation` vía common dir y cargar la autoridad desde `<commit>:.changeledger/authority.yml`, con la matriz de precedencia; test rojo previo por fila crítica; verify: `node --test test/ledger-store.test.mjs` (CR1, CR2, CR4, CR7)
- [ ] Separar `--prepare` de la instalación en `src/state-migration.mjs` y `src/commands/state.mjs` (+ CLI en `bin/changeledger.mjs`): paso `--install` con verificación de pertenencia a integración, baseline/manifest/project_id y CAS; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs` (CR3)
- [ ] Añadir la desactivación explícita con precondiciones y idempotencia en `src/state-migration.mjs`/`src/commands/state.mjs`, integrada con el flujo de recovery; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs` (CR5)
- [ ] Cubrir bootstrap de clon nuevo y documentar la limitación del clon pre-cutover en `templates/contract/` y README (sección adopción/recovery); verify: `node bin/changeledger.mjs check` (CR6)
- [ ] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)

## Log
