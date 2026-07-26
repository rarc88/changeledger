---
id: "20260726-141122"
title: Publicar los defaults de readiness en la plantilla
type: bug
status: approved
created: 2026-07-26T14:11:22Z
depends_on: []
related_to: []
owner: raruiz-hiberuscom
---

## Request

La plantilla de configuración esconde el bloque `readiness:` en un comentario
(`templates/config.yml:31-36`), pero `check` aplica de todas formas defaults con
forma JavaScript cuando no está configurado
(`target_patterns: ['src/**']`, `verification_patterns: ['test/**']`,
`src/check.mjs:574-590`). Esos diagnósticos son warnings en `draft` pero
escalan a error en `approved`/`in-progress` (`src/check.mjs:504-505`). Un repo
recién inicializado con un layout no-JS no puede aprobar un change bien
formado: probado en un `changeledger init` fresco, una tarea de Plan
`` - [ ] Update `lib/parser.rb`; verify: `bundle exec rspec spec/parser_spec.rb` (CR1) ``
avisa en `draft` y falla duro al aprobar con
`` Plan task for CR1 must name target and verification (default readiness: target_patterns=["src/**"], verification_patterns=["test/**"]) ``.

## Investigation

Cadena de evidencia releída y confirmada sin deriva:

- `templates/config.yml:31-36` — el bloque `readiness:` se distribuye comentado.
- `src/check.mjs:574-590` (`readinessConfig`) — sin configurar, cae a
  `target_patterns: ['src/**']`, `verification_patterns: ['test/**']`.
- `src/check.mjs:504-505` (`checkCoverage`) — `report = fm.status === 'draft' ?
  warn : err`: los mismos diagnósticos son warning en `draft` y error en
  `approved`/`in-progress`.
- `templates/contract/readiness.md:33-36` — ya recomienda, solo en prosa, la
  convención estructural agnóstica de layout `verification_patterns:
  ["verify:"]` para checks manuales/de dispositivo.

**Alternativa descartada:** bajar `target_patterns` a `` ["`"] `` (un backtick
literal que cualquier tarea bien formada de la gramática del Plan ya contiene)
fue rechazada por el humano: bajar el patrón hasta que todo pase falsifica la
puerta de calidad en vez de arreglarla, y `(support)` ya existe para las
tareas que legítimamente no necesitan destino ni verificación.

**Decisión de fix:** la plantilla deja de esconder `readiness:` en un
comentario. Declara la clave sin comentar con los mismos defaults efectivos
que ya aplica `readinessConfig()` sin configurar —
`target_patterns: ["src/**"]`, `verification_patterns: ["test/**"]` — más un
comentario que dice que se exigen desde `approved` en adelante y deben
adaptarse al stack del repo. El comportamiento no cambia: lo que cambia es que
la clave pasa a ser visible y editable en vez de vivir oculta en un
comentario.

**¿Participa `src/config-migration.mjs`?** Sí. `readiness:` hoy no existe como
clave YAML real en ningún config existente (solo vive comentada), así que
`readinessConfig()` cae al mismo default JS-shaped tanto en un repo recién
inicializado como en uno ya existente que nunca tocó `readiness`. Arreglar solo
la plantilla deja a todo repo existente exactamente en el mismo bug, porque
`init` no vuelve a ejecutarse sobre un repo ya creado. Igual que
`migrateToV3` añadió la sección `git:` cuando estaba ausente
(`src/config-migration.mjs:170-175`), se añade `migrateToV4`
(`schema_version` 3 → 4) que añade `readiness:` con los mismos valores cuando
la clave está ausente; un repo que ya declaró `readiness` propio queda
intacto (mismo patrón `Object.hasOwn` que usan las migraciones existentes). La
migración es explícita (`changeledger config migrate`), no automática, igual
que el resto del historial de `schema_version`.

**Obligación de contrato nueva:** `templates/contract/readiness.md:33-36` hoy
solo dice que los repos "tune" `readiness.target_patterns` y
`readiness.verification_patterns`, en voz pasiva y sin sujeto — no asigna el
deber a nadie. Entre `readiness.md` (Definition of Ready) y `spec.md`
(Authoring a Change), `readiness.md` es quien ya introduce y explica esas dos
claves, así que es quien gana la oración: el agente, al empezar a trabajar en
un repo, verifica que ambas coincidan con el stack de ese repo y las configura
cuando no coincidan. La recomendación existente de
`verification_patterns: ["verify:"]` para checks manuales/de dispositivo se
conserva intacta.

El mensaje de error existente (`readinessHint` en `src/check.mjs:592-595`) ya
nombra la clave y los valores en juego; el diagnóstico no cambia y queda fuera
de alcance de este change.

## Specification

### CR1 — La plantilla publica el bloque readiness sin comentar
- **Given** se lee `templates/config.yml` tal como se distribuye
- **When** se inspecciona su contenido
- **Then** contiene, sin comentar, `` readiness:\n  target_patterns: ["src/**"]\n  verification_patterns: ["test/**"] ``
- **And** conserva un comentario que dice que estos valores se exigen desde
  `approved` en adelante y deben adaptarse al layout propio del repo (p. ej.
  `["lib/**"]` para Ruby)

### CR2 — Init fresco con tarea no-JS aprueba una vez el agente ajusta readiness a su stack
- **Given** un directorio temporal donde `changeledger init` se ejecuta desde
  cero (repo no-JS) y, siguiendo la obligación de `readiness.md`, el agente
  ajusta `.changeledger/config.yml` con
  `readiness: { target_patterns: ["lib/**"], verification_patterns: ["verify:"] }`
  antes de aprobar
- **When** se crea un change tipo `bug` con la tarea de Plan
  `` - [ ] Update `lib/parser.rb`; verify: `bundle exec rspec spec/parser_spec.rb` (CR1) ``
  y se ejecuta `approve(id)` seguido de `checkRepo`/`changeledger check <id>`
- **Then** `approve` no lanza ningún error cuyo mensaje contenga
  `must name target and verification`
- **And** `changeledger check <id>` tras la aprobación reporta cero errores

### CR3 — Un repo con readiness ya configurado no se ve afectado
- **Given** un `.changeledger/config.yml` que ya declara
  `readiness: { target_patterns: ["custom/**"], verification_patterns: ["custom-verify:"] }`
- **When** una tarea de Plan que no cumple esos patrones dispara el diagnóstico
  de `checkCoverage`
- **Then** el hint del error es exactamente
  `` target_patterns=["custom/**"], verification_patterns=["custom-verify:"] ``
  (el valor propio del repo, no el nuevo default de la plantilla)

### CR4 — La migración añade readiness a un config existente que no lo tiene
- **Given** un `.changeledger/config.yml` en `schema_version: 3` sin clave
  `readiness`
- **When** se ejecuta la migración (`buildMigration`/`changeledger config migrate`)
- **Then** el config resultante queda en `schema_version: 4`
- **And** añade `` readiness:\n  target_patterns: ["src/**"]\n  verification_patterns: ["test/**"] ``
- **And** el resumen de cambios incluye una línea que menciona `readiness`

### CR5 — La migración no toca un readiness ya declarado
- **Given** un `.changeledger/config.yml` en `schema_version: 3` con
  `readiness:` ya declarado por el usuario (valores propios)
- **When** se ejecuta la migración
- **Then** el YAML resultante conserva esos valores de `readiness` byte a byte
- **And** el resumen de cambios no menciona `readiness`

### CR6 — El contrato asigna al agente la obligación de ajustar readiness a su stack
- **Given** se lee la salida compuesta de `changeledger context spec`
- **When** se inspecciona el fragmento `readiness.md` (Definition of Ready)
- **Then** la oración pasiva sin sujeto `Repos tune recognition with` ya no
  aparece asociada a `readiness.target_patterns` y `readiness.verification_patterns`
- **And** en su lugar hay una oración que asigna al agente, explícitamente, la
  obligación de verificar —al empezar a trabajar en un repo— que esas dos
  claves coincidan con el stack del repo, y configurarlas cuando no coincidan

## Plan

- [ ] Descomentar y fijar `readiness:` en `templates/config.yml` (`target_patterns: ["src/**"]`, `verification_patterns: ["test/**"]`) con el comentario de que se exigen desde `approved` en adelante y deben adaptarse al stack del repo, y subir su `schema_version` de 3 a 4; verify: `node --test test/cli.test.mjs` (CR1)
- [ ] Añadir en `test/cli.test.mjs` un escenario end-to-end sobre `src/commands/init.mjs` y `src/commands/agent.mjs` que haga `init()` en un dir temporal, ajuste `.changeledger/config.yml` con `readiness: { target_patterns: ["lib/**"], verification_patterns: ["verify:"] }`, cree un change `bug` con la tarea Plan no-JS del Request y ejecute `approve()` + `src/check.mjs`, afirmando ausencia del texto `must name target and verification` y cero errores; verify: `node --test test/cli.test.mjs` (CR2)
- [ ] Añadir un test en `test/check.test.mjs` sobre `src/check.mjs` que fije `config.readiness` propio y confirme que el hint de `readinessHint` reporta esos valores literalmente; verify: `node --test test/check.test.mjs` (CR3)
- [ ] Implementar `migrateToV4` en `src/config-migration.mjs` (subir `SUPPORTED_SCHEMA_VERSION` a 4) que añade `readiness` con los valores de CR1 cuando la clave está ausente, y actualizar los literales `schema_version: 3` existentes en `test/config-migration.test.mjs` y `test/cli-bin.test.mjs` a 4 (incluyendo el caso de esquema futuro, que pasa a `5`); verify: `node --test test/config-migration.test.mjs` (CR4)
- [ ] Añadir a `test/config-migration.test.mjs`, sobre `src/config-migration.mjs`, el caso de un `readiness:` ya declarado por el usuario que permanece intacto tras migrar; verify: `node --test test/config-migration.test.mjs` (CR5)
- [ ] Sustituir en `templates/contract/readiness.md:33-36` la oración pasiva `Repos tune recognition with...` por la obligación explícita del agente de verificar, al empezar a trabajar en un repo, que `readiness.target_patterns`/`readiness.verification_patterns` coincidan con su stack y configurarlos si no, conservando intacta la recomendación de `verification_patterns: ["verify:"]` para checks manuales; actualizar el hash de snapshot revisado de `readiness.md` en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR6)
- [ ] Ejecutar el gate completo tras el cambio; verify: `pnpm verify` (support)

## Log

- **2026-07-26T14:11:22Z** `[note]` Draft: la plantilla esconde `readiness:` en
  un comentario mientras `check` aplica defaults con forma JavaScript que
  bloquean la aprobación en repos no-JS. Fix decidido: publicar el bloque con
  la convención estructural `` target_patterns: ["`"] ``/
  `verification_patterns: ["verify:"]`, más una migración `schema_version` 3→4
  para que los repos existentes también lo reciban.
- **2026-07-26T15:05:07Z** `[status]` draft → approved
- **2026-07-26T15:15:55Z** `[note]` Amendment while approved (human-authorized): rejected the bare-backtick target_patterns default (falsifies the readiness gate; (support) already covers tasks needing no validation). Decided fix instead: template ships readiness: uncommented with the current effective defaults (target_patterns=["src/**"], verification_patterns=["test/**"]) plus an adapt-to-your-stack comment; migration values updated to match; new CR6 assigns readiness.md the agent obligation to verify/configure target_patterns and verification_patterns against the repo's stack when starting work. CR1/CR2/CR4 and Plan tasks 1/2/4 updated; new Plan task for CR6. Diagnostic (error message) unchanged and out of scope.
