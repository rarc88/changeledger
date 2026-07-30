---
id: "20260720-212659"
title: Hacer opcional la carga de ChangeLedger desde el bootstrap
type: feature
status: done
created: 2026-07-20T21:26:59Z
depends_on: []
archived: true
reviewed: true
owner: Roberto Ruiz
related_to: [ "20260613-205854", "20260629-155349", "20260629-165838", "20260701-213931", "20260704-144327", "20260711-103759" ]
---

## Request

El bootstrap administrado ha acumulado reglas del contrato y detalles de
delegación hasta convertir la instalación de ChangeLedger en un requisito para
todo agente que trabaja en un repositorio registrado. Se quiere recuperar una
puerta de entrada pequeña y hacer que el uso dependa de que el CLI esté
disponible en el entorno:

- el agente intenta ejecutar `changeledger context` sin una comprobación previa
  dependiente del shell;
- si el comando no existe, continúa normalmente sin ChangeLedger;
- si existe pero falla, no confunde el error con ausencia y lo presenta al
  humano para que decida;
- si carga contexto, mantiene las garantías de captura completa, centinela END
  y recuperación tras compactación;
- si observa una divergencia entre specs y código, la notifica sin decidir por
  cuenta propia cómo reconciliarla.

El objetivo no es garantizar que todo cambio pase por el lifecycle, sino
permitir adopción oportunista sin ocultar el riesgo de desincronización.

## Investigation

El bloque vigente en `src/contract.mjs` mezcla cuatro superficies: discovery
del CLI, protocolo anti-truncado, autorización de cambios y la excepción
especializada de `agent-context`. Además falla cerrado cuando el ejecutable no
está disponible y ordena restaurarlo o instalarlo. Esa política obliga a usar
ChangeLedger incluso a colaboradores que no lo han elegido.

Intentar directamente `changeledger context` es una comprobación portable: no
obliga al agente a escoger entre `command -v`, `which`, PowerShell u otros
mecanismos del entorno. Sin embargo, tratar cualquier error como ausencia
crearía un bypass accidental. Hay tres resultados distintos:

1. El shell informa que el comando no existe: continuar sin ChangeLedger.
2. El ejecutable comienza pero termina con error: notificarlo y dejar al humano
   decidir si se continúa sin la herramienta.
3. El comando termina pero no aparece `CHANGELEDGER CONTEXT END`: la captura es
   parcial y debe repetirse con capacidad suficiente, nunca seguirse como
   contexto válido.

`agent-context` es una ruta avanzada y ya se descubre dentro de los esqueletos
producidos por `changeledger agent-prompt <role>` y del contexto de review.
Repetir roles, sintaxis o una excepción genérica en el bootstrap filtra detalle
de delegación a todos los consumidores. La distinción tampoco debe expresarse
como agente frente a subagente: no todo subagente usa una cápsula y esa identidad
puede ser ambigua. Cada prompt delegado puede reemplazar explícitamente la carga
predeterminada del bootstrap justo donde prescribe su `agent-context`.

Hacer opcional el CLI elimina la garantía de que changes, specs y código se
mantengan sincronizados. `changeledger check` valida estructura, no equivalencia
semántica. El bootstrap no puede resolver esa tensión con más prosa: cuando un
agente detecta una divergencia debe informar al humano, no asumir que la spec o
el código debe sobrescribir al otro ni ampliar silenciosamente su tarea.

Los antecedentes relacionados no son prerrequisitos de ejecución: documentan
la verdad persistente (`20260613-205854`), los fallos de carga incompleta
(`20260629-155349`, `20260629-165838`), el discovery inmediato
(`20260701-213931`), las cápsulas delegadas (`20260704-144327`) y la recuperación
por revisión tras compactación (`20260711-103759`). Por eso figuran en
`related_to` y no en `depends_on`.

## Proposal

Reducir el bootstrap a un adaptador de discovery seguro:

- ordenar que se intente `changeledger context` antes de planificar, investigar
  o actuar;
- permitir continuar normalmente cuando el comando no esté disponible;
- distinguir un fallo del ejecutable de su ausencia y pedir decisión humana en
  vez de degradar silenciosamente;
- inmediatamente junto al intento del comando, exigir que una carga exitosa
  conserve stdout completo hasta el centinela END, sin pipes, filtros, resúmenes,
  previews ni límites voluntarios;
- conservar `changeledger context [mode] --have <rev>` para comprobar vigencia
  tras compactación y recargar completamente si se perdió el contexto o su rev;
- retirar por completo del bootstrap la delegación y la política de divergencias;
  los prompts delegados reemplazan explícitamente la carga predeterminada con su
  `agent-context`, y el contexto core/implement conserva la decisión humana sobre
  divergencias.

Retirar del bootstrap la regla universal de no editar sin un change autorizado,
la mención concreta de `agent-context`, sus roles y su centinela. El lifecycle,
la autoridad y las rutas especializadas siguen perteneciendo al contexto que
recibe quien efectivamente usa ChangeLedger.

`init`, `register` y `check` siguen instalando, actualizando y validando el
bloque canónico. La opcionalidad afecta a la ejecución del CLI por el agente, no
a la presencia del bootstrap en un repositorio registrado.

Se descarta interpretar cualquier fallo como ausencia: ocultaría instalaciones
rotas y convertiría la truncación en una salida del contrato. También se
descarta añadir flags de opt-out o configuración por usuario sin evidencia de
que la disponibilidad del CLI sea un proxy insuficiente; ampliaría la
superficie que precisamente se quiere reducir.

## Specification

### CR1 — Ausencia del CLI no bloquea el trabajo
- **Given** un agente que lee el bootstrap de un repositorio registrado
- **When** intenta ejecutar `changeledger context` y el entorno informa que el comando no existe
- **Then** el bootstrap le permite continuar normalmente sin ChangeLedger
- **And** no le ordena instalar, restaurar ni localizar el ejecutable mediante un comando previo

### CR2 — Un fallo real no se confunde con ausencia
- **Given** que el ejecutable `changeledger` está disponible
- **When** `changeledger context` comienza pero termina con error
- **Then** el bootstrap exige presentar el error al humano para que decida cómo continuar
- **And** no autoriza una degradación silenciosa al flujo sin ChangeLedger

### CR3 — La primera captura exitosa permanece completa
- **Given** que `changeledger context` produce una salida exitosa
- **When** el agente carga el contexto por primera vez
- **Then** conserva stdout completo hasta `CHANGELEDGER CONTEXT END`
- **And** esa obligación aparece inmediatamente junto a la ejecución del comando, antes de tratar ausencia o errores
- **And** no usa pipes, filtros, resúmenes, previews ni límites voluntarios
- **And** si falta el centinela END, repite la captura con capacidad suficiente antes de usarla

### CR4 — La compactación conserva verificación por revisión
- **Given** un contexto completo cuyo BEGIN contiene `rev:<hash>`
- **When** ocurre una compactación de la conversación
- **Then** el bootstrap indica validar la captura retenida con `changeledger context [mode] --have <rev>`
- **And** si se perdió el contexto o su revisión, exige cargarlo completamente otra vez

### CR5 — La delegación avanzada no se filtra al flujo normal
- **Given** el bootstrap canónico generado por `init` o `register`
- **When** un agente normal lo lee
- **Then** no menciona delegación, subagentes, roles, sintaxis de `agent-context` ni el centinela `CHANGELEDGER AGENT CONTEXT END`
- **And** cada esqueleto generado por `agent-prompt` indica explícitamente que su `agent-context` reemplaza la carga predeterminada del bootstrap

### CR6 — Las divergencias quedan en manos humanas
- **Given** un agente que observa que una spec y el código describen comportamientos incompatibles
- **When** la divergencia afecta a su tarea o aparece durante su investigación
- **Then** el contexto cargado, no el bootstrap, exige notificarla al humano sin modificar spec o código solo para reconciliarlos
- **And** si afecta a la tarea espera la decisión humana, y si es ajena la reporta sin ampliar el alcance

### CR7 — El bootstrap deja de contener reglas del lifecycle
- **Given** el bootstrap canónico generado por `init` o `register`
- **When** se inspecciona su contenido
- **Then** no prohíbe universalmente crear o modificar archivos sin un change autorizado
- **And** remite la autoridad y el lifecycle al contexto cargado cuando ChangeLedger está disponible

### CR8 — Registro y validación siguen siendo deterministas
- **Given** un repositorio registrado con una versión anterior del bootstrap
- **When** se ejecuta `changeledger register` con la nueva versión
- **Then** reemplaza solo el bloque administrado por el nuevo texto opcional y conserva el contenido externo
- **And** `changeledger check` detecta el bloque anterior como desactualizado y acepta el nuevo

## Plan

- [x] Escribir primero tests semánticos del bootstrap opcional y actualizar `src/contract.mjs`
  - **Verify:** `node --test test/contract.test.mjs test/register.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR7, CR8
  - **Resolved:** `2026-07-20T21:46:34Z`
- [x] Escribir primero la cobertura de la notificación de divergencias y ajustar `templates/contract/core.md` y `templates/contract/implement.md` sin duplicar lifecycle
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR6, CR7
  - **Resolved:** `2026-07-20T21:47:18Z`
- [x] Actualizar `README.md` con el modelo de adopción opcional y la distinción entre ausencia, error, truncación y divergencia
  - **Support:**
  - **Resolved:** `2026-07-20T21:47:42Z`
- [x] Re-registrar el bootstrap del propio repositorio después de cubrir su migración en la primera tarea
  - **Support:**
  - **Resolved:** `2026-07-20T21:47:53Z`
- [x] Ejecutar `pnpm verify` tras completar la implementación
  - **Support:**
  - **Resolved:** `2026-07-20T21:49:06Z`
- [x] Corregir primero `test/contract.test.mjs` y `test/agent-prompt.test.mjs`, y después `src/contract.mjs` y `templates/contract/agent-prompts/`, para exigir un bootstrap sin delegación ni divergencias, con anti-truncado adyacente al comando, y prompts que reemplacen explícitamente la carga predeterminada
  - **Verify:** `node --test test/contract.test.mjs test/agent-prompt.test.mjs`
  - **Criteria:** CR3, CR5, CR6, CR7
  - **Resolved:** `2026-07-20T22:16:08Z`
- [x] Mantener el bloque canónico en `src/contract.mjs`, re-registrar `AGENTS.md` y comprobar la migración determinista
  - **Verify:** `node --test test/register.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-07-20T22:16:08Z`
- [x] Ejecutar los gates completos de la corrección
  - **Verify:** Biome sobre archivos afectados, `pnpm test` y `pnpm check`
  - **Support:**
  - **Resolved:** `2026-07-20T22:16:41Z`

## Log

- **2026-07-20T21:26:59Z** `[note]` Draft creado tras autorización humana explícita; el alcance se limita al bootstrap opcional, la preservación anti-truncado/compactación y el reporte humano de divergencias.
- **2026-07-20T21:40:08Z** `[status]` draft → approved
- **2026-07-20T21:41:08Z** `[status]` approved → in-progress
- **2026-07-20T21:41:08Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-20T21:47:18Z** `[note]` La semántica de divergencia reemplaza document-wins en core e implement: una divergencia preexistente requiere decisión humana, mientras el change aprobado gobierna el código escrito en alcance. Core queda en 138 líneas/8451 bytes e implement en 199/9862: ambos superan target por reglas ya acumuladas pero permanecen bajo hard cap (140/9000 y 205/10000); no se eleva presupuesto.
- **2026-07-20T21:49:06Z** `[status]` in-progress → in-review
- **2026-07-20T21:55:19Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-20T22:11:37Z** `[validation]` in-validation → in-progress (human rejected via conversation): Simplificar el bootstrap: retirar delegación y divergencias, y acercar la protección contra truncado al comando
- **2026-07-20T22:13:33Z** `[note]` La corrección elimina del bootstrap las excepciones de delegación y la política de divergencias. El anti-truncado queda en el mismo párrafo que `changeledger context`; cada `agent-prompt` reemplaza explícitamente esa carga predeterminada, mientras core/implement conservan la resolución humana de divergencias.
- **2026-07-20T22:16:28Z** `[note]` `pnpm verify` no puede iniciar Biome por el `biome.json` raíz de un worktree ignorado en `.claude/worktrees/global-state-review-760733/`, ajeno al diff. Sin modificar ese residuo se ejecutaron los gates equivalentes: Biome aceptó los archivos afectados, `pnpm test` pasó 718/718 fuera del sandbox y `pnpm check` validó 203 changes; `changeledger check --commits dev` también pasó.
- **2026-07-20T22:18:45Z** `[status]` in-progress → in-review
- **2026-07-20T22:23:04Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-20T22:23:51Z** `[validation]` in-validation → done (human accepted)
- **2026-07-20T22:30:15Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-20T22:30:26Z** `[archive]` archived
