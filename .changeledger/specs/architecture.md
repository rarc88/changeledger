---
title: Arquitectura de ChangeLedger
updated: 2026-08-09T11:01:04Z
tags: [ architecture, cli, viewer ]
graduated_from: ["20260615-214816", "20260615-214817", "20260615-214819", "20260615-214828", "20260615-222616", "20260615-222619", "20260615-222620", "20260615-222617", "20260615-222618", "20260616-151226", "20260617-190005", "20260617-190008", "20260617-190007", "20260617-185958", "20260617-195016", "20260617-231423", "20260617-231428", "20260618-122611", "20260619-171002", "20260620-214902", "20260623-235628", "20260624-005437", "20260624-153236", "20260627-111218", "20260627-205033", "20260628-113218", "20260628-113219", "20260628-213942", "20260711-103758", "20260711-160445", "20260711-162556", "20260726-141119", "20260726-141122", "20260731-161652", "20260808-151640", "20260808-151641", "20260808-151643"]
---

# Arquitectura de ChangeLedger

ChangeLedger separa **almacén** (fuente de verdad, optimizada para agente y git)
de **presentación** (un visor agradable para el humano). Es un CLI global; en
cada repo solo viven los documentos bajo `.changeledger/`.

## Componentes

```mermaid
flowchart TD
  subgraph repo[".changeledger/ en el repo"]
    CFG[config.yml]
    CH[changes/*.md]
    SP[specs/*.md]
  end
  subgraph core["núcleo (src/)"]
    YAML[yaml.mjs] --> CHANGE[change.mjs]
    YAML --> SPEC[spec.mjs]
    CFG --> REPO[repo.mjs]
    CHANGE --> REPO
    SPEC --> REPO
    REPO --> CHECK[check.mjs]
    REPO --> WRITER[writer.mjs]
    CT[commands/context.mjs] --> REPO
  end
  FRAG[templates/contract/*.md] --> CT
  subgraph cli["CLI (bin/changeledger)"]
    INIT[init] --> repo
    NEW[new] --> CH
    CHECKC[check] --> CHECK
    CONTEXT[context] --> CT
    AGENT[status/log/task/list/show] --> WRITER
    VIEW[view] --> SRV
  end
  SRV[server node:http] --> REPO
  SRV --> UI[visor: board / table / graph / Ledger / metrics]
```

`bin/changeledger.mjs` define la interfaz de comandos con `commander`, manteniendo
`src/commands/*` como capa de aplicación. La dependencia está fijada en una
línea compatible con Node 20 y el binario conserva el shebang + modo ejecutable,
porque se publica como comando global `changeledger`. El parser rechaza opciones
desconocidas en lugar de ignorarlas silenciosamente.

El binario expone su versión instalada mediante `changeledger --version`, `-v` y
`-V`; el valor se lee del `package.json` distribuido para que una instalación
empaquetada nunca dependa de un literal duplicado.

`.changeledger/config.yml` declara un `schema_version` entero. La ausencia se
interpreta como schema histórico `0`; `check` y `register` lo detectan y ofrecen
`changeledger config migrate --dry-run`, pero nunca migran implícitamente. La
migración explícita construye un candidato con el AST de YAML, actualiza estructura
y comentarios administrados, conserva decisiones y extensiones propias, no mueve
directorios y escribe atómicamente. Repetirla sobre el schema vigente es un no-op
byte-idéntico; un schema más nuevo que el soportado falla cerrado. Las
migraciones son una cadena versionada y aditiva: el schema vigente es `4`. La
migración 1 → 2 añade el tipo `quick` y sus impactos a repos schema 1 sin pisar
un `quick` custom ni extensiones propias (guardas `Object.hasOwn`). La migración
3 → 4 repara el acoplamiento entre `review_required` y las stages verificables:
inserta las stages ausentes, en su posición canónica, sólo en los tipos que
declaran `review_required: true`, y deja byte a byte los demás. Lee el documento
YAML vivo y no la instantánea previa, porque una migración anterior de la misma
cadena puede haber añadido el propio `review_required` que dispara la reparación.
Nunca inserta una stage que la lista canónica del repo no declare: sin punto de
inserción legítimo se abstiene y deja en pie el error exacto de `checkConfig`, en
vez de fabricar una lista inválida y declararse terminada. La misma 3 → 4 añade
además la sección `readiness` cuando falta, copiando valores y comentario de
`templates/config.yml` para que plantilla y migración no puedan divergir, y
dejando intacto —byte a byte— cualquier `readiness` que el repo ya declarara,
incluso malformado: esa clave es del usuario y su diagnóstico pertenece a
`check`. El resumen
de la migración expone la versión de origen real detectada, y CLI y visor
comparten el mismo motor; el cliente del visor lee la versión soportada del
payload del servidor en vez de duplicar la constante.

Toda frontera que escribe en el ledger valida el schema con una precondición
compartida antes de adquirir locks, crear directorios o modificar archivos. Esto
incluye creación y lifecycle de changes, `fix`, graduación, releases y escrituras
del viewer. Un schema futuro produce el mismo diagnóstico accionable en todas
ellas y exige actualizar ChangeLedger antes de escribir. Las lecturas,
`changeledger check`, los previews de migración y `fix --dry-run` permanecen
disponibles para diagnosticar el repositorio sin mutarlo.

El contexto core funciona también como índice operativo mínimo. Antes de escanear
archivos, orienta a consultar trabajo autorizado con `changeledger list --status
approved` y decisiones de cierre pendientes con `changeledger list --pending
graduation`. La orientación es estática: no ejecuta esas consultas ni incorpora
estado efímero al contexto determinista.

## Store del estado global (núcleo local)

`src/state-store.mjs` implementa el núcleo de almacenamiento de la capacidad
acotada por `global-state-scope.md`: el ledger completo como árbol exclusivo
(`.changeledger-state/{manifest.yml, config.yml, changes/, specs/, releases/}`)
en la ref fija `refs/heads/changeledger/state`. Lectura por snapshot sin
checkout (`readSnapshot`, sobre `src/git-batch.mjs`: un `ls-tree` + `cat-file
--batch` por lotes con validación UTF-8 estricta), escritura por
compare-and-swap (`mutateState`: árbol candidato en índice temporal,
`update-ref` con old-value, `LedgerConflictError` en conflicto) e integridad
padre-contra-candidato: ninguna identidad desaparece sin `remove` explícito.
La activación es checkout-independiente — `refs/changeledger/activation`
apunta a un commit cuya `authority.yml` nombra la ref de verdad
(`readActivation`/`writeActivation`) — y toda lectura de refs es fail-closed:
ausencia real devuelve `null`, cualquier fallo de lectura lanza con el stderr
de git; los objetos se verifican por tipo (`assertCommitObject`), nunca por
peel.

El enrutado de lectura (`20260808-151641`) es un único resolver: la familia
`loadRepo`/`loadRepoWithConfig`/`loadRepoAsync` de `src/repo.mjs`, compartida
por el CLI y por el viewer (`router.mjs` no tiene camino de lectura propio).
Tras descubrir el repo, consulta `readActivation` — solo si `repoRoot` está
dentro de un repo git, decidido subiendo por los ancestros en busca de un
`.git` (archivo o directorio, el mismo descubrimiento que hace git; una
comprobación de filesystem, nunca un subproceso), no solo el directorio exacto
que recibió `loadRepo`: `.changeledger/` puede vivir por debajo del top-level
de git (la misma brecha entre `repoRoot` y la raíz real que ya documentan
`gitTopLevel`/`commit()` en `src/git.mjs`), y comprobar solo el directorio
exacto ocultaba en silencio una activación viva ahí. Sin activación, el
comportamiento es el de siempre, byte a byte, con `state: null` — y en un
directorio que no está dentro de ningún repo git, cero subprocesos. Con
activación, `changes`, `specs`, `releases` y `config` salen de `readSnapshot`
en lugar del working tree, y el resultado gana `state: { revision }` — la
costura que el CAS de escritura usará como `expectedRevision`. Una activación
presente cuya ref de estado es ilegible o ausente propaga el error
fail-closed del store; nunca degrada al worktree.

Segunda vía de lectura, misma frontera: `resolveChange` (`src/repo.mjs`)
sigue siendo un escaneo directo del working tree — lo necesitan los
consumidores que mutan (`src/commands/agent.mjs`, `src/commands/graduate.mjs`
y las escrituras del viewer),
porque una mutación necesita una ruta de archivo real para escribir, y esa
ruta pertenece por diseño a `20260808-151643` (el change de escritura).
`resolveChangeInRepo`, en cambio, resuelve el mismo id por búsqueda exacta
pero contra `repo.changes` de un `loadRepo*` ya cargado — hereda la autoridad
bajo la que ese repo se cargó (snapshot si está activado) en lugar de leer
disco de nuevo. `context`/`agent-context` (`src/commands/context.mjs`,
`src/commands/agent-context.mjs`) la usan para sus lecturas por id de change,
dependencia y relación; su captura sin id (modo core o palabra clave) no
necesita ningún documento de change, así que no paga un `loadRepo` completo —
sigue leyendo `config` directo del worktree, como antes de esta etapa. Con
esto, la frontera de config es: los callers que cargan config sin pasar por
`loadRepo*` en absoluto (`new`, `register`, el bootstrap de `check`, y las
capturas sin id de `context`/`agent-context`) siguen leyendo el worktree en
esta etapa — ambos nacen idénticos hasta el cutover de escritura de la etapa
2, que resuelve la autoridad final.

## Costura de escritura del estado global

`src/change-store.mjs` (`20260808-151643`) es el único punto que decide, por
`repo.state`, si una mutación de `.changeledger/**` aterriza en el worktree
(`mutateFileAtomic`/`writeFileAtomic` de siempre) o como commit CAS en la ref
de estado (`mutateState`, con `expectedRevision: repo.state.revision`).
`mutateLedgerFile(repo, target, mutate, { message })` cubre un documento —
`target` es `{ file }` (ruta de worktree) en modo inactivo o `{ relPath,
text }` (ruta relativa al árbol de estado más el texto ya leído a
`repo.state.revision`) en modo activo; `mutate` recibe ese texto y devuelve
el siguiente, o `undefined` para no escribir, el mismo contrato de
`mutateFileAtomic`. `writeLedgerFiles(repo, entries, { message })` cubre
varios documentos como una sola unidad: inactivo, cada entrada se escribe a
su `file` de forma independiente (sin atomicidad cruzada, como siempre);
activo, todas las entradas aterrizan en **un** commit CAS — la costura que
permite a `graduate` en modo activo retirar el rollback manual de dos
escrituras que el modo inactivo todavía conserva.

Cada mutador decide su rama sin depender de un `loadRepo` completo cuando
está inactivo: `repoIsActivated(repoRoot)` es la puerta barata (el mismo
descubrimiento fs-only de `.git` que usa `resolveActivation` en
`src/repo.mjs`, duplicado aquí porque este otro punto de llamada necesita la
respuesta *antes* de decidir cómo localizar el documento — vía
`resolveChange` tolerante a hermanos rotos si está inactivo, vía
`resolveChangeInRepo` sobre el repo ya cargado si está activo, ya que el
documento puede no existir en disco en absoluto). Los once mutadores de
`src/commands/agent.mjs`, `graduate`/`skipGraduation`
(`src/commands/graduate.mjs`, spec+change en un solo commit en modo activo),
`fix` (`src/commands/fix.mjs`, una invocación = un commit), `release.mjs` y
las tres escrituras de config del visor (`src/viewer/domain.mjs`) enrutan por
esta costura; `new.mjs` es la única excepción de mecánica propia — en modo
activo la unicidad del id la garantiza el propio CAS, con un reintento
acotado a uno ante conflicto (el documento es nuevo por construcción, así
que no hay una decisión previa que un reintento silencioso pueda invalidar;
todo otro caller de la costura propaga el conflicto sin reintentar). El
conflicto CAS se presenta en `bin/changeledger.mjs` como
`state changed since load — re-run the command`, exit distinto de cero, sin
relabeling del mensaje interno del store (`state ref moved: ...`) — el bin
solo presenta, el store ya garantiza que no hay escritura parcial. Con esto
cierra el gate de la etapa 1: un repo activado opera enteramente contra la
ref en local, tanto en lectura como en escritura.

## API documental del visor

`GET /api/ledger-tree?project=<id>` entrega las categorías documentales como
paths lógicos relativos y formato, nunca paths absolutos. Exige resolución exacta
de un proyecto vivo incluso para fuentes instaladas: un id desconocido responde
`404 {"error":"no project"}` y una entrada registrada cuya ruta desapareció,
`410 {"error":"project path is gone"}`. `Project docs` incluye únicamente los
`README.md`, `AGENTS.md` e `INTENT.md` existentes en la raíz del proyecto;
`Contract`, recursivamente los `.md`, `.yml` y `.yaml` de
`templates/contract/` instalado; `Templates`, esos mismos formatos del resto de
`templates/`, excluyendo todo el subárbol `contract/`. Los ausentes se omiten y
cada colección se ordena léxicamente. Specs conserva su payload y cuerpos en
`/api/repo`; estos endpoints no la duplican.

`GET /api/ledger-document?project=<id>&category=<slug>&path=<lógico>` solo lee
una entrada exacta del árbol allowlisted y responde
`{ category, path, format, content }`, con `format: "markdown"` para `.md` y
`format: "source"` para YAML. Categoría/path vacío o desconocido, path absoluto,
NUL, backslash, segmentos vacíos/`.`/`..`, extensión no permitida, fichero fuera
de allowlist, no regular o escape por symlink fallan cerrado como
`404 {"error":"document not found"}` sin revelar rutas locales. El tamaño se
comprueba antes de leer: más de 1 MiB responde
`413 {"error":"document too large"}`. Ambos endpoints aceptan solo GET; otro
método responde 405 con `Allow: GET`.

La enumeración y lectura resuelven primero contra la raíz lógica de su categoría
y vuelven a comprobar `realpath` de raíz, directorios y fichero. Solo siguen
symlinks cuyo destino real permanece contenido, evitan ciclos de directorios y
omiten escapes; la lectura vuelve a exigir fichero regular y mide mediante el
descriptor abierto. Así el árbol recursivo puede representar subdirectorios sin
convertirse en un explorador genérico del filesystem.

`changeledger search <términos...>` completa ese descubrimiento con búsqueda
léxica determinista sobre changes (incluidos archivados) y specs: scoring
título×3 / headings+CR×2 / cuerpo×1, normalización a minúsculas sin acentos y
desempate estable a igual score — la verdad persistente primero (spec antes que
change) y después ref descendente. Sin embeddings ni servicios externos,
coherente con el núcleo local-first. El contrato de autoría ordena ejecutarla
antes de investigar desde cero para reutilizar decisiones ya registradas.

## Specs de dominio

- [Modelo de datos e identidad](data-model.md)
- [Ciclo de vida y gate de revisión](lifecycle.md)
- [Releases portables](releases.md)
- [Validación (changeledger check)](validation.md)
- [Trazabilidad git](git-traceability.md)
- [Discovery del contrato](contract-discovery.md)
- [Definition of Ready](readiness.md)
- [Política de idioma](language.md)
- [Viewer y presentación](viewer.md)
- [Política de dependencias](dependencies.md)
- [Métricas](metrics.md)
