---
id: "20260620-214902"
title: Alineación precisa del contrato con la intención
type: feature
status: done
created: 2026-06-20T21:49:02Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Realizar una comparación independiente entre `INTENT.md` y el contrato canónico
`templates/AGENTS.md`, y documentar únicamente las correcciones que siguen siendo
necesarias después de considerar lo que el contrato ya cubre.

Este change es una alternativa de precisión al change
`20260620-214051-contract-lifecycle-gaps`; no deben implementarse ambos de forma
acumulativa sin resolver antes sus diferencias.

## Investigation

La comparación coincide con el change `20260620-214051` en tres necesidades
reales:

1. La fase conversacional merece una regla visible, no solo inferencias repartidas.
2. La excepción de correcciones sin commit debe cubrir también un fallo de review.
3. La división de decisiones humano/agente conviene enunciarla como principio.

Sin embargo, difiere en los siguientes puntos:

**La autorización explícita ya existe.** §6.12 ordena crear un draft solo después
de autorización explícita y reconoce que una petición directa ya autoriza. §5
también define `draft` como creado tras petición o autorización humana. La brecha
no es ausencia de autorización, sino falta de un gate conjunto y claro:
**autorización + claridad suficiente**. El contrato no dice qué hacer cuando el
humano pide crear un change antes de que exista información suficiente.

**El protocolo posterior a transiciones humanas ya está distribuido en el
contrato.** Tras `draft → approved`, §6.4 exige preparar rama/worktree y commitear
la documentación aprobada antes del código. Tras un rechazo, §6.7 exige actualizar
Specification/Plan y repetir review/validation. Tras `done`, §6.9 y §10 exigen
graduar o revisar que no exista verdad persistente. Puede mejorarse con enlaces,
pero no constituye una brecha funcional independiente.

**Extender un change activo sin límites puede invalidar la aprobación.** El CR5
del change comparado permite modificar Specification/Plan en `approved` o
`in-progress` sin distinguir entre trabajo necesario para cumplir el objetivo ya
aprobado y una ampliación observable del alcance. Lo primero cabe en el mismo
change; lo segundo necesita autorización humana explícita, aunque siga siendo un
tema relacionado. Un asunto independiente sigue necesitando otro change.

**La retrospectiva y el triage de fricción son dos momentos distintos.** Reemplazar
"before closing a turn or change" por solo "when a change closes" elimina el triage
útil durante conversaciones que todavía no tienen change. La ambigüedad se resuelve
definiendo el checkpoint de entrega del agente y añadiendo una retrospectiva
obligatoria cuando el change llega a `done`, no suprimiendo uno de los dos.

**La corrección de review necesita un punto de commit posterior.** No basta decir
que la corrección queda sin commit hasta otra revisión limpia. Tras `sl review
<id> pass`, el contrato debe ordenar commitear la corrección confirmada junto con
la verdad del ledger antes de solicitar validación humana. Así no deja el
worktree como frontera de aislamiento durante la siguiente fase.

**El lenguaje "cierra" es ambiguo frente a `discarded`.** `INTENT.md` describe la
retrospectiva del ciclo completado y el CR6 del change comparado usa `done`, pero
su Proposal dice "when a change closes". Debe fijarse `done` para la retrospectiva
de ejecución; un descarte puede registrar su razón, pero no tuvo necesariamente
un ciclo de implementación que analizar.

## Proposal

Hacer ajustes quirúrgicos en `templates/AGENTS.md`:

- En §1, enunciar que el humano autoriza alcance y gates de aceptación, mientras
  el agente decide la ejecución dentro de ese alcance.
- Al comienzo de §6, describir la fase conversacional como exploración sin crear
  archivos de change y exigir conjuntamente claridad suficiente y autorización
  explícita. Si una petición de creación llega demasiado pronto, el agente aclara
  primero; no inventa requisitos para rellenar el draft.
- Junto a "One concern per change", definir el crecimiento de un change activo:
  trabajo necesario dentro del objetivo aprobado se incorpora y registra; una
  ampliación material relacionada requiere autorización humana explícita; un
  asunto independiente se propone como otro change.
- En §6.4/§6.6, generalizar la regla de corrección sin commit. Un fallo de review
  mantiene la corrección aislada hasta un nuevo review limpio; después del pass se
  commitean corrección y ledger antes de validación. Mantener la regla actual para
  rechazo humano hasta su aceptación final.
- En §6.12, separar dos checkpoints: triage de fricción descubierta antes de que
  el agente entregue el resultado de su trabajo al humano, y retrospectiva breve
  obligatoria al alcanzar `done`. En ambos, las mejoras independientes solo se
  proponen; nunca se crea un draft sin autorización.
- No añadir un protocolo post-transición duplicado. Añadir, como máximo, enlaces
  desde §5 hacia las reglas existentes de §6.4, §6.7 y §6.9/§10.

**Alternativa descartada:** aplicar literalmente los ocho criterios del change
`20260620-214051`. Duplicaría reglas existentes y permitiría ampliar silenciosamente
alcance ya aprobado.

## Specification

### CR1 — Gate conjunto para crear un change
- **Given** una conversación sin claridad suficiente o sin autorización explícita para documentar
- **When** el agente evalúa si debe crear uno o más drafts
- **Then** no crea archivos de change hasta que existan ambas condiciones
- **And** si la autorización llegó antes que la claridad, continúa aclarando sin inventar requisitos

### CR2 — Conversación previa sin efectos documentales
- **Given** una conversación anterior al gate de creación
- **When** el agente pregunta, razona o realiza investigación de solo lectura
- **Then** puede madurar la comprensión sin crear un change ni otro artefacto de implementación

### CR3 — Crecimiento dentro del objetivo autorizado
- **Given** un change activo y trabajo nuevo necesario para cumplir su objetivo ya autorizado
- **When** el agente descubre ese trabajo durante investigación o ejecución
- **Then** actualiza Specification, Plan y Log del mismo change sin crear otro

### CR4 — Crecimiento material o independiente
- **Given** un change activo y una necesidad descubierta que amplía materialmente su comportamiento observable o es independiente de su objetivo
- **When** el agente clasifica la necesidad
- **Then** solicita autorización explícita antes de incorporar una ampliación material relacionada al mismo change
- **And** propone un change separado si la necesidad es independiente

### CR5 — Corrección confirmada por review limpio
- **Given** un `sl review <id> fail --retry` y una corrección aún no commiteada
- **When** un subagente nuevo con contexto limpio ejecuta la siguiente revisión
- **Then** un fallo conserva la corrección sin commit para otra iteración
- **And** un pass provoca que corrección y ledger se commiteen antes de pedir validación humana

### CR6 — Corrección confirmada por validación humana
- **Given** un rechazo humano `in-validation → in-progress`
- **When** el agente prepara la corrección
- **Then** conserva la corrección sin commit hasta que el humano acepte el resultado final

### CR7 — Triage y retrospectiva con checkpoints definidos
- **Given** fricción descubierta durante el uso de Spec Ledger
- **When** el agente entrega al humano el resultado completado o bloqueado de su trabajo
- **Then** clasifica la fricción necesaria, operacional, independiente o vaga conforme a §6.12
- **And** cuando el change alcanza `done`, comparte además una retrospectiva breve del ciclo
- **And** no crea un change independiente sin autorización explícita

### CR8 — Responsabilidades sin invasión de alcance
- **Given** una decisión dudosa durante el ciclo
- **When** el agente consulta los principios del contrato
- **Then** encuentra que el humano autoriza alcance, aprobación y aceptación final
- **And** el agente decide división, commits y recursos de ejecución dentro del alcance autorizado

## Plan

- [x] Ajustar principios y gate conversacional en `templates/AGENTS.md` y su cobertura en `test/cli.test.mjs`; verificar: `node --test test/cli.test.mjs` (CR1, CR2, CR8) — 2026-06-20T22:03:55Z
- [x] Definir crecimiento autorizado del change en `templates/AGENTS.md` y su cobertura en `test/cli.test.mjs`; verificar: `node --test test/cli.test.mjs` (CR3, CR4) — 2026-06-20T22:03:55Z
- [x] Completar el protocolo de correcciones de review y validación en `templates/AGENTS.md` y su cobertura en `test/cli.test.mjs`; verificar: `node --test test/cli.test.mjs` (CR5, CR6) — 2026-06-20T22:03:56Z
- [x] Separar triage y retrospectiva en `templates/AGENTS.md` y su cobertura en `test/cli.test.mjs`; verificar: `node --test test/cli.test.mjs` (CR7) — 2026-06-20T22:03:56Z
- [x] Alinear `INTENT.md`, reflejar sus precisiones en `templates/AGENTS.md` y verificar con `node --test test/cli.test.mjs`, conservando la versión original en el commit base (CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8) — 2026-06-20T22:03:56Z
- [x] Ejecutar `pnpm verify` y confirmar que el contrato y el repositorio no presentan regresiones (support) — 2026-06-20T22:04:27Z

## Log

- 2026-06-20T21:49:02Z — Change creado como comparación independiente; no modifica `INTENT.md` ni el change `20260620-214051`.
- **2026-06-20T21:59:19Z** — status: draft → approved
- **2026-06-20T22:01:28Z** — status: approved → in-progress
- **2026-06-20T22:01:28Z** — owner → Roberto Ruiz (auto)
- **2026-06-20T22:04:27Z** — Implementación completada; pnpm verify pasó con 334 tests y 112 changes válidos.
- **2026-06-20T22:04:27Z** — status: in-progress → in-review
- **2026-06-20T22:10:35Z** — review → in-progress (retry): La autorización humana para ajustar INTENT.md existió en la conversación, pero no quedó registrada en el Log y la tarea se clasificó incorrectamente como support.
- **2026-06-20T22:10:49Z** — Trazabilidad de alcance: después de aprobar el change, el humano autorizó explícitamente ajustar INTENT.md preservando primero su versión original en git; la tarea correspondiente se reclasificó con CR1–CR8 tras el hallazgo del review.
- **2026-06-20T22:10:58Z** — status: in-progress → in-review
- **2026-06-20T22:12:20Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-20T22:15:27Z** — validation → done (human accepted)
- **2026-06-20T22:18:04Z** — graduado a spec `architecture.md`
- **2026-06-20T22:18:04Z** — archived
