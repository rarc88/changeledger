---
id: "20260726-124836"
title: Asignar owner al crear el change
type: feature
status: draft
created: 2026-07-26T12:48:36Z
depends_on: []
related_to: []
owner: raruiz-hiberuscom
---

## Request

Hoy un change puede nacer sin responsable: `changeledger new` solo escribe la
línea `owner:` en el frontmatter cuando se pasa `--owner` explícitamente
(`src/commands/new.mjs:159`). Un draft recién creado queda sin dueño hasta que
alguien lo lleva a `in-progress`, momento en el que `src/commands/agent.mjs:76`
asigna automáticamente la identidad git local — pero solo si `owner` sigue
vacío (`!fm.owner`).

Consecuencia observada: nadie es responsable de un draft abierto, y
`changeledger list --owner <nombre>` no puede encontrar drafts de nadie porque
ninguno tiene owner todavía. Se pide que un change nazca con owner en lugar de
adquirirlo recién al empezar la implementación.

## Investigation

Comportamiento actual, verificado en código:

- `newChange()` en `src/commands/new.mjs:149-165` (`render()`) solo agrega
  `owner: <valor>` al frontmatter si el parámetro `owner` es verdadero
  (`...(owner ? [...] : [])`). El CLI (`bin/changeledger.mjs:104,116`) pasa
  `owner: options.owner`, que es `undefined` si no se usó `--owner`. No hay
  ninguna resolución de identidad git en esta ruta.
- `status()` en `src/commands/agent.mjs:45,76-84` sí resuelve la identidad
  local vía `ownerHandle(path.dirname(file))` (de `src/git.mjs:87-89`, que
  intenta `gh api user --jq .login` y cae a `git config user.name`), pero solo
  la aplica en la transición a `in-progress`, y solo cuando
  `!fm.owner` — es decir, únicamente si el campo sigue vacío.
- `src/git.mjs:87-89` (`ownerHandle`) y `src/git.mjs:63-69`
  (`gitUser`)/`src/git.mjs:77-83` (`githubLogin`) son tolerantes: si no hay
  identidad resoluble (CI, contenedor sin `gh` autenticado ni
  `git config user.name`), devuelven `''` sin lanzar error.
- `status()` ya recibe `ownerHandle` como dependencia inyectable en su firma
  (`{ ownerHandle = defaultOwnerHandle, ... }`,
  `src/commands/agent.mjs:26`), lo que permite a
  `test/agent.test.mjs:125-146` fijar la identidad simulada
  (`ownerHandle: () => 'raruiz'`) sin depender de la identidad git real de la
  máquina que corre el test. `newChange()` no tiene hoy ningún punto de
  inyección equivalente.
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
- La transición a `in-progress` **reasigna** `owner` a quien retoma el
  trabajo, incondicionalmente — se elimina el guard `!fm.owner` en
  `src/commands/agent.mjs:76`. La reasignación se sigue registrando como
  evento `owner` automático en el Log, igual que hoy.
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
  usa `status()`: `src/git.mjs`'s `ownerHandle`), replicando el patrón que
  `src/commands/agent.mjs` ya usa. Esto mantiene los tests de creación
  deterministas sin depender de la identidad git/gh real de quien corre la
  suite.

### Trampa explícita a manejar

Si el draft nace con owner y el guard `!fm.owner` se mantuviera, la
asignación automática en `in-progress` nunca dispararía y quien redactó el
draft seguiría siendo owner durante toda la implementación. Eso contradice
una propiedad deliberada de esta herramienta
(`templates/contract/readiness.md`): un modelo fuerte documenta y uno menos
capaz implementa, así que redactor e implementador se esperan distintos.
`owner` mentiría entonces sobre quién implementa, y también lo haría
`list --owner` al filtrar por ese valor. Por eso la resolución elegida quita
el guard en vez de conservarlo: `in-progress` reasigna siempre.

### Alternativas descartadas

- **Campo `author` separado además de `owner`.** Descartado: superficie
  nueva (parser, check, viewer, métricas, templates) para una pregunta de
  baja frecuencia que el Log ya responde.
- **Mantener el guard `!fm.owner` y solo cambiar `new`.** Descartado:
  reproduce exactamente la trampa — el owner de creación quedaría congelado
  para siempre, y ya no habría forma de que la reasignación en
  `in-progress` corrija la responsabilidad al empezar a implementar.
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

### CR4 — `in-progress` reasigna el owner a la identidad de quien retoma el trabajo
- **Given** un change en `status: approved` con `owner: ana` en frontmatter
- **When** se ejecuta `status(id, 'in-progress', root, { ownerHandle: () => 'leo' })`
- **Then** `parseChange(texto).frontmatter.owner` pasa a ser exactamente `'leo'`
- **And** el body de la stage `Log` contiene una nueva entrada que matchea `` /`\[owner\]` set: leo \(auto\)/ ``

### CR5 — un change preexistente sin `owner` pasa `check` sin error
- **Given** un change válido en cualquier stage activo, sin clave `owner` en
  su frontmatter
- **When** se ejecuta `changeledger check <id>`
- **Then** el comando termina con código de salida `0`
- **And** no reporta ningún warning ni error relacionado con `owner`

## Plan

- [ ] Añadir parámetro inyectable `ownerHandle` (por defecto el `ownerHandle` real de `src/git.mjs`) a `newChange()` en `src/commands/new.mjs`, y usarlo para resolver `owner` cuando no se pase `--owner`; verify: `node --test test/cli.test.mjs` (CR1)
- [ ] En `src/commands/new.mjs`, confirmar que un `owner` explícito sigue ganando sobre `ownerHandle()` (sin cambio de precedencia, solo verificar que el `owner ??`/`||` explícito no se pisa); verify: `node --test test/cli.test.mjs` (CR2)
- [ ] En `src/commands/new.mjs`, confirmar que `ownerHandle()` devolviendo `''` no agrega línea `owner:` y `newChange()` no lanza; verify: `node --test test/cli.test.mjs` (CR3)
- [ ] Quitar el guard `!fm.owner` en la asignación automática de `in-progress` en `src/commands/agent.mjs:76`, y actualizar el test existente `test/agent.test.mjs` ("status to in-progress does not overwrite an explicit owner") para reflejar la reasignación en vez de la preservación; verify: `node --test test/agent.test.mjs` (CR4)
- [ ] En `src/check.mjs`, confirmar (sin cambio de lógica si ya cumple) que un change sin `owner` no genera warning ni error, y añadir el caso en `test/check.test.mjs`; verify: `node --test test/check.test.mjs` (CR5)
- [ ] Ejecutar la suite completa y el gate del propio proyecto; verify: `pnpm verify` (support)

## Log
