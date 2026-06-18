---
id: "20260618-122611"
title: Warnings de readiness deben explicar patrones usados
type: feature
status: in-progress
created: 2026-06-18T12:26:11Z
depends_on: []
owner: Roberto Ruiz
---

## Request
Al diagnosticar `sl check` en un repo consumidor (`ionic-app`), los warnings de
Definition of Ready indicaron `Plan task for CRn must name target and verification`
sin explicar qué patrones estaba usando el checker ni que el repo no tenía
`readiness` configurado.

El mensaje debe ayudar al autor del change a distinguir entre:

- una tarea incompleta que no nombra target/verificación; y
- una configuración de repo demasiado estrecha para su estructura.

## Investigation
- `ionic-app/.sl/config.yml` no define `readiness`, por lo que `sl check` usa los
  defaults `target_patterns: ["src/**"]` y `verification_patterns: ["test/**"]`.
- Los changes de Ionic tenían tareas con targets válidos para Capacitor
  (`android/**`, `ios/**`, `package.json`, `.sl/specs/**`) y verificaciones por
  comando o dispositivo (`pnpm run build`, `pnpm run lint`, `grep`, validación en
  dispositivo real), pero esos textos no coincidían con los defaults.
- Enumerar frases como `dispositivo físico`, `emulador Android` o `consola de
  red` en `verification_patterns` es demasiado específico: convierte una
  política estructural en una lista de vocabulario accidental.
- Una alternativa más estándar con el checker actual es configurar
  `verification_patterns: ["verify:"]` y exigir que toda tarea de implementación
  tenga una cláusula explícita `verify: ...`. El contenido de la cláusula puede
  ser comando, test, inspección manual o evidencia de dispositivo, sin inflar la
  config del repo.
- Una prueba seca con patrones adecuados eliminó casi todos los warnings; quedó
  solo una tarea que realmente no nombraba un target concreto.
- El checker es correcto, pero el mensaje no ofrece suficiente contexto para
  resolver el problema rápidamente en repos externos.

## Proposal
Mejorar el reporte de readiness para incluir el `readiness` efectivo cuando una
tarea con CR no nombra target/verificación reconocidos.

El mensaje puede mantenerse breve, pero debe apuntar al autor hacia la solución:
ajustar la tarea o configurar `readiness.target_patterns` y
`readiness.verification_patterns` en `.sl/config.yml`.

La orientación recomendada debe favorecer patrones estándar y estructurales. Para
verificación, el contrato debe permitir usar `verify:` como cláusula canónica en
la tarea, en vez de obligar a listar cada frase manual posible en la config.

## Specification
### CR1 — Warning muestra patrones efectivos
- **Given** un repo sin bloque `readiness`
- **When** `sl check` reporta `Plan task for CR1 must name target and verification`
- **Then** el mensaje indica que está usando los defaults `src/**` y `test/**`

### CR2 — Warning muestra patrones configurados
- **Given** un repo con `readiness.target_patterns: ["app/**"]` y `readiness.verification_patterns: ["pnpm test"]`
- **When** una tarea con CR no coincide con esos patrones
- **Then** el mensaje muestra `app/**` y `pnpm test` como política esperada

### CR3 — Contrato orienta repos consumidores
- **Given** un agente lee `templates/AGENTS.md`
- **When** documenta tareas para un repo con estructura no estándar
- **Then** entiende que debe revisar o configurar `readiness` en `.sl/config.yml`
- **And** prefiere patrones estructurales como `verify:` antes que vocabulario específico de dispositivo o UI

## Plan
- [ ] Actualizar `src/check.mjs` para que los warnings/errores de readiness incluyan los patrones efectivos y si vienen de defaults; verify: `pnpm test -- test/check.test.mjs` (CR1, CR2)
- [ ] Cubrir el caso default y el caso configurado para `src/check.mjs` en `test/check.test.mjs`; verify: `pnpm test -- test/check.test.mjs` (CR1, CR2)
- [ ] Ajustar `templates/AGENTS.md` para orientar a repos con estructura no estándar hacia `readiness` en config; verify: `pnpm test -- test/cli.test.mjs` (CR3)

## Log
- **2026-06-18T12:26:11Z** — Creado desde diagnóstico de warnings en `ionic-app`: el checker era correcto, pero el mensaje no dejaba claro que estaba usando defaults `src/**` + `test/**`.
- **2026-06-18T12:33:00Z** — Refinado desde feedback: no conviene meter frases manuales como `dispositivo físico` o `consola de red` en `verification_patterns`; mejor orientar la convención hacia una cláusula estándar `verify:`.
- **2026-06-18T12:58:00Z** — status: draft → approved
- **2026-06-18T12:59:08Z** — status: approved → in-progress
- **2026-06-18T12:59:08Z** — owner → Roberto Ruiz (auto)
