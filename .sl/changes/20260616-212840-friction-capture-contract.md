---
id: "20260616-212840"
title: Capturar fricciones descubiertas durante el uso
type: feature
status: done
created: 2026-06-16T21:28:40Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
El usuario tuvo que preguntar explícitamente si durante el uso de Spec Ledger se
habían descubierto fricciones o errores. Ese aprendizaje debería capturarse de
forma automática: cuando el agente tropieza con una fricción accionable mientras
trabaja, debe registrarla como cambio futuro sin esperar una pregunta posterior.

## Investigation
- Spec Ledger dogfoodea su propio flujo; las mejores mejoras aparecen al usarlo.
- Hoy el contrato exige mantener el change actualizado, revisar y graduar, pero
  no exige registrar fricciones descubiertas fuera del alcance inmediato.
- Si el agente no las registra, quedan en memoria conversacional y se pierden al
  cerrar el turno.
- La regla debe vivir en `templates/AGENTS.md`, porque aplica a cualquier repo
  consumidor de Spec Ledger, no solo a este proyecto.
- La arquitectura debe reflejar luego que el contrato incluye este mecanismo de
  mejora continua.

## Proposal
Agregar una regla canónica de **friction capture**:

- Durante la ejecución y antes del cierre del turno, el agente revisa fricciones,
  errores, ambigüedades o mejoras descubiertas al usar la herramienta.
- Si son accionables y no pertenecen al cambio actual, crea uno o más changes
  `draft` separados, uno por concern, con investigación breve y criterios.
- Si la fricción pertenece al change actual, la registra en su `## Log` o ajusta
  su Specification/Plan.
- Si no es accionable o no merece backlog, la menciona en la respuesta final como
  observación descartada.
- No debe mezclar estas mejoras con la implementación principal ni bloquear el
  cierre de la tarea original.

El lugar correcto es `templates/AGENTS.md` en §6 Agent rules, porque define el
comportamiento de agentes. `AGENTS.md` raíz solo referencia el contrato y no debe
duplicar reglas. `.sl/specs/architecture.md` se actualiza al graduar para reflejar
la capacidad persistente.

## Specification
### CR1 — Regla en contrato canónico
- **Given** un agente trabaja bajo Spec Ledger
- **When** descubre una fricción accionable fuera del alcance del change actual
- **Then** `templates/AGENTS.md` le indica crear un change draft separado

### CR2 — Fricción dentro del alcance actual
- **Given** la fricción pertenece al change en curso
- **When** el agente la identifica
- **Then** el contrato indica registrarla en el Log o ajustar Specification/Plan del mismo change

### CR3 — Observaciones no accionables
- **Given** la fricción no amerita backlog
- **When** el agente cierra el turno
- **Then** el contrato indica mencionarla como observación final sin crear change

### CR4 — Sin bloqueo ni mezcla de concerns
- **Given** la tarea principal ya está lista para cerrar
- **When** se crean changes draft de fricción
- **Then** no bloquean el cierre del change original ni se mezclan en su implementación

### CR5 — Verdad persistente actualizada
- **Given** el contrato incorpora friction capture
- **When** el change se gradúa
- **Then** `architecture.md` documenta la mecánica como parte del flujo de agentes

## Plan
- [x] Añadir regla de friction capture en `templates/AGENTS.md` y asegurar su instalación desde `src/contract.mjs`, cubierta por `test/init.test.mjs` (CR1, CR2, CR3, CR4) — 2026-06-17T10:19:52Z
- [x] Actualizar `.sl/specs/architecture.md` para reflejar la mecánica, validada por `src/check.mjs` y `test/check.test.mjs` (CR5) — 2026-06-17T10:19:56Z
- [x] Añadir o ajustar tests de contrato en `test/init.test.mjs` para asegurar que `src/contract.mjs` instala la regla en el contrato enlazado (CR1, CR2, CR3, CR4) — 2026-06-17T10:20:02Z
- [x] Ejecutar `pnpm test -- test/init.test.mjs test/check.test.mjs` sobre `src/contract.mjs` y `src/check.mjs`, más `node bin/sl.mjs check` (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T10:20:06Z

## Log
- **2026-06-16T21:28:40Z** — Creado desde acuerdo con el usuario: las fricciones descubiertas al usar la herramienta deben capturarse automáticamente.
- **2026-06-17T10:05:16Z** — status: draft → approved
- **2026-06-17T10:18:56Z** — status: approved → in-progress
- **2026-06-17T10:18:56Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:20:12Z** — status: in-progress → in-review
- **2026-06-17T10:21:03Z** — review → done (delegated subagent, clean context)
- **2026-06-17T10:21:08Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
