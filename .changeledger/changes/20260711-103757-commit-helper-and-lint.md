---
id: "20260711-103757"
title: "Contrato de commits ejecutable: helper y lint"
type: feature
status: done
created: 2026-07-11T10:37:57Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Los equipos reportan que los agentes se confunden al cumplir el contrato de
commits. Los datos lo confirman: el cumplimiento del marcador `[#id]` es ~80%
en este repo (dogfooding), ~53% de los commits no-merge en `backend-laravel` y
~20% en `ionic-app`. Se pide hacer el contrato ejecutable: que el CLI componga
el mensaje correcto y que `check` detecte desviaciones, en lugar de confiar en
que cada agente recuerde prosa de `implement.md`.

## Investigation

Hallazgos de la minería de commits (300 commits por repo, 2026-07-11):

- Conviven al menos tres convenciones: el marcador canónico `[#id]`, tickets
  legacy (`WS-####`, número de PR) y meta-commits del ledger con ids en prosa
  (`archive 155939 and 160951`, `mark 132533 reviewed`).
- El formato multi-id es ambiguo incluso aquí: brackets separados
  (`[#A] [#B]`) en 5 commits y lista con comas en un bracket (4e9acbb) en otro.
- Casos sin regla explícita: si los meta-commits del ledger, los release-prep y
  los merges llevan marcador — cada repo respondió distinto.
- El patrón general del dataset: donde el CLI ejecuta la regla (status, review,
  log) el cumplimiento es alto; donde la regla es prosa, cae.

## Proposal

Tres piezas:

1. `changeledger commit -m "<type>(<scope>): <desc>" [--id <change-id>]...`:
   valida la forma conventional del subject, resuelve el change activo (el
   único `in-progress`) cuando no se pasa `--id`, añade el sufijo `[#id]` y
   delega en `git commit`. Con varios `--id` emite brackets separados. Falla
   con error claro si hay cero o más de un change `in-progress` y no se indica
   `--id`.
2. `changeledger check --commits [<base>]`: lint del rango `base..HEAD`
   (por defecto la rama principal detectada): todo commit no-merge debe llevar
   marcador bien formado; merges y `chore(release)` quedan exentos.
3. Contrato (`templates/contract/implement.md`): formato multi-id canónico =
   brackets separados; los meta-commits del ledger llevan marcador como
   cualquier otro; release-prep y merges no llevan.

Alternativas descartadas:

- Hook `prepare-commit-msg` empaquetado por `register`: intrusivo en repos
  consumidores y dependiente del entorno git de cada uno; puede añadirse
  después como opt-in sin cambiar este diseño.
- Dejar solo la regla documentada: es el statu quo y los datos muestran que no
  funciona.

## Specification

### CR1 — Marcador automático con un change activo
- **Given** un único change `in-progress` con id `20260711-000001` y cambios staged
- **When** se ejecuta `changeledger commit -m "feat(cli): add helper"`
- **Then** se crea un commit cuyo subject es exactamente `feat(cli): add helper [#20260711-000001]`

### CR2 — Ambigüedad sin --id
- **Given** dos changes `in-progress` y cambios staged
- **When** se ejecuta `changeledger commit -m "fix(x): y"` sin `--id`
- **Then** no se crea ningún commit
- **And** el error lista los ids candidatos y el proceso termina con exit distinto de 0

### CR3 — Multi-id canónico
- **Given** los changes `A` y `B` existentes
- **When** se ejecuta `changeledger commit -m "feat(x): y" --id A --id B`
- **Then** el subject termina exactamente en `[#A] [#B]`

### CR4 — Subject no conventional
- **Given** cambios staged
- **When** se ejecuta `changeledger commit -m "arreglos varios"`
- **Then** no se crea commit y el error indica la forma esperada `type(scope): description`

### CR5 — Lint de rango detecta commits sin marcador
- **Given** una rama con un commit no-merge sin marcador y otro con `[#id]` válido
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** reporta solo el commit sin marcador con su hash abreviado y termina con exit distinto de 0

### CR6 — Exenciones del lint
- **Given** un rango que contiene un merge y un `chore(release): prepare ChangeLedger 1.0.0` sin marcador
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** ninguno de los dos se reporta

### CR7 — Contrato con formato canónico
- **Given** el contexto de implementación
- **When** se ejecuta `changeledger context implement`
- **Then** documenta brackets separados como único formato multi-id y las exenciones de merge y release-prep

## Plan

- [x] Crear `src/commands/commit.mjs` con resolución de change activo y composición del subject; verify: `node --test test/commit.test.mjs` (CR1, CR2, CR3, CR4) — 2026-07-11T11:15:08Z
- [x] Registrar el subcomando en `bin/changeledger.mjs` con help y opciones; verify: `pnpm test` (CR1) — 2026-07-11T11:15:08Z
- [x] Añadir `--commits` a `src/commands/check.mjs` con parseo del rango sobre `src/git.mjs`; verify: `node --test test/check.test.mjs` (CR5, CR6) — 2026-07-11T11:15:09Z
- [x] Actualizar `templates/contract/implement.md` con el formato canónico y las exenciones; verify: `pnpm test` (CR7) — 2026-07-11T11:15:09Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T11:15:09Z

## Log
- **2026-07-11T10:47:24Z** — status: draft → approved
- **2026-07-11T10:52:32Z** — status: approved → in-progress
- **2026-07-11T10:52:32Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T11:15:09Z** — Integrada implementación delegada (948a245..aa7c980): comando commit, check --commits con exenciones, contrato multi-id canónico en implement.md. Hallazgo raíz: git.mjs sanea GIT_DIR/GIT_WORK_TREE para hooks anidados. En integración se añadió commit al USAGE (omisión del delegado) y se resolvió el bloque de subcomandos contra fix. pnpm verify verde.
- **2026-07-11T11:16:21Z** — status: in-progress → in-review
- **2026-07-11T11:22:35Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T11:37:26Z** — validation → done (human accepted)
- **2026-07-11T15:45:49Z** — graduado a spec `git-traceability.md`
- **2026-07-11T21:54:25Z** — archived
