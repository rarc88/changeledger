---
id: "20260726-124836"
title: Asignar owner al crear el change
type: feature
status: in-validation
created: 2026-07-26T12:48:36Z
depends_on: []
related_to: []
owner: raruiz-hiberuscom
---

## Request

Hoy un change puede nacer sin responsable: `changeledger new` solo escribe la
línea `owner:` en el frontmatter cuando se pasa `--owner` explícitamente
(condicional `owner ?` en `render()` de `src/commands/new.mjs`). Un draft recién
creado queda sin dueño hasta que alguien lo lleva a `in-progress`, momento en el
que `status()` en `src/commands/agent.mjs` asigna automáticamente la identidad
git local — pero solo si `owner` sigue vacío (guard `!fm.owner`).

Consecuencia observada: nadie es responsable de un draft abierto, y
`changeledger list --owner <nombre>` no puede encontrar drafts de nadie porque
ninguno tiene owner todavía. Se pide que un change nazca con owner en lugar de
adquirirlo recién al empezar la implementación.

## Investigation

Comportamiento actual, verificado en código:

- `render()` en `src/commands/new.mjs` solo agrega `owner: <valor>` al
  frontmatter si el parámetro `owner` es verdadero (`...(owner ? [...] : [])`).
  El CLI pasa `owner: options.owner`, que es `undefined` si no se usó `--owner`.
  No hay ninguna resolución de identidad git en esta ruta.
- `status()` en `src/commands/agent.mjs` sí resuelve la identidad local vía
  `ownerHandle(path.dirname(file))` —que intenta `gh api user --jq .login` y cae
  a `git config user.name`—, pero solo la aplica en la transición a
  `in-progress`, y solo cuando `!fm.owner`, es decir únicamente si el campo
  sigue vacío.
- `ownerHandle`, `gitUser` y `githubLogin` en `src/git.mjs` son tolerantes: si no
  hay identidad resoluble (CI, contenedor sin `gh` autenticado ni
  `git config user.name`), devuelven `''` sin lanzar error.
- `status()` ya recibe `ownerHandle` como dependencia inyectable en su firma
  (`{ ownerHandle = defaultOwnerHandle, ... }`), lo que permite a los tests
  `status to in-progress auto-assigns owner handle when empty`,
  `status to in-progress does not overwrite an explicit owner` y
  `status to in-progress tolerates a missing owner handle` de
  `test/agent.test.mjs` fijar la identidad simulada sin depender de la identidad
  git real de la máquina que corre la suite. `newChange()` no tiene hoy ningún
  punto de inyección equivalente.
- La ayuda de `--owner` en `bin/changeledger.mjs` anuncia
  `set the initial owner (defaults to unassigned)`, que este cambio vuelve falso.
- `.changeledger/specs/lifecycle.md` documenta como verdad persistente que el
  `owner` "se autoasigna al pasar a `in-progress` (cuando empieza el trabajo)" y
  que "no pisa un owner fijado a mano". La primera mitad queda incompleta al
  nacer el owner en la creación, así que la spec entra en el alcance.
- Riesgo identificado para la Especificación: si se hace que `newChange()`
  llame directamente a `ownerHandle()` de `src/git.mjs` sin poder inyectarla,
  los tests de creación (`test/cli.test.mjs`) quedarían no deterministas,
  atados a la identidad `git`/`gh` real de quien ejecute la suite. Debe
  replicarse el mismo patrón de inyección que ya usa `status()`.
- No se encontró ningún otro cambio en `.changeledger/changes/` que toque este
  camino de asignación de owner en creación; no hay `depends_on` que declarar.

## Proposal

Un solo campo, no dos: `owner` significa "responsable actual", nunca "autor".

- `changeledger new` asigna por defecto `owner` a la identidad git local
  (`ownerHandle`) cuando no se pasa `--owner`; un `--owner` explícito sigue
  ganando siempre.
- **El guard `!fm.owner` de `src/commands/agent.mjs` se conserva intacto.** La
  autoasignación en `in-progress` sigue siendo la red para un change que llegue
  a `approved` sin dueño —por ejemplo creado en CI o en un contenedor sin
  identidad resoluble— y nunca pisa un owner ya escrito. Decisión humana del
  2026-07-27.
- La reasignación al implementador es **explícita**, con
  `changeledger owner <id> <name>`, que ya existe y ya registra su evento
  `[owner]` en el Log.
- La autoría no se guarda en un campo nuevo: el Log es el registro. Se
  consideró y se descarta un campo `author`: sería superficie innecesaria
  (tocaría parser, check, viewer, métricas y templates para una pregunta que
  se hace una vez al año); queda posible más adelante sin romper nada.
- No se escribe ninguna rama de compatibilidad legacy, y `owner` nunca se
  vuelve error de validación. Un change preexistente sin `owner` sigue
  funcionando exactamente igual que hoy, sin ventana de corte ni comparación
  de timestamps. Si la identidad git local no está disponible (CI,
  contenedor), no se emite línea `owner:` y no se lanza error — mismo
  comportamiento que hoy.
- `newChange()` gana un parámetro de dependencia inyectable para la
  resolución de identidad (`ownerHandle`, con el mismo valor por defecto que
  usa `status()`), replicando el patrón que `src/commands/agent.mjs` ya usa.
  Esto mantiene los tests de creación deterministas sin depender de la identidad
  git/gh real de quien corre la suite.

### Consecuencia asumida

Con el guard conservado, quien redacta el draft sigue siendo `owner` durante toda
la implementación salvo reasignación manual. Eso tensiona una propiedad
deliberada de la herramienta (`templates/contract/readiness.md`): un modelo
fuerte documenta y uno menos capaz implementa, así que redactor e implementador
se esperan distintos. En consecuencia `list --owner` y el desglose `byOwner` de
métricas atribuyen el ciclo a quien documentó, no a quien implementó, hasta que
alguien ejecute `changeledger owner`. El humano asumió explícitamente este coste
el 2026-07-27, valorando por encima que ningún draft nazca huérfano.

### Alternativas descartadas

- **Campo `author` separado además de `owner`.** Descartado: superficie
  nueva (parser, check, viewer, métricas, templates) para una pregunta de
  baja frecuencia que el Log ya responde.
- **Quitar el guard `!fm.owner` para que `in-progress` reasigne siempre.**
  Descartado por decisión humana el 2026-07-27: la reasignación automática
  también miente cuando el implementador es el mismo que documentó, y añade una
  escritura silenciosa de frontmatter en cada arranque de trabajo. El precio de
  conservarlo queda escrito arriba y la corrección es un comando explícito.
- **Fallback especial para changes preexistentes sin `owner`.** Descartado
  como innecesario: la ausencia de `owner` ya es un estado válido hoy (campo
  opcional); no se necesita lógica de migración ni comparación de fechas.

## Specification

### CR1 — `new` sin `--owner` asigna la identidad git local
- **Given** un repo ChangeLedger inicializado y una identidad git local
  resoluble simulada como `ana` (`ownerHandle` inyectada devuelve `'ana'`)
- **When** se ejecuta `newChange({ type: 'feature', slug: 'x', title: 'X', now: '2026-07-26T12:00:00Z' }, root)` sin pasar `owner`
- **Then** el archivo generado contiene la línea de frontmatter `owner: ana`
- **And** `parseChange(texto).frontmatter.owner` es exactamente `'ana'`

### CR2 — `--owner` explícito prevalece sobre la identidad local
- **Given** la misma identidad git local simulada como `ana`
- **When** se ejecuta `newChange({ type: 'feature', slug: 'x', title: 'X', owner: 'leo', now: '2026-07-26T12:00:00Z' }, root)`
- **Then** el frontmatter resultante contiene `owner: leo`
- **And** no contiene `owner: ana`

### CR3 — sin identidad resoluble no se emite `owner:` y la creación no falla
- **Given** una identidad git local no resoluble simulada (`ownerHandle`
  inyectada devuelve `''`)
- **When** se ejecuta `newChange({ type: 'feature', slug: 'x', title: 'X', now: '2026-07-26T12:00:00Z' }, root)` sin `--owner`
- **Then** la llamada retorna la ruta del archivo sin lanzar excepción
- **And** el frontmatter del archivo generado no contiene ninguna clave `owner`

### CR4 — la ayuda del CLI deja de anunciar el default antiguo
- **Given** el comando `changeledger new --help`
- **When** se lee la descripción de la opción `--owner`
- **Then** no contiene la cadena `defaults to unassigned`
- **And** anuncia que el default es la identidad git local

### CR5 — un change preexistente sin `owner` pasa `check` sin error
- **Given** un change válido en cualquier stage activo, sin clave `owner` en
  su frontmatter
- **When** se ejecuta `changeledger check <id>`
- **Then** el comando termina con código de salida `0`
- **And** no reporta ningún warning ni error relacionado con `owner`

### CR6 — la verdad persistente describe el ciclo completo del owner
- **Given** el fichero `.changeledger/specs/lifecycle.md` tras el cambio
- **When** se lee su sección sobre `Log y owner`
- **Then** declara que el `owner` nace en la creación con la identidad git local
  y que un `--owner` explícito prevalece
- **And** conserva que la autoasignación en `in-progress` cubre el change que
  llega sin dueño y que no pisa un owner fijado a mano

## Plan

- [x] Añadir parámetro inyectable `ownerHandle` (por defecto el `ownerHandle` real de `src/git.mjs`) a `newChange()` en `src/commands/new.mjs`, usarlo para resolver `owner` cuando no se pase `--owner`, y cubrir con tests que un `--owner` explícito prevalece y que una identidad vacía no emite línea `owner:` ni lanza; verify: `node --test test/cli.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-27T21:57:12Z`
- [x] Actualizar en `bin/changeledger.mjs` la descripción de la opción `--owner` de `new` para que anuncie la identidad git local como default en vez de `defaults to unassigned`; verify: `node --test test/cli.test.mjs` (CR4)
  - **Resolved:** `2026-07-27T21:57:12Z`
- [x] En `src/check.mjs`, confirmar (sin cambio de lógica si ya cumple) que un change sin `owner` no genera warning ni error, y añadir el caso en `test/check.test.mjs`; verify: `node --test test/check.test.mjs` (CR5)
  - **Resolved:** `2026-07-27T21:57:12Z`
- [x] Actualizar la sección `Log y owner` de `.changeledger/specs/lifecycle.md` para describir el ciclo completo — owner en la creación, precedencia de `--owner`, autoasignación como red en `in-progress` sin pisar un owner manual; verify: `node bin/changeledger.mjs check` (CR6)
  - **Resolved:** `2026-07-27T21:57:12Z`
- [x] Hacer deterministas los dos helpers de test que asumían creación sin dueño: `repoWithChange()` en `test/agent.test.mjs` inyecta una identidad vacía para conservar la precondición del guard, y `doneRepo()` en `test/cli-bin.test.mjs` crea con `--owner` explícito porque un CLI lanzado como proceso no admite inyección; verify: `node --test test/agent.test.mjs test/cli-bin.test.mjs` (support)
  - **Resolved:** `2026-07-27T21:57:12Z`
- [x] Ejecutar la suite completa y el gate del propio proyecto; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-27T21:57:22Z`

## Log
- **2026-07-26T14:05:44Z** `[status]` draft → approved
- **2026-07-27T19:53:11Z** `[note]` Amendment while approved (human-authorized 2026-07-27): el guard !fm.owner de agent.mjs se CONSERVA — el owner nace en el draft y la autoasignacion en in-progress queda solo como red para un change que llegue sin dueno. Retirado el CR4 anterior (reasignacion incondicional) y su tarea; el comportamiento del guard ya esta fijado por los tests existentes de agent.test.mjs y no se reafirma como criterio nuevo. Anadidos CR4 (ayuda del CLI: 'defaults to unassigned' queda falso) y CR6 (spec lifecycle.md documenta la autoasignacion como verdad persistente incompleta). Punteros de linea de la Investigation sustituidos por nombres de simbolo y de test.
- **2026-07-27T21:34:24Z** `[status]` approved → in-progress
- **2026-07-27T21:57:11Z** `[note]` Enmienda durante in-progress, sin re-aprobacion porque no expande alcance observable: el cambio invalida una precondicion que dos helpers de test daban por hecha —que un change nace sin dueno— y tres tests preexistentes caian por eso. repoWithChange() en test/agent.test.mjs alimenta los tres tests que fijan la autoasignacion en in-progress, cuya precondicion ES el owner vacio, asi que inyecta identidad vacia y la precondicion queda explicita en vez de depender de la identidad git del host. doneRepo() en test/cli-bin.test.mjs lanza el binario real, que no admite inyeccion, asi que crea con --owner explicito; su test 105457 insertaba ademas una segunda linea owner: que ahora habria duplicado la clave de frontmatter. Anadida tarea de Plan. El delegado los reporto y paro en vez de tocar ficheros fuera de su ownership, que es lo correcto.
- **2026-07-27T21:57:22Z** `[note]` Tareas 1 y 2 en un commit combinado: los tests de CR1/CR2/CR3 y de CR4 viven en el mismo fichero test/cli.test.mjs, asi que separarlas exigiria partir cambios dentro de un mismo fichero. Superficie compartida, registrado aqui.
- **2026-07-27T22:03:23Z** `[status]` in-progress → in-review
- **2026-07-27T22:03:23Z** `[note]` [review mandate] Mandato: superficie que gobierna — el diff completo del change mas todo sitio que cree changes en tests. Puntos de escrutinio: (a) determinismo real, que ningun test dependa de la identidad git/gh del host; (b) que el guard !fm.owner siga intacto y sus tres tests sigan probando lo que dicen tras inyectar identidad vacia en el helper; (c) que las dos tareas confirm-only no hayan colado logica nueva; (d) que la spec lifecycle.md describa el ciclo completo sin volverse changelog; (e) el cambio de (CR1) a (support) en la tarea 6.
- **2026-07-27T22:16:04Z** `[review]` in-review → in-progress (retry): templates/contract/spec.md:59-61 sigue afirmando la verdad previa al cambio: que el owner lo asigna la transición approved → in-progress, sin mencionar que changeledger new lo resuelve al crear. Es el fragmento del contrato que se sirve a los repos consumidores, así que un agente en otro repo recibe el origen equivocado del owner. El mismo razonamiento que la Investigation usó para meter lifecycle.md en el alcance aplica literalmente aquí.
- **2026-07-27T22:18:06Z** `[status]` in-progress → in-review
- **2026-07-27T22:18:06Z** `[note]` [review mandate] Segunda ronda, mandato minimo: spot check de la correccion en templates/contract/spec.md, su pin y el presupuesto del pack spec, que reventó con la primera redaccion (13730/13700) y cupo tras comprimir prosa nueva mia sin perder ninguna de las tres afirmaciones (nace en creacion, --owner gana, in-progress solo si falta): 13664/13700, 36 bytes de margen. Correccion sin commitear.
- **2026-07-27T22:20:57Z** `[review]` in-review → in-validation (delegated subagent, clean context)
