---
id: "20260720-212659"
title: Hacer opcional la carga de ChangeLedger desde el bootstrap
type: feature
status: in-progress
created: 2026-07-20T21:26:59Z
depends_on: []
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
Repetir roles, sintaxis y un segundo centinela en el bootstrap filtra detalle de
delegación a todos los consumidores. No puede eliminarse toda excepción porque
una hoja delegada también lee `AGENTS.md`: basta una autorización genérica para
que un prompt de delegación ChangeLedger pueda prescribir otro punto de entrada.

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
- cuando la carga tenga éxito, exigir stdout completo hasta el centinela END,
  sin pipes, filtros, resúmenes, previews ni límites voluntarios;
- conservar `changeledger context [mode] --have <rev>` para comprobar vigencia
  tras compactación y recargar completamente si se perdió el contexto o su rev;
- permitir, en una sola frase genérica, que un prompt de delegación ChangeLedger
  indique un punto de entrada diferente;
- ordenar que toda divergencia observada entre specs y código se reporte al
  humano sin reconciliación inferida. Si afecta a la tarea actual, el agente
  espera la decisión; si es ajena, la reporta sin ampliar el alcance.

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
- **Then** no enumera roles, sintaxis de `agent-context` ni el centinela `CHANGELEDGER AGENT CONTEXT END`
- **And** permite genéricamente que un prompt de delegación ChangeLedger prescriba otro punto de entrada

### CR6 — Las divergencias quedan en manos humanas
- **Given** un agente que observa que una spec y el código describen comportamientos incompatibles
- **When** la divergencia afecta a su tarea o aparece durante su investigación
- **Then** la notifica al humano sin modificar spec o código solo para reconciliarlos
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

- [ ] Escribir primero tests semánticos del bootstrap opcional y actualizar `src/contract.mjs`; verify: `node --test test/contract.test.mjs test/register.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR7, CR8)
- [ ] Escribir primero la cobertura de la notificación de divergencias y ajustar `templates/contract/core.md` sin duplicar lifecycle; verify: `node --test test/context.test.mjs` (CR6, CR7)
- [ ] Actualizar `README.md` con el modelo de adopción opcional y la distinción entre ausencia, error, truncación y divergencia (support)
- [ ] Re-registrar el bootstrap del propio repositorio después de cubrir su migración en la primera tarea (support)
- [ ] Ejecutar `pnpm verify` tras completar la implementación (support)

## Log

- **2026-07-20T21:26:59Z** `[note]` Draft creado tras autorización humana explícita; el alcance se limita al bootstrap opcional, la preservación anti-truncado/compactación y el reporte humano de divergencias.
- **2026-07-20T21:40:08Z** `[status]` draft → approved
- **2026-07-20T21:41:08Z** `[status]` approved → in-progress
- **2026-07-20T21:41:08Z** `[owner]` set: Roberto Ruiz (auto)
