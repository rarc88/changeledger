---
title: Trazabilidad git
updated: 2026-10-12T19:16:43Z
tags: [ git ]
graduated_from: ["20260617-161309", "20260711-103757", "20260711-204419", "20260711-210115", "20260711-225637", "20260711-225638", "20260726-131603", "20260726-141124", "20260726-124837", "20260727-194234", "20260728-151336", "20260728-164620", "20260729-111349", "20260729-162616", "20260730-002341", "20260730-220545", "20260731-161654", "20260731-161655", "20261002-181346", "20261002-181428", "20261002-204623", "20261012-174310", "20261012-174407"]
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
aborta. La frontera de `changes_dir` se deriva con `rev-parse --show-prefix`
anclado al `--absolute-git-dir` y `--work-tree` del mismo top-level exterior
que suministró ese índice; un repo Git anidado —también detrás de un symlink
interno— no puede cambiar las coordenadas del guard. El juicio de alcance
pliega mayúsculas (un path del directorio con
casing distinto, alcanzable solo sin `git add` —`update-index`, historia
mergeada—, se juzga como el canónico), pero el whitelist de declarados es
exacto: plegarlo aceptaría el gemelo mal-caseado de un documento declarado en
filesystems case-sensitive. Un `changes_dir` que resuelve a la raíz del repo
aborta nombrando el colapso en vez de dejar el guard mudo. Residual declarado:
el borrado o renombrado manual de un documento de change, que ningún comando
del lifecycle realiza.

`changeledger check --commits [base]` acepta exclusivamente esas dos formas y
reporta la causa concreta de marcadores ausentes, ambiguos o mal formados;
exime merges, `chore(release)` y el **commit operativo declarado**.

El commit operativo es la forma legal de commitear trabajo que ningún change
cubre: la primera línea de su body es `ChangeLedger: none — <razón>` con razón
no vacía, y las líneas posteriores son texto libre — párrafo de porqué,
trailers. Una declaración enterrada tras otra línea, o cualquier línea
posterior que empiece por `ChangeLedger:`, siguen siendo
`malformed ChangeLedger body`: la cola libre no abre rutas a la exención.
La exención sólo se activa con esa declaración positiva, nunca por omisión —
olvidar el marcador sigue fallando— y la razón es obligatoria porque un commit sin
documento de change no tiene otro sitio donde registrar su porqué. `ChangeLedger:
none` sin razón es error propio; la declaración no convive con ningún marcador en
el subject. `changeledger commit -m "<subject>" --no-change "<razón>"` la compone y
es mutuamente excluyente con `--id`, ignorando la resolución del change en curso:
una declaración explícita no puede depender del estado ambiente del repositorio.

`gitRefs()` atribuye un commit a un change únicamente por sus dos sedes de
declaración — el marcador que cierra el subject y la línea canónica
`ChangeLedger: [#A] [#B]` en cabeza del body — y presenta el subject limpio.
Un id citado en texto libre (la razón de un commit operativo, una nota de
prosa, la cola bajo la declaración) es prosa y no atribuye: las razones pueden
citar ids por decisión humana (2026-07-30), y el residual que aquí vivía quedó
cerrado por `20260730-002341`. El runner de `git.mjs` sanea
`GIT_DIR`/`GIT_WORK_TREE` del entorno heredado para que hooks anidados no
redirijan comandos git al repo equivocado. `git.mjs` distingue dos perfiles de
ejecución: las consultas tolerantes (`defaultRun`) degradan en silencio a vacío,
mientras el camino mutador de `changeledger commit` usa `mutatingRun`, que
captura stderr/stdout de git y los incluye en el error lanzado — un commit
fallido (hook, nada staged, identidad ausente) siempre expone su diagnóstico en
vez de un exit 1 opaco. Ese diagnóstico lo consume un agente que clasifica el
fallo por su texto, así que el runner fija `LC_ALL=C` en el entorno de todo
subproceso git: el idioma del mensaje no depende del locale del host.

La clave opcional `git.integration_branch` declara la rama de integración del
repositorio y `git.release_branch`, también opcional, su rama de release o de
producción. `types.<tipo>.integrates_into` elige por su papel la base y el
destino de las ramas de change de ese tipo: `integration` (el defecto, también
cuando la clave falta) o `release`. `changeIntegrationBranch(config, type)`
(`src/config.mjs`) resuelve esa rama de integración del change:
`git.release_branch` para un tipo `release` y `git.integration_branch` para el
rol `integration` o un rol ausente, incluida la llamada sin tipo. Un rol
inválido hace que el resolutor lance el mismo mensaje que reporta `check`. Un
tipo `release` sin `git.release_branch` declarada nunca cae a la rama de
integración del repo: lanza
`type "<t>" integrates into git.release_branch, which is not declared`.

`changeledger context <id>` y `changeledger agent-context <role> <id>` publican
la rama de integración del change como `integration_branch=<rama>` en la
política efectiva (`transversalPolicy` con el tipo, `src/commands/context.mjs`);
el core, los modos y `agent-context` sin change publican `git.integration_branch`.
La línea omite la clave cuando la rama resuelta no está declarada, y un tipo
`release` sin `git.release_branch` hace fallar esas capturas con el mismo error
en vez de publicar la rama del repo. Cuando la rama de integración del change
difiere de una `git.integration_branch` declarada, la línea añade justo después
`back_merge_branch=<git.integration_branch>`, la rama a la que también se lleva
el resultado integrado; sin `git.integration_branch` declarada no se publica
aunque la rama autodetectada difiera, y el core, los modos y `agent-context` sin
change nunca la publican. Toda composición —core, modos, id y todos los roles de
`agent-context`— publica además, tras `language=` y `tdd=` (si se publica) y
antes de `integration_branch=`, `release_types=<tipos>` (`releaseTypes`): los
tipos con `integrates_into: release`, separados por comas en el orden en que
JavaScript enumera las claves de `config.types` (primero los nombres con forma de
entero, después el orden de inserción), sólo mientras `git.release_branch` está
declarada y algún tipo se integra en ella, el único estado en que `context <id>`
y `agent-context` cargan un change de esos tipos. `releaseTypes` sólo lee
`git.release_branch` cuando algún tipo se integra en ella: entonces un valor mal
formado (`release_branch: ""`) lanza
`config "git.release_branch" must be a non-empty string` y hace fallar toda
composición, incluido el core del bootstrap; sin tipos de release no la lee.
Sin base posicional, `check --commits` (`defaultCommitsBase`,
`src/commands/check.mjs`) usa la rama de integración del change de la rama
checked out: casa los changes que no están `done` ni `discarded` cuya `branch`
registrada es esa rama o, sin `branch`, cuya `renderChangeBranch` la produce, y
toma su `changeIntegrationBranch` (la autodetección de abajo si esa rama no
está declarada). Si casan varios con bases distintas falla con
`branch "<rama>" is recorded by changes #A (integrates into X) and #B
(integrates into Y); pass <base> explicitly`; si casan varios con la misma base,
la usa. Un error al cargar el ledger o al resolver la rama del change (por
ejemplo, un tipo `release` sin `git.release_branch`) se reporta como
`error  (commits): <mensaje>` en vez de caer a otra base. Sólo lee el ledger
cuando algún tipo declara `integrates_into: release`; sin tipos así, con HEAD
desacoplado o sin change que case, usa `git.integration_branch` y, si no existe, la autodetección mediante
`origin/HEAD`, `main` o `master`. Una base posicional explícita conserva
precedencia y nunca lee el ledger.

`changeledger check` valida el mismo contrato que los consumidores Git: `git`
debe ser un mapping —un `git` que no lo es se reporta una sola vez— e
`integration_branch` y `release_branch`, si no son ausentes o `null`, deben ser
strings no vacíos (`config "git.<clave>" must be a non-empty string`). Cuando
ambas se declaran y resuelven sin error, `release_branch` debe diferir de
`integration_branch` tras recortar espacios (`config "git.release_branch" must
differ from "git.integration_branch" (both are "<rama>")`): iguales, un tipo
`release` se quedaría sin `back_merge_branch` y sin la comprobación de la guarda
de arranque. La comparación es textual. En cada
tipo bien formado, `integrates_into`, si está presente, debe valer `integration`
o `release` (`config type "<t>": integrates_into must be "integration" or
"release"`); resolutor y checker comparten ese mensaje (`integrationRoleError`).
Que falte `git.release_branch` no es un defecto de config aunque algún tipo la
use: un repo recién inicializado, con `hotfix` declarado y la rama vacía, pasa
`check`. El defecto es de cada change: `checkRepo` reporta en todo change no
terminal (ni `done` ni `discarded`) de un tipo `release` `type "<t>" integrates
into git.release_branch, which is not declared — set git.release_branch in
.changeledger/config.yml, for example "main"`, construido desde el mismo tramo
que el error del resolutor (`releaseBranchRequirementError`, `src/config.mjs`).
`new` rehúsa crear ese change con el mismo mensaje antes de reservar id o
escribir nada, también con `--print`; `new --from` y `apply` lo rehúsan por su
validación del candidato, y un change así no pasa a `approved` ni entra en
`in-review`. Un `git.release_branch` mal formado lo reporta sólo `checkConfig`,
una vez, sin repetirlo por change. El accessor compartido produce el diagnóstico
canónico, por lo que el check reporta configuraciones inválidas sin lanzar
excepciones ni reescribirlas. Las claves Git desconocidas permanecen permitidas
y se conservan como extensiones del repositorio.

`git.change_branch_format` declara el nombre determinista de cada rama de
change. Admite texto literal y los placeholders inmutables `{type}` y `{id}`;
exige `{id}` exactamente una vez y el resultado debe ser una ref válida de Git.
El contexto publica `change_branch=<rama>` y la transición `approved →
in-progress` exige ese nombre exacto y, cuando la rama de integración del change
está declarada, que la rama descienda de ella (`branch "<rama>" must descend
from integration branch "<base>"`, que para un tipo `release` nombra la rama de
release). Cuando la rama de integración del change difiere de una
`git.integration_branch` declarada, la guarda exige además que todas las bases
de fusión entre la rama y `git.integration_branch` (`mergeBases`,
`git merge-base --all`, `src/git.mjs`) sean ancestros de la rama de integración
del change; si no, falla con `branch "<rama>" contains commits of "<integración>"
that are not in "<base>"`. Así una rama de un tipo `release` creada desde una
rama de integración que va por delante se rechaza. La comprobación mira los
commits que la rama comparte con la de integración, no los que sólo están en la
rama: trabajo traído con cherry-pick no se detecta. Sin bases de fusión falla
cerrada con `branch "<rama>" cannot start: <causa>`, donde la causa dice que
`git.integration_branch` no existe en local (`integration branch "<integración>"
does not exist locally — create it (e.g. from its remote-tracking copy) before
starting`) o que las historias no se relacionan (`it shares no history with
integration branch "<integración>"`). La ausencia o `null` de
`change_branch_format` desactivan esta
comprobación entera en una config vigente, incluido el error de rama de release
no declarada, que entonces aparece al componer el contexto del change.

El schema 5 y `init` publican `{type}/{id}` como convención inicial. La migración
explícita con `changeledger config migrate` lleva schemas anteriores hasta v5:
añade el default cuando el formato falta o es `null`, conserva un formato no
nulo elegido por el repositorio y no introduce ninguna configuración de estado
global. Una config ya en v5 nunca se reescribe implícitamente.

El schema 3 distribuye esta capacidad a configuraciones existentes y repos
nuevos. La migración v2 → v3 y la plantilla crean un bloque Git separado y
documentado con `integration_branch:` vacío, que conserva la autodetección; su
comentario, el mismo en ambas, dice que las ramas de change parten de
`integration_branch` y se integran en ella, y que los tipos con
`integrates_into: release` usan `release_branch`. La plantilla declara además
`release_branch:` vacío, y el comentario de su tipo `hotfix` (ver **Ciclo de
vida y gate de revisión**) pide declarar esa rama antes de redactar uno:
mientras falta, `new` rehúsa crear un `hotfix`, `check` reporta el que ya exista
abierto, y `context <id>` y `agent-context` lo rechazan con el error de rama de
release no declarada. La migración no añade la clave, y sin ella nada cambia
mientras ningún tipo declare `integrates_into: release`. El formulario
estructurado del viewer permite declarar, cambiar o vaciar la rama de
integración; al eliminarla preserva las demás claves bajo `git`. Preview y
aplicación usan el mismo motor de migración.

El contrato canónico protege esa trazabilidad con un workflow git explícito:
los agentes no implementan changes aprobados en la rama de integración ni en la
de release (`git.integration_branch`, `git.release_branch`) y, mientras alguna no
está declarada, tampoco en la rama por defecto ni en otra rama compartida de
larga vida; revisan el worktree antes de empezar; commitean la documentación
aprobada antes de tocar código; e implementan un change a la vez. Los cambios no
relacionados no se incluyen silenciosamente. Cuando el contexto del change
publica `integration_branch`, la rama del change parte de ella, el resultado se
integra en ella; `check --commits` sin base la toma como `<base>` cuando la
rama checked out es la del change.
Cuando además publica `back_merge_branch`, el resultado integrado se lleva
también a esa rama y se registra en el Log con `changeledger log <id>`; ningún
comando automatiza ese merge.
La rama de release queda reservada a releases y a los tipos que se integran en
ella.

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

Una corrección candidata nacida de un `review fail --retry` queda sin commit y
aislada hasta que otro revisor de contexto limpio la confirme. Tras el `pass`, se
commitea con la verdad relacionada antes de solicitar validación humana. Una
corrección nacida de un rechazo humano permanece sin commit hasta la aceptación
final. Los intentos fallidos iteran sobre el mismo diff y no se empieza otra
tarea/change durante la espera; tras aceptación, se gradúa o salta graduación y
se commitean juntos la corrección validada y su verdad relacionada.
