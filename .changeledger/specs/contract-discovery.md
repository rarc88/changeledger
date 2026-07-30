---
title: Discovery del contrato
updated: 2026-07-30T12:09:19Z
tags: [ contract ]
graduated_from: ["20260614-151759", "20260616-162027", "20260626-174204", "20260627-103625", "20260627-205033", "20260629-155349", "20260629-165838", "20260629-210543", "20260629-234939", "20260630-225213", "20260701-213931", "20260701-230608", "20260703-150229", "20260704-144327", "20260710-102907", "20260711-103759", "20260711-103803", "20260714-150300", "20260714-153633", "20260715-124113", "20260720-212659", "20260726-141121", "20260726-124833", "20260726-130727", "20260727-110603", "20260726-124834", "20260726-130728", "20260726-124835", "20260727-194233", "20260728-170429", "20260728-195445", "20260728-212043", "20260729-143656", "20260729-162015", "20260730-002908"]
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

La doctrina transversal de delegación (cuándo delegar, dimensionado del
delegado, un dueño por superficie, la definición de `selection of work`) tiene
una sola sede: el core. La regla de sede única rige en las dos direcciones —el
core no duplica al overlay y el overlay amplía o especifica lo puntual de su
etapa sin repetir ni contradecir al core—. `delegation.md` conserva solo lo que
no tiene otra sede: el contrato de campos del prompt, los disparadores por
etapa, la guía de no sobre-fragmentar, y las obligaciones de evidencia del
implementador/corrector; las del revisor viven en `review.md`, servidas al pack
que las consume.

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
trabajo) tiene su presupuesto en la única tabla ejecutable
`templates/contract/budgets.yml`; los tests la cargan directamente y `context` la
lee para publicar el techo que se aplica. Los contextos posteriores amplían el
core y fallan cerrado por instrucción si el agente aún no lo leyó completo.

**Un umbral por dimensión, y todo umbral falla.** Cada entrada declara dos
números planos, `tokens` y `lines`, sin banda de objetivo, sin aviso previo y sin
banderas de régimen. Las dos dimensiones no son redundancia: **los tokens son el
coste** que se paga en cada sesión y otra vez tras cada compactación, y **las
líneas son el transporte**, lo que el `head` del bootstrap tiene que cubrir —por
encima de ese corte, toda captura de todo repo consumidor queda truncada e
inválida—. Nada acota el ancho de línea en markdown, así que contar líneas por sí
solo no acota el coste.

La unidad es **tokens según un tokenizador de referencia fijado**, no los tokens
que consume un modelo concreto: contar por API sería exacto para ese modelo pero
es red, no determinista y no gratuito, así que inservible como puerta. El
tokenizador es una dependencia de desarrollo con versión exacta —una actualización
de BPE movería todos los techos en silencio— y ningún repo consumidor lo instala,
porque el techo de tokens lo aplican los tests del propio ChangeLedger. Los bytes
se retiraron: sobreestiman el whitespace ×6,6, así que un cambio que no añade
contenido podía reventar el techo.

Dos números por dimensión eran precisión falsa: cuando ambos fallan, el segundo
es inalcanzable; cuando el primero solo avisa, no detiene nada, y así fue como el
core rebasó su objetivo sin que ningún gate lo dijera. La medición de líneas es en
**líneas emitidas**, la unidad que ve el consumidor y la que cuenta `head`, no una
convención interna de test. Cada umbral queda fijado en su límite exacto y con el
texto del fallo comprobado, y **ningún techo de tamaño vive fuera del fichero de
presupuestos**: el techo operativo de líneas del core y el del bloque `## Commits`
del core dejaron de ser literales en un test y son entradas declaradas, la segunda
bajo un grupo `blocks`. El techo de líneas del core se compara además contra el
corte que declara el propio bootstrap, así que no puede rebasarlo en silencio.

**El techo de `lines` no se fija a mano: se deriva del de `tokens`.** Es
`tokens ÷ 10` en toda entrada, redondeado hacia abajo. Los tokens son la dimensión
que declara coste y por tanto la única que se decide; las líneas son transporte, así
que su techo sale del anterior y deja de ser un límite editorial que negociar. Un
techo de líneas puesto a mano fue exactamente lo que dejó el core con dos líneas de
margen mientras le sobraban mil cuatrocientos tokens: la unidad se había movido a
tokens y el límite operativo seguía siendo el otro.

De ahí que **el suelo de densidad sea normativo**: si un pack cae por debajo de 10
tokens por línea, es el techo de líneas el que muerde primero, y eso es la señal de
subir el corte a propósito en vez de descubrir un truncamiento en un repo consumidor.

Los techos de tokens son **pocos y decididos**, no uno por pack: el core paga más que
cualquier otro contexto, los demás contextos comparten un mismo valor, y todo lo que
no es un contexto —cápsulas de delegación, overlays de lifecycle, bloques con techo
propio— comparte otro. Desde `20260730-002908` **ningún techo está en andamio** — el
último (spec, 3450 provisional) salió con el refactor del pack de autoría a 2403
medidos bajo su 2500 decidido — y el barrido de forma exige que ninguna entrada
declare la marca `scaffold`. La doctrina para una excepción futura sigue en pie: un
valor que excede su clase se marca en el propio fichero como andamio temporal con su
condición de salida nombrada, y quien lo haga retargetea deliberadamente ese barrido,
que existe para que un techo provisional no vuelva a leerse como decisión tomada.

El techo de las cápsulas de delegación cubre **las dos** clases, los esqueletos de
prompt y las cápsulas de contexto. Cubrir sólo una dejaba un techo que no podía fallar
para la mitad de lo que declaraba acotar.

**Que el contenido de hoy quepa y que el techo siga valiendo lo decidido son dos
preguntas distintas**, y las dos están cerradas. Cada techo declarado está fijado
**por valor** en una sede única: moverlo en cualquier dirección, añadir una entrada
que esa sede no cubra o quitar una que sí cubre hace fallar el gate nombrando la
entrada y la dimensión. Sin eso, subir el número era la forma más fácil de "arreglar"
un fallo de presupuesto, que es precisamente lo que un techo existe para impedir. El
conjunto de entradas se **deriva** del fichero de presupuestos y sólo los valores
esperados se enumeran, así que no hay dos censos que puedan discrepar.

El recuento de **líneas emitidas** tiene exactamente una implementación, y vive en el
módulo de producción que publica la cifra; el soporte de test la reexporta en vez de
copiarla, de modo que una copia conductualmente idéntica sigue siendo un defecto
detectable. La semántica es que el último segmento cuenta salvo que esté vacío: un
texto sin salto de línea final termina igualmente en una línea real.

**Un techo no es un objetivo.** Ninguna prosa normativa se retira para caber en
un presupuesto: una regla sale de un fragmento sólo cuando su nueva sede está
nombrada y un grep de la obligación misma —no de palabras parecidas— la encuentra
allí. Si el contenido correcto no cabe, el trabajo se detiene y decide el humano.
Nació de una retirada real: un objetivo estricto empujó a borrar tres reglas, una
de ellas sin dueño en ningún otro fragmento.

La propiedad de la captura está repartida. El bootstrap posee la primera: ordena
un comando exacto y acotado, y declara la captura válida sólo si su última línea
contiene END. Esa condición positiva sustituyó a la prohibición previa de pedir
previews, resúmenes o límites voluntarios de líneas, bytes o tokens — una
negación que el consumidor no podía verificar y que se incumplía en la práctica.
Si falta END, se repite con la capacidad que la propia línea BEGIN publica. El
core posee el resto: toda captura de contexto se lee completa en una pasada
—core, modo y change id por igual— y una vista parcial nunca es contexto
operativo válido.

El core está organizado para enrutar antes de cargar. Clasificar la intención de
cada mensaje humano es obligatorio y gratuito; cargar un contexto no lo es.
Nunca se carga uno especulativamente ni se recarga uno que ya se tiene: sólo una
transición real de tarea o lifecycle solicita el modo o change id especializado
que corresponda.

**Sin recuperación por revisión.** La línea BEGIN no lleva ningún segmento de
revisión y no existe forma de preguntar si una captura retenida sigue vigente.
Se intentó con un `rev:<hash>` y un flag `--have`, y se retiró: el único momento
en que habrían servido es justo después de una compactación, que es exactamente
cuando el `rev` retenido se ha perdido con el resto de la captura. Su caso útil
era vacío y solo aportaban superficie de CLI, prosa de contrato y tests. La
regla que sí resuelve el problema no cuesta código: mientras el core completo
siga en la conversación activa no se recarga, y si se perdió, se recaptura
entero.

**Tamaño y ocupación publicados en la propia salida.** La línea BEGIN de toda
composición cierra su descriptor con el tamaño real, contando la propia BEGIN y
la END, en la convención de líneas emitidas: `changeledger context … | wc -l`
devuelve `N`, `head -<N>` conserva la línea END como última y `head -<N-1>` la
pierde. Una composición acotada publica además cuánto ocupa de su techo en las
la dimensión que el consumidor necesita —`lines:<N>/<límite>`—, así que el agente
ve el margen de transporte que le queda sin ejecutar la suite. **No publica
tokens**: la cifra la aplican los tests y publicarla obligaría a todo repo
consumidor a instalar el tokenizador para leer un número que no usa. Un contexto
por change id incrusta un documento de tamaño arbitrario y no está acotado:
publica su conteo solo y no inventa un techo, aunque reutilice los fragmentos de
un modo. Un límite fijo no puede cumplir eso, porque solo el
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

La regresión contractual se protege en tres niveles, ninguno un pin de hash:
una matriz semántica exige cada regla, comando, ejemplo y antipatrón en su
output propietario y rechaza packs ajenos; guards de obligación por grep
comprueban que una frase retirada no reaparece y que cada obligación viva se
encuentra en la sede de su fragmento dueño; y los presupuestos de
`budgets.yml` acotan tokens y líneas de toda composición base. El nivel de
pins SHA-256 sobre los fragmentos —snapshot normalizado por fragmento más la
obligación de reclasificar cada regla afectada como preservada, reemplazada o
retirada antes de actualizar el snapshot— se retiró (decisión de 2026-07-29,
change `20260729-143656`): su comentario de clasificación no lo verificaba
nadie y salió falso sin que nada lo notara, y un hash dice que algo cambió,
nunca qué se perdió. La edición arbitraria de prosa que ese nivel cubría queda
protegida por el review obligatorio que toda edición de fragmento atraviesa
dentro de un change.

**La proyección de equivalencia modela listas.** El árbol que compara dos
bloques de bootstrap incluye `list` y `list_item`, y recursa en los `items`, de
modo que un bloque con bullets puede reconocerse como equivalente sin que el
contenido de la lista se vuelva invisible a la detección de deriva. Ese matiz no
es cosmético: whitelistear el tipo sin recursar compraría la tolerancia al
formateador al precio de un bypass silencioso, y la deriva de cualquier bullet
—texto u orden— pasaría por equivalente. La cobertura se deriva del propio
parseo y recorre todos los bullets, así que una instrucción añadida al bloque
queda protegida sin ampliar los tests. Sigue fallando cerrado ante lo que no
modela: un `checkbox` de tarea o un `link` dentro de un bullet marcan el bloque
como obsoleto en vez de aceptarse. `ordered` no se modela a propósito, de forma
que convertir todos los bullets a lista numerada se acepta —preserva el texto y
el orden de cada instrucción— mientras una conversión parcial sí se detecta.

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
bootstrap mantiene un único punto de entrada: `changeledger context`.

**El bootstrap manda un comando acotado, no una prohibición.** Desde el formato
v4 no ordena "no recortes la salida" —una negación que el arnés incumple sin que
el agente lo note— sino un comando exacto, `changeledger context 2>&1 |
head -400`, más una **condición de validez positiva**: la captura vale sólo si su
última línea contiene `CHANGELEDGER CONTEXT END`, y nada anterior a esa línea es
accionable. Ese corte **no es un número elegido**: es exactamente el techo de
`lines` del core, y los dos se afirman **por igualdad**, así que ninguno puede
moverse sin el otro. No lleva reserva por encima a propósito — una reserva
implicaría que el `head` informa del tamaño, y la condición de validez es la línea
`END`, no el número. Cuando la salida supera el corte, el reintento no se adivina: la línea
BEGIN publica `lines:<N>` y se re-ejecuta con `head -<N>`. La completitud se
verifica por centinela: toda salida de `context` abre con
`===== CHANGELEDGER CONTEXT BEGIN — mode: <mode> [— change: #<id>] —
v<version> — lines:<N>[/<límite>] =====` y cierra con una
línea END autodetectora. El
bloque distingue dos fallos que antes se mezclaban: comando no instalado
(`command not found`) significa que ChangeLedger está ausente y el trabajo sigue
con normalidad sin emularlo; comando presente que falla por cualquier otra causa
detiene el trabajo, presenta el error capturado al humano y espera su decisión en
vez de degradar en silencio. Y ordena re-ejecutarlo como primera acción de la
primera respuesta tras cualquier compactación, sin depender de ningún estado
retenido.

La regla general de captura completa del núcleo (§ arriba) no la deroga esto: lo
que el bootstrap prescribe es un comando acotado y verificable, no la libertad
del consumidor para elegir su propio recorte. El bootstrap no contiene reglas de lifecycle,
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
