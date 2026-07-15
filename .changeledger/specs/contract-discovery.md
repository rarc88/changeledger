---
title: Discovery del contrato
updated: 2026-07-14T16:08:14Z
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
> Actualizado por el change 20260711-103759 (revisión de contenido `rev:` y verificación `--have`).
> Actualizado por el change 20260711-103803 (bootstrap con delimitadores versionados BEGIN/END).

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

**Vigencia por revisión.** Toda línea BEGIN incluye `rev:<hash>` (12 hex,
derivado del contenido compuesto del modo con la config efectiva, excluyendo el
framing para evitar autorreferencia). La versión del paquete no basta como
prueba de vigencia porque el texto efectivo depende también de la config del
repo. Tras una compactación, un agente que conserve el `rev` de su captura
verifica con `changeledger context [mode] --have <rev>`: coincidencia →
bloque corto framed que confirma `unchanged` con el mismo `rev` (exit 0, sin
cuerpo); discrepancia → la salida completa normal. La primera captura de una
sesión sigue siendo siempre completa y sin filtros; la mejora distingue
"captura perdida" (recapturar) de "captura resumida cuya fuente no cambió".

La regresión contractual se protege en dos niveles: una matriz semántica exige
cada regla, comando, ejemplo y antipatrón en su output propietario y rechaza
packs ajenos; snapshots SHA-256 normalizados de todos los fragmentos hacen
fallar cualquier eliminación silenciosa. Cambiar el contrato exige reclasificar
explícitamente la regla afectada como preservada, reemplazada o retirada antes
de actualizar el snapshot.

## Bootstrap y migración

`init` exige el `AGENTS.md` raíz y añade una caja de alerta delimitada a
`AGENTS.md`. Cuando existe un `CLAUDE.md` regular, el discovery queda satisfecho
por un bloque directo o por el import relativo `@AGENTS.md` recomendado por
Claude Code; `init` y `register` preservan byte a byte ese puente en vez de
duplicar el bootstrap. Solo el `CLAUDE.md` raíz admite esta delegación estrecha:
otros destinos, rutas parciales o imports externos no sustituyen el contrato
canónico, y un bloque directo presente sigue validándose y actualizándose. El bloque vive
entre `<!-- CHANGELEDGER BOOTSTRAP BEGIN v<n> -->` y
`<!-- CHANGELEDGER BOOTSTRAP END -->`, donde `<n>` es la versión del formato del
bootstrap (`BOOTSTRAP_VERSION` en `src/contract.mjs`, independiente de la
versión del paquete): comentarios HTML visibles para agentes que leen el texto
crudo e invisibles en el render. `register` inserta el bloque completo si no
existe, reemplaza solo el interior cuando encuentra BEGIN/END (idempotente,
contenido externo byte a byte intacto), migra el marcador legacy
`<!-- changeledger -->` con su blockquote contiguo al formato delimitado y,
cuando la versión del marcador es anterior a la vigente, actualiza el bloque
informando de la desactualización. Si la versión es vigente, el contenido
administrado se compara mediante una proyección del árbol Markdown producido
por `marked`: debe existir un único `blockquote`, se ignoran sólo el padding
exterior y los campos de representación, y los saltos blandos de texto se
normalizan sin exigir que cada línea física lleve `>`. Por tanto, reflujo,
continuaciones lazy de CommonMark y marcadores equivalentes como `**strong**` y
`__strong__` se preservan byte a byte sin aviso. La proyección conserva tipos de
token, anidamiento, orden y valores significativos —incluido código inline— y
falla cerrado ante tokens no modelados, contenido fuera del blockquote,
cambios de párrafo o delimitadores ausentes, duplicados, desordenados o unidos
a texto. Cualquier diferencia semántica restaura el bloque canónico. El
bootstrap mantiene un único punto de entrada:
`changeledger context`. Ordena ejecutarlo directamente nada más leer el archivo
—antes de planificar, investigar o actuar— y conservar stdout completo desde esa
primera ejecución hasta la línea `CHANGELEDGER CONTEXT END`, sin previews ni
límites voluntarios. La completitud se verifica por centinela: toda
salida de `context` abre con `===== CHANGELEDGER CONTEXT BEGIN — mode: <mode>
[— change: #<id>] — v<version> — rev:<hash> =====` y cierra con una línea END
autodetectora;
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

`changeledger check` exige el bootstrap vigente, no sólo el marker. Acepta la
misma equivalencia semántica por árbol Markdown que `register`; una referencia
ausente, semánticamente distinta, estructuralmente inválida, con versión
obsoleta o que aún apunte al artefacto legacy es un error de discovery.
