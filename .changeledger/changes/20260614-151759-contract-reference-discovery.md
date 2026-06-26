---
id: "20260614-151759"
title: "Discovery cross-agent: referenciar el contrato instalado vía .sl/AGENTS.md"
type: feature
status: done
created: 2026-06-14T15:17:59Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Hoy la herramienta solo funciona en este repo (donde se desarrolla). En otros
repos un agente no sabe que Spec Ledger existe ni cómo usarlo. El `init` actual
**copia** AGENTS.md a la raíz del repo destino; eso es doble error:

1. **Drift.** El contrato pertenece a la herramienta y se versiona con ella
   (npm o `pnpm link`). Una copia por repo queda vieja cuando la herramienta
   actualiza el contrato.
2. **Pisa.** Si el repo ya tiene su propio AGENTS.md (contrato del proyecto),
   copiar lo destruye.

Necesitamos que cualquier agente (Claude, Codex, opencode, Copilot, Cursor…)
descubra el contrato, sin duplicarlo y sin pisar lo del proyecto. Simple y
verificable.

## Investigation

- **El contrato es artefacto de la herramienta**, no del proyecto. Resoluble en
  cualquier instalación vía `paths.mjs` → `agentsTemplate`
  (`<packageRoot>/AGENTS.md`), sin importar si se instaló por npm global,
  `pnpm link --global` o node_modules local. `sl` siempre sabe dónde está su
  propio AGENTS.md.
- **No copiar** (drifta) y **no committear un symlink** (git guarda el target
  como texto absoluto → al clonar en otra máquina/CI queda dangling; además
  Windows). La salida: symlink **local, gitignored, regenerado por máquina**.
- **`.sl/AGENTS.md`**, no la raíz: el proyecto conserva su AGENTS.md propio
  intacto, y queda una ruta in-repo estable a la que apuntar.
- **El contrato del proyecto es el root `AGENTS.md`.** Si no existe, lo exigimos
  al usuario (no lo inventamos), y luego le appendeamos una línea de referencia
  a `.sl/AGENTS.md`. Una línea, idempotente, coexiste con las reglas propias.
- La validación de discovery es **repo-level y necesita IO** (existe el root
  AGENTS.md, contiene la referencia, el symlink resuelve). El validador puro
  `checkRepo` opera sobre el repo ya cargado; esta comprobación vive en el
  comando `sl check` (que sí hace IO) o en un check repo-level dedicado.

## Proposal

Cambiar `init` y `check`; el contrato se enlaza, no se copia.

- **Separar contrato-de-herramienta de contrato-de-proyecto.** El contrato
  canónico (instrucciones de uso que referencian todos los repos) vive en
  `templates/AGENTS.md` y `paths.mjs` lo resuelve como `agentsTemplate`. El
  `AGENTS.md` raíz de este repo pasa a ser su contrato **propio**, así no hay
  recursión (el symlink apuntaba a sí mismo cuando ambos eran el mismo archivo).
- **`init`**:
  - Exige root `AGENTS.md`. Si no existe → aborta. No lo crea por nosotros.
  - Crea symlink `.sl/AGENTS.md` → `agentsTemplate` (contrato instalado).
  - Appendea la referencia, como **caja de alerta GitHub** (`> [!IMPORTANT]`),
    idempotente (marcador `<!-- spec-ledger -->`, no duplica), a **cada** archivo
    de contrato presente que **no sea symlink**: `AGENTS.md` y `CLAUDE.md`:

    ```markdown
    <!-- spec-ledger -->
    > [!IMPORTANT]
    > This repo uses **Spec Ledger**. Read and follow `.sl/AGENTS.md` (the change
    > contract). If it is missing, run `sl register`.
    ```
  - Añade `.sl/AGENTS.md` a `.gitignore` (lo crea si no existe).
- **`register`**: recrea el symlink `.sl/AGENTS.md` resolviendo la ruta de
  instalación en esta máquina (sirve tras clonar/mover/cambiar de instalación).
- **`check`** (repo-level, IO): error si el root AGENTS.md no existe, si algún
  contrato presente (AGENTS.md/CLAUDE.md, no-symlink) no contiene la referencia,
  o si `.sl/AGENTS.md` no resuelve (dangling). Es fundamental: sin esto la
  herramienta no arranca en ese repo/agente.

Descartado:
- Copiar AGENTS.md al repo (drift).
- Symlink committeado (dangling cross-machine, Windows).
- Symlink/append en la raíz como único archivo (pisa/recursa el AGENTS.md del proyecto).
- Escribir en un archivo de contrato que sea symlink (escribiría en su target).

## Specification

### CR1 — init enlaza, no copia
- **Given** un repo con root `AGENTS.md` y sin `.sl/`
- **When** corro `sl init`
- **Then** se crea el symlink `.sl/AGENTS.md` apuntando al AGENTS.md instalado
- **And** el root `AGENTS.md` original no se modifica salvo el append de referencia

### CR2 — init exige root AGENTS.md
- **Given** un repo sin `AGENTS.md` en la raíz
- **When** corro `sl init`
- **Then** aborta con un mensaje que pide crear el root AGENTS.md
- **And** no crea `.sl/` parcial ni copia nada

### CR3 — referencia idempotente
- **Given** un repo cuyo root AGENTS.md ya contiene la línea de referencia
- **When** corro `sl init` (o `register`)
- **Then** no se duplica la línea

### CR4 — .sl/AGENTS.md gitignored
- **Given** un repo recién inicializado
- **When** inspecciono `.gitignore`
- **Then** `.sl/AGENTS.md` está ignorado (no se committea el symlink)

### CR5 — register regenera el symlink
- **Given** un clon donde `.sl/AGENTS.md` no existe o está dangling
- **When** corro `sl register`
- **Then** el symlink queda apuntando al AGENTS.md instalado en esta máquina

### CR6 — check valida el discovery
- **Given** un repo sin root AGENTS.md, o sin la referencia, o con symlink dangling
- **When** corro `sl check`
- **Then** falla con error accionable por cada caso
- **And** con todo correcto, pasa sin errores de discovery

### CR7 — cubrir AGENTS.md y CLAUDE.md, saltar symlinks
- **Given** un repo con `AGENTS.md` y `CLAUDE.md` (ninguno symlink)
- **When** corro `sl init`
- **Then** ambos reciben la referencia
- **And** si un archivo de contrato es symlink, no se escribe en él

### CR8 — referencia como caja de alerta
- **Given** un repo recién inicializado
- **When** inspecciono el contrato del proyecto
- **Then** la referencia es una alerta GitHub `> [!IMPORTANT]`, no una línea suelta al final

## Plan

- [x] `init`: exigir root AGENTS.md, abortar si falta; symlink `.sl/AGENTS.md` → `agentsTemplate`; append idempotente de la referencia; asegurar `.sl/AGENTS.md` en `.gitignore` (CR1, CR2, CR3, CR4) — 2026-06-14T15:32:59Z
- [x] `register`: recrear symlink `.sl/AGENTS.md` resolviendo la ruta instalada (CR5) — 2026-06-14T15:33:00Z
- [x] `check` repo-level (IO): validar existencia de root AGENTS.md, presencia de la referencia y symlink resuelto, con mensajes accionables (CR6) — 2026-06-14T15:33:00Z
- [x] Quitar el `copyFileSync(agentsTemplate, root)` actual de `init` (CR1) — 2026-06-14T15:33:00Z
- [x] Actualizar AGENTS.md y README: el contrato se enlaza vía `.sl/AGENTS.md`, no se copia; documentar el modelo de discovery — 2026-06-14T15:33:00Z
- [x] Tests: init enlaza/aborta/idempotente/gitignore, register regenera, check valida los 3 fallos y el caso OK (CR1–CR6) — 2026-06-14T15:33:00Z
- [x] Separar contrato canónico a `templates/AGENTS.md`; `paths.agentsTemplate` apunta ahí; root AGENTS.md pasa a contrato propio (sin recursión); quitar `AGENTS.md` de `package.json` files (CR1) — `templates/AGENTS.md`, `src/paths.mjs`, `AGENTS.md`, `package.json` — 2026-06-14T15:45:00Z
- [x] `ensureReference`/`checkContract` cubren AGENTS.md y CLAUDE.md, saltan symlinks; referencia como alerta GitHub `> [!IMPORTANT]` (CR7, CR8) — `src/contract.mjs` — 2026-06-14T15:45:00Z
- [x] Tests: CLAUDE.md cubierto, skip symlink, alerta, check de CLAUDE.md sin referencia (CR7, CR8) — `test/cli.test.mjs` — 2026-06-14T15:45:00Z

## Log
- **2026-06-14T15:26:44Z** — status: draft → approved
- **2026-06-14T15:27:48Z** — status: approved → in-progress
- **2026-06-14T15:27:48Z** — owner → Roberto Ruiz (auto)
- **2026-06-14T15:33:35Z** — Spec architecture.md actualizada con la sección Discovery del contrato
- **2026-06-14T15:33:35Z** — status: in-progress → done
- **2026-06-14T16:15:54Z** — Refinamiento: split contrato a templates/AGENTS.md (sin recursion), cobertura CLAUDE.md + skip symlinks, referencia como alerta GitHub
- **2026-06-14T16:52:30Z** — graduado a spec `architecture.md`
- **2026-06-15T21:17:56Z** — archived
