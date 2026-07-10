---
title: Discovery del contrato
updated: 2026-07-10T20:19:47Z
tags: [ contract ]
---

## Discovery del contrato

> Graduado del change 20260614-151759 (discovery del contrato).
> Graduado del change 20260616-162027 (registry corrupto falla sin sobrescribir).
> Graduado del change 20260626-174204 (ruta rápida del contrato para agentes).
> Graduado del change 20260627-103625 (discovery distingue estado global de raíz de proyecto).
> Graduado del change 20260627-205033 (contexto dinámico y retiro del symlink).
> Graduado del change 20260629-155349 (lectura completa del contexto y bootstrap mínimo).
> Graduado del change 20260629-165838 (prohibición de contexto truncado).
> Graduado del change 20260629-210543 (contextos específicos incrementales).
> Graduado del change 20260629-234939 (paridad operativa del contrato dinámico).
> Graduado del change 20260630-225213 (política efectiva, dependencias resueltas y packs por audiencia).
> Graduado del change 20260701-213931 (trigger inmediato del bootstrap y delimitadores BEGIN/END).
> Graduado del change 20260701-230608 (los resúmenes del core se leen como mínimos, nunca como listas exhaustivas).
> Actualizado por el change 20260703-150229 (adquisición completa en una sola pasada y recarga sólo por transición real).

El contrato canónico es un artefacto de la herramienta, separado del contrato
propio de cada repo. Vive como fragmentos normativos únicos en
`templates/contract/`: `core.md`, packs de tarea (`spec`, `implement`, `review`,
`release`), fragmentos compartidos (`readiness`, `delegation`, `handoff`) y
overlays de lifecycle (`blocked`, `validation`, `close`, `discarded`). No existe
un monolito paralelo que pueda divergir.

El contexto dinámico reduce carga seleccionando el detalle que necesita la
etapa, no recortando precisión operativa. Conserva comandos y ejemplos
canónicos, antipatrones del parser, razones que evitan decisiones erróneas y
reglas de ownership/integración. Una regla transversal puede tener un resumen
en `core` y una única elaboración normativa compartida, sin crear fuentes
competidoras; el resumen debe leerse como mínimo con puntero al pack propietario
("at least ..."), nunca como lista exhaustiva ni como regla absoluta que
contradiga la excepción que el pack define.

`changeledger context` los compone de forma determinista:

- sin argumento entrega sólo el núcleo no negociable;
- con modo explícito entrega una advertencia incremental breve y sólo el pack
  especializado, sin repetir el núcleo ya leído;
- con change id entrega la misma advertencia, infiere el pack u overlay desde el
  status y añade el change completo, incluidos criterios, tareas y Log;
- no intenta adivinar specs relacionadas: conserva los enlaces explícitos del
  change, sin heurística ni IA.

La composición especializada es explícita:

- `spec`: autoría + delegación + readiness;
- `implement`: implementación + delegación + handoff (la regla TDD efectiva
  llega por la cabecera de política; el detalle de autoría/readiness pertenece
  a `spec`);
- `review`: revisión independiente + handoff (el reviewer es hoja: no recibe la
  guía general de delegación);
- `blocked`: resolución del bloqueo + handoff;
- `release`, `validation`, `close` y `discarded`: su pack u overlay propio.

La delegación portable separa el contrato del orquestador del de sus hojas:
`changeledger agent-prompt <role>` entrega un esqueleto para investigación,
implementación o review, y el delegado identificado carga únicamente
`changeledger agent-context <role> [change-id]`. Las cápsulas delimitan su
responsabilidad y autoridad; investigation y review son de solo lectura y no
reciben comandos de lifecycle.

Cada composición de modo o id incluye una cabecera determinista **Effective
policy** derivada de `.changeledger/config.yml` con defaults resueltos (idioma,
`tdd`; en modo por id además `review_required` y stages del tipo), de modo que
el agente no lee el config crudo. El core lleva la línea transversal mínima. En
modo por id, cada dependencia local de `depends_on` se resume como
`#id — título — status` sin incorporar su cuerpo; las referencias externas se
conservan como referencias sin resolución local.

Toda composición base (sin el change seleccionado, cuya longitud pertenece al
trabajo) tiene objetivos y límites duros en la única tabla ejecutable
`templates/contract/budgets.yml`; los tests la cargan directamente. Los
contextos posteriores amplían el core y fallan cerrado por instrucción si el
agente aún no lo leyó completo.

Cada invocación se captura completa desde el primer intento. El consumidor no
solicita previews, resúmenes ni límites voluntarios de líneas, bytes o tokens y,
cuando su herramienta expone un presupuesto de salida, reserva capacidad para
la respuesta entera. Una vista parcial nunca es contexto operativo válido. La
ausencia de END después de esa captura deliberadamente completa es recuperación
excepcional: se detiene el trabajo y se repite con mayor capacidad.

Mientras el core completo siga disponible en la conversación activa, un nuevo
mensaje humano por sí solo no provoca otra carga. Sólo una transición real de
tarea o lifecycle solicita el modo o change id especializado que corresponda.

La regresión contractual se protege en dos niveles: una matriz semántica exige
cada regla, comando, ejemplo y antipatrón en su output propietario y rechaza
packs ajenos; snapshots SHA-256 normalizados de todos los fragmentos hacen
fallar cualquier eliminación silenciosa. Cambiar el contrato exige reclasificar
explícitamente la regla afectada como preservada, reemplazada o retirada antes
de actualizar el snapshot.

## Bootstrap y migración

`init` exige el `AGENTS.md` raíz y añade una caja de alerta con marcador
`<!-- changeledger -->` a `AGENTS.md` y, cuando existe como archivo regular,
`CLAUDE.md`. El bootstrap mantiene un único punto de entrada:
`changeledger context`. Ordena ejecutarlo directamente nada más leer el archivo
—antes de planificar, investigar o actuar— y conservar stdout completo desde esa
primera ejecución hasta la línea `CHANGELEDGER CONTEXT END`, sin previews ni
límites voluntarios. La completitud se verifica por centinela: toda
salida de `context` abre con `===== CHANGELEDGER CONTEXT BEGIN — mode: <mode>
[— change: #<id>] — v<version> =====` y cierra con una línea END autodetectora;
si falta pese a la captura completa, la salida llegó truncada y hay que detenerse
y re-ejecutar con mayor capacidad como recuperación excepcional.
Falla cerrado si el CLI no está disponible. El bloque incluye además la regla
dura —no crear ni modificar archivos sin change autorizado— con un puntero al
core como única fuente del workflow, los task contexts y la excepción
operacional; no enumera modos (eso invitaría a saltarse el contexto base). No
crea `.changeledger/AGENTS.md`, no necesita permisos de symlink y no añade
entradas a `.gitignore`.

Ejecutar `changeledger context` no basta por sí solo para cumplir el contrato. El
agente debe leer la salida completa y seguir el modo actual. Si no existe un
change `approved` o `in-progress` aplicable, el agente no edita archivos del
repo en silencio: crea o actualiza un change, o pregunta al humano si una edición
puramente operativa, reversible y sin cambio de verdad persistente ni
comportamiento observable debe hacerse directo. En caso de duda, se documenta en
ChangeLedger.

`register` actualiza el bloque administrado y migra repos antiguos. Elimina un
symlink legacy; una copia regular sólo se elimina cuando su SHA-256 coincide
byte a byte con una versión histórica conocida del contrato. Un archivo
desconocido se preserva y la migración falla con un mensaje accionable. De
`.gitignore` sólo se retira la línea literal `.changeledger/AGENTS.md`.

`changeledger check` exige el bootstrap vigente, no sólo el marker: una referencia
ausente o que aún apunte al artefacto legacy es un error de discovery.
