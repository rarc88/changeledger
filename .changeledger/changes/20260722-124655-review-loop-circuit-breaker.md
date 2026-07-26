---
id: "20260722-124655"
title: Cortar ciclos de review que revelan diseño incompleto
type: feature
status: draft
created: 2026-07-22T12:46:55Z
depends_on: []
related_to: ["20260629-234939", "20260704-114323"]
---

## Request

Los changes complejos están entrando repetidamente en `in-review`, recibiendo un
hallazgo parcial y volviendo a `in-progress` para aplicar otro parche. En
`20260721-193102` hubo cinco rechazos técnicos; en trabajos anteriores se
alcanzaron nueve ciclos. El review terminó funcionando como descubrimiento
incremental del diseño, con alto coste y poca previsibilidad.

ChangeLedger debe permitir una corrección normal, pero cortar el ciclo cuando
dos rechazos muestran que la definición o la estrategia siguen incompletas. El
bloqueo debe conservar todos los hallazgos y forzar un replanteamiento amplio,
no otra corrección local disfrazada de retry.

## Investigation

`20260629-234939` restauró Definition of Ready y detalle contractual;
`20260704-114323` restauró los comandos y ownership del veredicto. Ninguno
limita `review fail --retry`, agrupa intentos en episodios ni distingue una
regresión puntual de evidencia acumulada de diseño insuficiente.

El lifecycle actual acepta una cantidad ilimitada de eventos
`in-review → in-progress (retry)`. El contexto de corrección ordena volver a
implementar, pero no exige sintetizar todos los hallazgos anteriores, revisar la
clase completa del defecto ni revalidar la matriz CR/superficies/riesgos. Cada
reviewer fresco puede descubrir la siguiente frontera omitida y el historial no
cambia el mecanismo disponible.

Los cinco rechazos de `20260721-193102` no fueron cinco variantes del mismo bug:
aparecieron sucesivamente CAS/OID de publicación, distinción commit/tree,
preflight del primer acceso mutador y preservación de errores contractuales. El
patrón muestra que el primer diseño no convirtió el protocolo extremo a extremo
en una matriz adversarial antes del review. Seguir parcheando después del
segundo rechazo aumentó cobertura, pero no dio una señal operativa de que había
que detenerse y rediseñar.

La causa es doble: retry ilimitado y un contrato de corrección centrado en el
último finding. Las métricas actuales pueden contar transiciones, pero no
definen un episodio de review ni un límite que altere el lifecycle.

## Proposal

Tratar cada paso por review como un episodio explícito. El episodio empieza al
entrar por primera vez en `in-review` y acumula los verdicts fallidos hasta
aceptación, descarte o un reset de diseño autorizado por el humano.

El primer rechazo puede usar el retry normal. Antes de volver a review, el
contexto exige una síntesis de la clase del defecto: criterios afectados,
superficies hermanas, invariantes, matriz de escenarios y tests negativos. El
objetivo no es arreglar solo la línea reportada, sino demostrar que el conjunto
equivalente quedó cubierto.

El segundo rechazo se registra, pero el CLI mueve el change a `blocked` aunque
se solicite otro retry. La salida explica que se alcanzó el límite de dos y
presenta el historial completo del episodio. No existe un tercer
`in-review → in-progress` automático.

Salir de ese bloqueo requiere decisión humana explícita. El agente presenta una
revisión de Investigation/Proposal/Specification/Plan, decide con el humano si
se refina, divide o descarta el change y registra un reset de diseño. Solo ese
reset abre un episodio nuevo; una transición genérica `blocked → in-progress`
no borra el contador.

Se descarta prohibir todo retry: una regresión localizada sigue siendo normal.
También se descarta un warning sin enforcement: ya se ignoraron señales
similares bajo presión por continuar.

## Specification

### CR1 — Primer rechazo permite corrección integral
- **Given** un change en su primer intento de review del episodio actual
- **When** el orquestador registra `review fail --retry "F"`
- **Then** el change vuelve a `in-progress` y el Log registra intento 1 con `F`
- **And** el contexto de implementación exige sintetizar criterios, superficies hermanas, invariantes y tests negativos antes de volver a review

### CR2 — Segundo rechazo activa el cortacircuito
- **Given** un episodio con un rechazo previo y el change nuevamente en `in-review`
- **When** el reviewer emite un segundo veredicto fallido
- **Then** el CLI registra el hallazgo y deja el change en `blocked`
- **And** no crea una segunda transición `in-review → in-progress (retry)`
- **And** la salida contiene `review retry limit reached after 2 failed reviews`

### CR3 — El historial del episodio no se pierde
- **Given** un change bloqueado por el límite
- **When** se ejecuta `context`, `show` o la vista del change
- **Then** se muestran ambos findings, sus timestamps y el número de episodio
- **And** notas, cambios de owner y transiciones no relacionadas no reinician el conteo

### CR4 — Solo un reset humano abre otro episodio
- **Given** un change bloqueado por dos reviews fallidos
- **When** el agente intenta devolverlo a `in-progress` sin una decisión humana de reset
- **Then** la operación falla sin mutar el lifecycle
- **When** el humano autoriza un reset que identifica el change y la estrategia revisada
- **Then** se registra un nuevo episodio y el change puede volver a `in-progress`
- **And** el historial y métricas del episodio anterior permanecen intactos

### CR5 — El reset exige redefinición comprobable
- **Given** un reset de diseño autorizado
- **When** se prepara el siguiente intento
- **Then** `changeledger check` exige una nota estructurada que referencia los CR modificados, superficies auditadas y comando de gate completo
- **And** si cambia comportamiento o alcance, Specification y Plan deben actualizarse antes de volver a review

### CR6 — Métricas distinguen retries y resets
- **Given** changes con cero, uno o dos rechazos y posibles resets
- **When** se calculan métricas de lifecycle
- **Then** se informan intentos por episodio, changes bloqueados por límite y resets autorizados
- **And** un fallo del gate previo al reviewer no cuenta como intento de review

## Plan

- [ ] Añadir tests de episodios, conteo y límite en `test/lifecycle.test.mjs` y `test/review-command.test.mjs`; implementar el cortacircuito en `src/lifecycle.mjs` y `src/commands/review.mjs`; verify: `node --test test/lifecycle.test.mjs test/review-command.test.mjs` (CR1, CR2, CR4)
- [ ] Persistir y renderizar historial de episodio/reset en `src/change-parser.mjs`, `src/commands/show.mjs` y `src/viewer/`; verify: `node --test test/parser.test.mjs test/view.test.mjs` (CR3, CR4)
- [ ] Extender `templates/contract/review.md`, `implement.md` y overlays de bloqueo con síntesis integral y reset autorizado; verify: `node --test test/context.test.mjs` (CR1, CR4, CR5)
- [ ] Añadir validación de evidencia de reset a `src/check.mjs`; verify: `node --test test/check.test.mjs` (CR5)
- [ ] Exponer intentos por episodio, bloqueos y resets en `src/metrics.mjs`; verify: `node --test test/metrics.test.mjs` (CR6)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T12:46:55Z** `[note]` Draft creado para evitar que review sustituya al diseño: un retry normal, segundo rechazo bloquea y solo un reset humano abre otro episodio.
