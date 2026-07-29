---
title: Trazabilidad git
updated: 2026-07-29T13:36:24Z
tags: [ git ]
graduated_from: ["20260617-161309", "20260711-103757", "20260711-204419", "20260711-210115", "20260711-225637", "20260711-225638", "20260726-131603", "20260726-141124", "20260726-124837", "20260727-194234", "20260728-151336", "20260728-164620", "20260729-111349"]
---

## Trazabilidad git

`git.mjs` (`gitRefs`, runner inyectable) enlaza un change con git por la
convención de commit `[#<id>]`: lista los commits que lo referencian y las
branches cuyo nombre lo contiene; tolera repos no-git devolviendo vacío. El
endpoint `GET /api/git?project=&id=` los sirve y el detalle muestra la sección
**Git**. El lookup de PR (red/`gh`) queda fuera del visor local.

**Contrato de commits ejecutable.** `changeledger commit -m "<subject>"
[--id <id>...]` deja un único `[#id]` al final del subject. Con varios ids
mantiene el subject limpio y escribe una línea canónica en el cuerpo:
`ChangeLedger: [#A] [#B]`. Resuelve el único change `in-progress` cuando se
omite `--id` y valida la forma conventional-commit antes de delegar en Git.

**Guard del índice staged.** Antes de invocar Git, `commit` imprime el conjunto
staged y lo valida con una **lista blanca exacta**: calcula la ruta esperada del
documento de cada id declarado y aborta si alguna ruta staged bajo el directorio
de changes no es byte-idéntica a una esperada, nombrándola. Así un hook fallido
—que deja el índice staged— no puede hacer que el commit siguiente absorba
documentos de otros changes. No clasifica rutas: la normalización se aplica solo
a las cadenas que la herramienta deriva (cruda, NFC y NFD de cada ruta esperada y
del prefijo de frontera), nunca a la entrada de Git. Las rutas fuera del
directorio de changes no se juzgan, porque el código acompaña legítimamente a un
change; la única exención dentro es el basename exacto `.gitkeep`. La lectura del
índice usa una invocación con todos sus ejes fijados —`-c core.quotePath=false
diff --cached -z --no-renames --no-relative --ignore-submodules=none
--name-only`, con el top-level de Git como cwd y partiendo por NUL— porque la
salida por defecto de `git diff` es superficie de presentación que la
configuración del repo altera; exige Git ≥ 2.28 y cualquier fallo de lectura
aborta. Residuales declarados: una grafía del directorio con mayúsculas distintas
solo alcanzable sin `git add` (`git mv` tecleado, `apply --index`, historia
mergeada), y el borrado o renombrado manual de un documento de change, que
ningún comando del lifecycle realiza.

`changeledger check --commits [base]` acepta exclusivamente esas dos formas y
reporta la causa concreta de marcadores ausentes, ambiguos o mal formados;
exime merges, `chore(release)` y el **commit operativo declarado**.

El commit operativo es la forma legal de commitear trabajo que ningún change
cubre: su body es exactamente `ChangeLedger: none — <razón>` con razón no vacía.
La exención sólo se activa con esa declaración positiva, nunca por omisión —
olvidar el marcador sigue fallando— y la razón es obligatoria porque un commit sin
documento de change no tiene otro sitio donde registrar su porqué. `ChangeLedger:
none` sin razón es error propio; la declaración no convive con ningún marcador en
el subject. `changeledger commit -m "<subject>" --no-change "<razón>"` la compone y
es mutuamente excluyente con `--id`, ignorando la resolución del change en curso:
una declaración explícita no puede depender del estado ambiente del repositorio.

`gitRefs()` busca en el mensaje completo y presenta el subject limpio. **Residual
declarado**: por eso un id citado dentro de la razón de un commit operativo queda
atribuido a ese change, aunque el commit declare que ninguno lo cubre; la regla de
no coexistencia sólo inspecciona el subject. Cerrarlo exige decidir si las razones
pueden citar ids. El runner de `git.mjs` sanea
`GIT_DIR`/`GIT_WORK_TREE` del entorno heredado para que hooks anidados no
redirijan comandos git al repo equivocado. `git.mjs` distingue dos perfiles de
ejecución: las consultas tolerantes (`defaultRun`) degradan en silencio a vacío,
mientras el camino mutador de `changeledger commit` usa `mutatingRun`, que
captura stderr/stdout de git y los incluye en el error lanzado — un commit
fallido (hook, nada staged, identidad ausente) siempre expone su diagnóstico en
vez de un exit 1 opaco. Ese diagnóstico lo consume un agente que clasifica el
fallo por su texto, así que el runner fija `LC_ALL=C` en el entorno de todo
subproceso git: el idioma del mensaje no depende del locale del host.

La clave opcional `git.integration_branch` declara la base y el destino de las
ramas de change. Cuando existe, `check --commits` la usa como base por defecto
(una base posicional explícita conserva precedencia) y `changeledger context`
la publica como `integration_branch=<rama>` en la política efectiva. Cuando no
existe, se conserva la autodetección de base mediante `origin/HEAD`, `main` o
`master`.

El schema 3 distribuye esta capacidad a configuraciones existentes y repos
nuevos. La migración v2 → v3 y la plantilla crean un bloque Git separado y
documentado con `integration_branch:` vacío, que conserva la autodetección. El
formulario estructurado del viewer permite declarar, cambiar o vaciar la rama;
al eliminarla preserva las demás claves bajo `git`. Preview y aplicación usan el
mismo motor de migración.

El contrato canónico protege esa trazabilidad con un workflow git explícito:
los agentes no implementan changes aprobados en `main`, `master` ni `dev`;
revisan el worktree antes de empezar; commitean la documentación aprobada antes
de tocar código; e implementan un change a la vez. Los cambios no relacionados no
se incluyen silenciosamente.

**La unidad de commit es la selección de trabajo resuelta.** Una rama de
change lleva **cinco** clases y ninguna más: **Draft**, uno por documento
redactado y commiteado en solitario; **Baseline**, exactamente uno con el
documento aprobado antes de cualquier código; **Implementation**, uno por
selección de trabajo resuelta —su código, sus tests, sus casillas y su Log—
creado cuando el gate local pasa, y que se commitea al resolverse, sin esperar a
las demás, así que el número de commits de implementación por change no se fija;
**Correction**, cero o más, cada una sin commitear hasta que un revisor fresco la
confirma; y **Handoff**, obligatoria siempre que el trabajo se detiene en
`blocked` o una sesión termina con estado sin commitear, registrando por qué fue
necesario.

Toda selección queda commiteada **antes** de delegar el review, de modo que
`baseline..HEAD` está cerrado en el instante de delegar: el revisor inspecciona
un rango fijo y el entregable no puede cambiar entre su informe y la historia. La
garantía es de secuencia, no de conteo, así que sobrevive intacta con N commits.

La granularidad se decide con una prueba: si la unidad se revertirá,
referenciará o implementará de forma independiente. Una transición de lifecycle
no lo es —el Log ya la registra— y **nunca es un commit propio**: viaja dentro
de la siguiente clase real. Un documento de change sí lo es. Una **selección de
trabajo resuelta** también: se revierte sola, y mejor que el change entero. Una
tarea del Plan aislada **no**: por sí sola se revierte, se referencia y se
implementa con el resto de su selección. Así, un change produce un commit por
selección resuelta, uno más por corrección confirmada y uno por handoff.

Tres formulaciones anteriores quedaron retiradas por invitar cada una a su propio
exceso: pedir commitear "cuando la atribución pudiera volverse ambigua" era un
juicio cuya respuesta segura es siempre sí; contar `n + 1` commits por `n`
tareas completadas multiplicaba el coste de delegación por el número de tareas,
porque el delegado no toca git y separar la unidad exigía reescribir el documento
dos veces; y fijar el número de commits de implementación por change —"exactamente
uno con el trabajo completo"— deformaba una decisión sobre delegación en una regla
de conteo, y prohibía el corte que la propia prueba de granularidad admite.

Un commit combinado es legítimo solo cuando separar es imposible: varios changes
comparten los mismos archivos. Las tareas del Plan **nunca** son razón, porque
separarlas siempre es posible: cada selección resuelta se commitea sola. Se
registra en el Log qué se combinó y por qué, nombrando cada change que comparte
la superficie.

**Sede única.** Todo este comportamiento —las clases, el discriminante, la
fórmula, la forma del subject, el body multi-change, las excepciones, el
compositor, el linter previo a review y la inspección del índice staged— vive en
un solo bloque del contexto core, no repartido entre overlays de etapa.
Commitear ocurre en todas las fases, así que su comportamiento es común a
cualquiera y una regla escrita en cuatro sedes son cuatro versiones que pueden
divergir sin que nada las compare.

Los overlays de etapa conservan solo lo que es comportamiento de su fase y no la
unidad de commit: `review` gobierna qué ocurre con una corrección sin commitear
según el veredicto, `validation` remite al commit final del cierre y aísla las
correcciones no confirmadas tras un rechazo, y `close` define qué contiene ese
commit de cierre y cuándo la graduación o el skip son por sí mismos la evidencia.
Un puntero de un overlay hacia contenido de otro fragmento se retira cuando su
destino se mueve: al consolidar, el que remitía al checkpoint del contrato de
implementación quedó apuntando a una sección vacía.

Cuando se declara una rama de integración, las ramas de change parten de ella y
el resultado se integra de vuelta en ella; `main` queda reservado para releases.

Una corrección candidata nacida de un `review fail --retry` queda sin commit y
aislada hasta que otro revisor de contexto limpio la confirme. Tras el `pass`, se
commitea con la verdad relacionada antes de solicitar validación humana. Una
corrección nacida de un rechazo humano permanece sin commit hasta la aceptación
final. Los intentos fallidos iteran sobre el mismo diff y no se empieza otra
tarea/change durante la espera; tras aceptación, se gradúa o salta graduación y
se commitean juntos la corrección validada y su verdad relacionada.
