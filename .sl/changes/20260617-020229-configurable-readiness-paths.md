---
id: "20260617-020229"
title: Definition of Ready no debe asumir rutas src y test
type: feature
status: done
created: 2026-06-17T02:02:29Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
La Definition of Ready actual exige que cada tarea que referencia un CR nombre en
la misma línea una ruta `src/...` y una ruta `test/...`. Eso funcionó para este
repo, pero no es portable: otros repos pueden usar `app/`, `lib/`, `packages/`,
`spec/`, `__tests__/`, `android/`, `ios/`, documentación, infra o estructuras
monorepo distintas.

## Investigation
- La intención de la regla es buena: que un change aprobado sea implementable sin
  adivinar dónde tocar código ni cómo verificarlo.
- La implementación actual en `src/check.mjs` codifica dos expresiones regulares
  rígidas: una para `src/...` y otra para `test/...`.
- Esto convierte una política semántica ("nombra objetivo y verificación") en una
  convención de carpetas específica de Spec Ledger.
- `config.yml` ya gobierna `tdd`; es el sitio natural para parametrizar la
  política por repo.
- El contrato canónico debe hablar de "target files/areas" y "verification files
  or commands", no de `src/` y `test/` como única forma válida.

## Proposal
Reemplazar la regla rígida por una política configurable:

```yaml
tdd: true
readiness:
  target_patterns: ["src/**", "bin/**", "templates/**"]
  verification_patterns: ["test/**", "**/*.test.*", "**/*.spec.*", "pnpm test", "node --test"]
```

Semántica:

- Si `readiness` no existe, usar defaults compatibles para este repo
  (`src/` + `test/`) durante la migración.
- Una tarea que referencia CR debe mencionar al menos un target y una verificación
  según los patrones configurados.
- Los patrones pueden ser globs de ruta simples o strings literales de comandos,
  no regex compleja inicialmente, para mantener la config legible. Esto cubre
  tests colocados junto al archivo (`src/foo.test.ts`, `app/foo.spec.ts`) además
  de carpetas de tests separadas.
- El error debe decir algo como `Plan task for CR1 must name target and verification`
  y, si ayuda, listar los patrones esperados.

Descartado: eliminar la regla. Sin alguna forma de target+verificación, los
changes aprobados vuelven a ser demasiado ambiguos para implementación TDD.

## Specification
### CR1 — Configuración portable
- **Given** un repo con `readiness.target_patterns` y `readiness.verification_patterns`
- **When** `sl check` valida un change `approved` o `in-progress`
- **Then** usa esos patrones en vez de asumir carpetas `src/` y `test/`

### CR2 — Defaults compatibles
- **Given** un repo existente sin bloque `readiness`
- **When** `sl check` valida Definition of Ready
- **Then** conserva comportamiento compatible o migra sin romper repos existentes

### CR3 — Mensajes semánticos
- **Given** una tarea referencia un CR pero no nombra target o verificación
- **When** `sl check` reporta el problema
- **Then** el mensaje habla de target y verification, no de rutas fijas de este repo

### CR4 — Contrato canónico actualizado
- **Given** un agente lee `.sl/AGENTS.md`
- **When** documenta tareas de implementación
- **Then** entiende que debe seguir la política de readiness configurada por el repo

### CR5 — Config inválida falla claro
- **Given** `readiness` tiene patrones mal formados
- **When** se ejecuta `sl check`
- **Then** reporta un error de config claro sin validar cambios con supuestos silenciosos

## Plan
- [x] Añadir parsing/validación de `readiness.target_patterns` y `readiness.verification_patterns` en `src/check.mjs`, cubierto por `test/check.test.mjs` (CR1, CR2, CR5) — 2026-06-17T10:11:32Z
- [x] Cambiar `namesTargetAndTestFiles` en `src/check.mjs` por una función semántica configurable, cubierta por `test/check.test.mjs` (CR1, CR2, CR3) — 2026-06-17T10:11:35Z
- [x] Actualizar `templates/AGENTS.md` para explicar target+verification configurables, cubierto por `test/init.test.mjs` o tests de contrato existentes en `src/contract.mjs` (CR4) — 2026-06-17T10:11:40Z
- [x] Actualizar `.sl/config.yml` y `.sl/specs/architecture.md` con los defaults de este repo, validado por `src/check.mjs` y `test/check.test.mjs` (CR1, CR4) — 2026-06-17T10:11:44Z
- [x] Ejecutar `pnpm test -- test/check.test.mjs test/init.test.mjs` y `node bin/sl.mjs check` sobre `src/check.mjs` y `src/contract.mjs` (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T10:11:52Z

## Log
- **2026-06-17T02:02:29Z** — Creado desde observación del usuario: la DoR no debe codificar `src/` + `test/` porque los repos consumidores tienen estructuras distintas.
- **2026-06-17T10:07:55Z** — status: draft → approved
- **2026-06-17T10:09:00Z** — status: approved → in-progress
- **2026-06-17T10:09:00Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:12:41Z** — status: in-progress → in-review
- **2026-06-17T10:14:17Z** — review clarification: architecture.md still contains preexisting metrics graduation edits from 20260616-210825; scope for this change is only configurable readiness
- **2026-06-17T10:14:29Z** — review → done (delegated subagent, clean context)
- **2026-06-17T10:14:33Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
