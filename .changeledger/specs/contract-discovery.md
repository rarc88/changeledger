---
title: Discovery del contrato
updated: 2026-07-27T10:59:46Z
tags: [ contract ]
graduated_from: ["20260614-151759", "20260616-162027", "20260626-174204", "20260627-103625", "20260627-205033", "20260629-155349", "20260629-165838", "20260629-210543", "20260629-234939", "20260630-225213", "20260701-213931", "20260701-230608", "20260703-150229", "20260704-144327", "20260710-102907", "20260711-103759", "20260711-103803", "20260714-150300", "20260714-153633", "20260715-124113", "20260720-212659", "20260726-141121", "20260726-124833", "20260726-130727"]
---

## Discovery del contrato

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

El status elige el pack, pero **el tipo puede retirar un fragmento** que su
configuración vuelve inaplicable. `readiness` es hoy el único condicionado así:
su contenido presupone `## Specification` y `## Plan`, de modo que un tipo sin
`specification` activa recibía reglas que su documento no puede satisfacer y que
`check` después rechaza — la cabecera de política y el cuerpo compuesto se
contradecían dentro de la misma captura. La condición se deriva de las stages
activas del tipo en `config.yml`, nunca de una lista de nombres de tipo: la
lista envejece en cuanto la configuración cambia. `spec` y `delegation` siguen
componiéndose para todos los tipos, y la invocación de modo desnudo no resuelve
ningún tipo, así que el filtro no la alcanza.

La delegación portable separa el contrato del orquestador del de sus hojas:
`changeledger agent-prompt <role>` entrega un esqueleto para investigación,
implementación o review, y el delegado identificado carga únicamente
`changeledger agent-context <role> [change-id]`. Las cápsulas delimitan su
responsabilidad y autoridad; investigation y review son de solo lectura y no
reciben comandos de lifecycle. Cada esqueleto declara que su `agent-context`
reemplaza la carga predeterminada del bootstrap para esa tarea delegada; el
bootstrap general no expone roles ni detalles de delegación.

Cada composición de modo o id incluye una cabecera determinista **Effective
policy** derivada de `.changeledger/config.yml` con defaults resueltos (idioma,
`tdd`; en modo por id además `review_required` y stages del tipo), de modo que
el agente no lee el config crudo. El core lleva la línea transversal mínima. En
modo por id, cada dependencia local de `depends_on` se resume como
`#id — título — status` sin incorporar su cuerpo; las referencias externas se
conservan como referencias sin resolución local. `related_to` se presenta en
una sección separada, distingue enlaces salientes de backlinks entrantes y
resuelve título y estado locales sin convertir la relación en dependencia.

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

**Sin recuperación por revisión.** La línea BEGIN no lleva ningún segmento de
revisión y no existe forma de preguntar si una captura retenida sigue vigente.
Se intentó con un `rev:<hash>` y un flag `--have`, y se retiró: el único momento
en que habrían servido es justo después de una compactación, que es exactamente
cuando el `rev` retenido se ha perdido con el resto de la captura. Su caso útil
era vacío y solo aportaban superficie de CLI, prosa de contrato y tests. La
regla que sí resuelve el problema no cuesta código: mientras el core completo
siga en la conversación activa no se recarga, y si se perdió, se recaptura
entero.

**Tamaño publicado en la propia salida.** La línea BEGIN de toda composición
—core, modo y change id— cierra su descriptor con `lines:<N>`, el número exacto
de líneas que el comando emite, contando la propia BEGIN y la END. Es el
conteo real de la salida, no el de una convención interna: `changeledger
context … | wc -l` devuelve `N`, `head -<N>` conserva la línea END como última
y `head -<N-1>` la pierde. Un límite fijo no puede cumplir eso, porque solo el
core está acotado por `budgets.yml`; los packs de modo varían y el contexto por
change id incrusta el documento completo, sin cota. Publicar el número deja
construir un `head` determinista para cualquier contexto sin conocer su tamaño
de antemano, y el consumidor canónico lo usa con el `N` exacto, así que lee
hasta EOF y nunca trunca.

El valor se calcula en un único paso posterior a la composición del cuerpo, sin
iteración de punto fijo: el número de dígitos de `N` solo añade caracteres
dentro de la línea BEGIN y jamás cambia el recuento de líneas, de modo que
inyectarlo no invalida la medida. El cruce de 999 a 1000 líneas está fijado por
tests, y el propio `lines:<N>` no crea escenario de pipe cerrado: el consumidor
que pasa el `N` exacto agota la salida.

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
bootstrap mantiene un único punto de entrada: `changeledger context`. Ordena
intentarlo directamente nada más leer el archivo —antes de planificar,
investigar o actuar— y conservar stdout completo desde esa primera ejecución
hasta la línea `CHANGELEDGER CONTEXT END`, sin pipes, filtros, previews,
resúmenes ni límites voluntarios. La completitud se verifica por centinela:
toda salida de `context` abre con `===== CHANGELEDGER CONTEXT BEGIN — mode:
<mode> [— change: #<id>] — v<version> — lines:<N> =====` y cierra con una
línea END autodetectora; si falta pese a la captura completa, la salida llegó
truncada y hay que detenerse y re-ejecutar con mayor capacidad como
recuperación excepcional. Si el entorno informa que el comando no existe, el
agente continúa normalmente sin ChangeLedger; si el ejecutable comienza pero
falla, presenta el error al humano y espera su decisión en vez de degradar
silenciosamente. El bootstrap no contiene reglas de lifecycle,
delegación ni reconciliación de divergencias: esas políticas pertenecen al
contexto que se carga cuando el CLI está disponible. No crea
`.changeledger/AGENTS.md`, no necesita permisos de symlink y no añade entradas a
`.gitignore`.

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
