---
id: "20260726-141122"
title: Publicar los defaults de readiness en la plantilla
type: bug
status: draft
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

**Decisión de fix (plantilla):** declarar `readiness:` sin comentar en
`templates/config.yml`, usando la convención estructural agnóstica de layout
`verification_patterns: ["verify:"]` (ya recomendada en `readiness.md`) y,
para `target_patterns`, `` ["`"] `` — un backtick literal. Justificación en una
frase: un backtick literal exige que la tarea nombre *algo* concreto entre
backticks (la propia convención de la gramática del Plan, `` Update `path`;
verify: `cmd` (CRn) ``), sin asumir ningún directorio de layout (`src/`, `lib/`,
`app/`…), de modo que Ruby, Python, Go o JS aprueban igual de bien sin tocar la
config.

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

## Specification

### CR1 — La plantilla publica el bloque readiness sin comentar
- **Given** se lee `templates/config.yml` tal como se distribuye
- **When** se inspecciona su contenido
- **Then** contiene, sin comentar, `` readiness:\n  target_patterns: ["`"]\n  verification_patterns: ["verify:"] ``
- **And** conserva un comentario que explica cómo endurecer `target_patterns`
  al layout propio del repo (p. ej. `["src/**"]` para JS/TS o `["lib/**"]`
  para Ruby)

### CR2 — Init fresco con tarea no-JS aprueba sin el error de readiness
- **Given** un directorio temporal donde `changeledger init` se ejecuta desde
  cero (repo no-JS, sin `readiness:` propio en su config)
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
- **And** añade `` readiness:\n  target_patterns: ["`"]\n  verification_patterns: ["verify:"] ``
- **And** el resumen de cambios incluye una línea que menciona `readiness`

### CR5 — La migración no toca un readiness ya declarado
- **Given** un `.changeledger/config.yml` en `schema_version: 3` con
  `readiness:` ya declarado por el usuario (valores propios)
- **When** se ejecuta la migración
- **Then** el YAML resultante conserva esos valores de `readiness` byte a byte
- **And** el resumen de cambios no menciona `readiness`

## Plan

- [ ] Descomentar y fijar `readiness:` en `templates/config.yml` (`target_patterns: ["`"]`, `verification_patterns: ["verify:"]`) con el comentario de cómo endurecerlo por layout, y subir su `schema_version` de 3 a 4; verify: `node --test test/cli.test.mjs` (CR1)
- [ ] Añadir en `test/cli.test.mjs` un escenario end-to-end sobre `src/commands/init.mjs` y `src/commands/agent.mjs` que haga `init()` en un dir temporal, cree un change `bug` con la tarea Plan no-JS del Request y ejecute `approve()` + `src/check.mjs`, afirmando ausencia del texto `must name target and verification` y cero errores; verify: `node --test test/cli.test.mjs` (CR2)
- [ ] Añadir un test en `test/check.test.mjs` sobre `src/check.mjs` que fije `config.readiness` propio y confirme que el hint de `readinessHint` reporta esos valores literalmente; verify: `node --test test/check.test.mjs` (CR3)
- [ ] Implementar `migrateToV4` en `src/config-migration.mjs` (subir `SUPPORTED_SCHEMA_VERSION` a 4) que añade `readiness` con los valores de CR1 cuando la clave está ausente, y actualizar los literales `schema_version: 3` existentes en `test/config-migration.test.mjs` y `test/cli-bin.test.mjs` a 4 (incluyendo el caso de esquema futuro, que pasa a `5`); verify: `node --test test/config-migration.test.mjs` (CR4)
- [ ] Añadir a `test/config-migration.test.mjs`, sobre `src/config-migration.mjs`, el caso de un `readiness:` ya declarado por el usuario que permanece intacto tras migrar; verify: `node --test test/config-migration.test.mjs` (CR5)
- [ ] Ejecutar el gate completo tras el cambio; verify: `pnpm verify` (support)

## Log

- **2026-07-26T14:11:22Z** `[note]` Draft: la plantilla esconde `readiness:` en
  un comentario mientras `check` aplica defaults con forma JavaScript que
  bloquean la aprobación en repos no-JS. Fix decidido: publicar el bloque con
  la convención estructural `` target_patterns: ["`"] ``/
  `verification_patterns: ["verify:"]`, más una migración `schema_version` 3→4
  para que los repos existentes también lo reciban.
