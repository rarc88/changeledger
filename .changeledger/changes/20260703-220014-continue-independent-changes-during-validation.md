---
id: "20260703-220014"
title: Continuar cambios independientes durante validación
type: feature
status: in-progress
created: 2026-07-03T22:00:14Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Permitir que el agente continúe con el siguiente change aprobado cuando uno o
varios changes ya esperan validación humana. La espera debe ser necesaria solo
si el trabajo candidato depende de la revisión de un change en validación, no
una pausa global de toda la cola autorizada.

## Investigation

El contrato actual dice “Stop at `in-validation`”, que puede interpretarse como
detener por completo al agente. `templates/contract/implement.md` también ordena
implementar un change a la vez, pero no distingue entre trabajo activo y un
change cuyo resultado ya está entregado al humano.

ChangeLedger ya representa relaciones explícitas mediante `depends_on` y
`changeledger context <id>` resume el estado de dependencias locales. Por tanto,
el agente puede tomar una decisión determinista sin introducir un scheduler,
automatización oculta ni ejecución paralela: pausar el change entregado,
examinar la cola aprobada y comenzar secuencialmente solo un candidato cuya
cadena de dependencias no alcance un change en validación.

## Proposal

Hacer que la parada de validación sea local al change. Después de entregar un
resultado, el agente mantiene ese change intacto y solicita la decisión humana,
pero puede consultar los changes aprobados y comenzar el siguiente elegible.
“Elegible” significa que ninguna dependencia local directa o transitiva está en
`in-validation`; si la relación bloqueante existe, el agente la comunica y no
empieza ese candidato.

La regla no convierte ChangeLedger en un orquestador: la selección sigue siendo
una decisión explícita del agente, se implementa un solo change a la vez y se
mantienen las reglas normales de rama, baseline, commits y aislamiento de
correcciones. Se descarta añadir un daemon o una cola automática porque excede
el core local-first y no es necesario para resolver la espera artificial.

## Specification

### CR1 — Continuar con un change independiente
- **Given** el change `A` está en `in-validation` y el change aprobado `B` no depende directa ni transitivamente de `A` ni de otro change en validación
- **When** el agente entrega `A` para decisión humana y busca trabajo aprobado aplicable
- **Then** puede iniciar `B` sin esperar la aceptación o rechazo de `A`
- **And** mantiene `A` intacto y ejecuta `B` como el único change en implementación activa

### CR2 — Respetar una dependencia directa
- **Given** el change aprobado `B` declara `depends_on: [A]` y `A` está en `in-validation`
- **When** el agente evalúa `B` como siguiente trabajo
- **Then** no inicia `B`
- **And** informa que la decisión humana sobre `A` es la dependencia bloqueante

### CR3 — Respetar una dependencia transitiva
- **Given** el change aprobado `C` depende de `B`, `B` depende de `A` y `A` está en `in-validation`
- **When** el agente evalúa `C` como siguiente trabajo
- **Then** no inicia `C` aunque `C` no mencione directamente a `A`
- **And** conserva visible la cadena `C → B → A` que justifica la espera

### CR4 — Esperar solo cuando no hay candidatos elegibles
- **Given** hay uno o más changes en `in-validation` y cada change aprobado restante depende directa o transitivamente de alguno de ellos
- **When** el agente inspecciona la cola aprobada
- **Then** se detiene y espera validación humana
- **And** no inventa trabajo, no modifica los resultados entregados y no acepta por el humano

### CR5 — Conservar las fronteras de ejecución
- **Given** un change independiente fue seleccionado mientras otro espera validación
- **When** comienza su implementación
- **Then** cumple la rama no principal, el baseline del documento aprobado y los commits trazables del flujo normal
- **And** no mezcla correcciones no confirmadas ni ejecuta dos changes simultáneamente en el mismo worktree

## Plan

- [ ] Add failing scenarios in `test/context.test.mjs`, then clarify change-scoped validation and sequential queue selection in `templates/contract/core.md`, `templates/contract/implement.md` and `templates/contract/validation.md`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5)
- [ ] Record the durable queue and dependency policy in `.changeledger/specs/lifecycle.md`; verify: `node bin/changeledger.mjs check 20260703-220014` (CR1, CR2, CR3, CR4, CR5)
- [ ] Run the complete quality gate after implementation; verify: `pnpm verify` (support)

## Log

- **2026-07-03T22:00:14Z** — Draft autorizado como mejora independiente; se acotó a política contractual secuencial, sin añadir orquestación automática al core.
- **2026-07-03T22:07:21Z** — status: draft → approved
- **2026-07-03T22:47:31Z** — status: approved → in-progress
- **2026-07-03T22:47:31Z** — owner → raruiz-hiberuscom (auto)
