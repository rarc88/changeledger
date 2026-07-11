---
id: "20260711-103759"
title: Verificación de vigencia del contexto por revisión
type: feature
status: done
created: 2026-07-11T10:37:59Z
depends_on: [ "20260711-103803" ]
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
---

## Request

Los equipos reportan que el flujo consume muchos tokens. La mayor partida
medida no es el texto del contrato en sí (ya gobernado por budgets y llevado a
su suelo útil) sino las recargas completas: cada compactación de contexto o
sesión nueva obliga a recapturar el core íntegro aunque no haya cambiado nada.
Se pide una forma barata de verificar que la captura que el agente conserva
sigue vigente, sin reimprimir el contrato.

## Investigation

- Coste medido por carga (v0.9.0): core ~6,8 KB, spec ~11,5 KB, implement
  ~8 KB, contexto por change-id ~10 KB. Un ciclo completo carga ~7-8k tokens de
  contrato, y las recargas post-compactación lo multiplican.
- El historial de este repo muestra que comprimir más el texto ya fracasó:
  20260629-234939 acumuló 8 retries y un rechazo humano por quedar "incompleta
  y demasiado resumida". El margen está en recargar menos, no en resumir más.
- La línea BEGIN ya imprime la versión del paquete (`src/framing.mjs`), pero el
  texto efectivo depende también de la config del repo (idioma, tdd, matriz),
  así que la versión del paquete no basta para afirmar vigencia: hace falta una
  revisión del contenido compuesto.
- El contrato actual prohíbe operar de memoria tras perder la captura, lo cual
  es correcto; la mejora es distinguir "captura perdida" de "captura resumida
  pero cuya fuente no ha cambiado".

## Proposal

- La línea `CHANGELEDGER CONTEXT BEGIN` de cada modo incluye `rev:<hash>` (12
  hex, derivado del contenido compuesto de ese modo con la config efectiva).
- Nueva opción `changeledger context [mode] --have <rev>`: si `<rev>` coincide
  con la revisión vigente, imprime solo un bloque corto con framing BEGIN/END
  confirmando `unchanged`; si no coincide, imprime la salida completa normal.
- El bootstrap y `templates/contract/core.md` documentan el uso: la primera
  captura de una sesión sigue siendo completa y sin filtros; tras una
  compactación, un agente que conserve el `rev` de su captura puede validar
  vigencia con `--have` en lugar de recapturar, y solo recaptura si la
  respuesta es la salida completa.

Alternativas descartadas:

- Delta textual entre revisiones: frágil y difícil de aplicar sobre una captura
  resumida por el propio agente.
- Un "modo condensado" para recargas: es la vía ya rechazada por el humano por
  pérdida de precisión operativa.

Superficie compartida: el texto del bootstrap se edita también en
20260711-103803 (delimitadores); este change se implementa después.

## Specification

### CR1 — Revisión visible y estable
- **Given** un repo con config estable
- **When** se ejecuta `changeledger context` dos veces
- **Then** ambas líneas BEGIN incluyen el mismo `rev:` de 12 caracteres hex

### CR2 — La revisión refleja la config efectiva
- **Given** una captura previa del `rev` del modo core
- **When** cambia la política del repo (por ejemplo `language`) y se vuelve a ejecutar `changeledger context`
- **Then** el `rev` de la línea BEGIN es distinto al capturado

### CR3 — Verificación positiva
- **Given** el `rev` vigente del modo core
- **When** se ejecuta `changeledger context --have <rev>`
- **Then** la salida es un bloque corto con framing BEGIN/END que contiene `unchanged` y el mismo `rev`
- **And** no incluye el cuerpo del contrato y termina con exit 0

### CR4 — Verificación negativa
- **Given** un `rev` obsoleto o inventado
- **When** se ejecuta `changeledger context --have <rev>`
- **Then** la salida es la completa normal del modo, incluida la línea END

### CR5 — Contrato y bootstrap documentan el uso
- **Given** el contexto core y el bloque bootstrap generados
- **When** se leen tras este change
- **Then** ambos describen la verificación post-compactación con `--have` y mantienen la captura completa obligatoria para la primera invocación

## Plan

- [x] Calcular y exponer `rev` del contenido compuesto en `src/framing.mjs`; verify: `node --test test/framing.test.mjs` (CR1, CR2) — 2026-07-11T11:25:58Z
- [x] Añadir `--have <rev>` en `src/commands/context.mjs` con la respuesta corta framed; verify: `pnpm test` (CR3, CR4) — 2026-07-11T11:25:58Z
- [x] Actualizar `templates/contract/core.md` y el bootstrap en `src/contract.mjs`; verify: `pnpm test` (CR5) — 2026-07-11T11:25:58Z
- [x] Regenerar el bloque bootstrap de `AGENTS.md` de este repo con `changeledger register` (support) — 2026-07-11T11:25:58Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T11:25:58Z

## Log
- **2026-07-11T10:47:26Z** — status: draft → approved
- **2026-07-11T11:06:49Z** — status: approved → in-progress
- **2026-07-11T11:06:49Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T11:25:58Z** — Integrada implementación delegada (6a7c240, 57b90a7, 5b1c2fc): rev de contenido en la línea BEGIN, --have con respuesta corta unchanged, documentación en core.md y bootstrap (BOOTSTRAP_VERSION 1→2, ejercitando la migración de #20260711-103803). pnpm verify 600/600.
- **2026-07-11T11:25:58Z** — status: in-progress → in-review
- **2026-07-11T11:29:41Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T11:37:30Z** — validation → done (human accepted)
- **2026-07-11T15:45:50Z** — graduado a spec `contract-discovery.md`
