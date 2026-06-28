---
id: "20260628-113219"
title: Migrar configuraciones de repositorios de forma segura
type: feature
status: in-progress
created: 2026-06-28T11:32:19Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Los repositorios creados con versiones anteriores conservan el `config.yml` de
su época. Un proyecto iniciado como SpecLedger puede carecer de `tdd`,
`in-review`, `in-validation`, `discarded`, `review_required`, `release.impacts`
y los comentarios actuales, aunque el CLI global ya opere con el modelo nuevo.
`changeledger register` migra hoy el bootstrap del contrato, pero no revisa ni
versiona la configuración.

Necesitamos detectar configuraciones antiguas y actualizarlas de manera
repetible y auditable, preservando los valores y extensiones propias del repo.
La migración no debe adivinar rutas ni sobrescribir decisiones explícitas.

## Investigation

La historia de `templates/config.yml` muestra cambios semánticos acumulativos:

- SpecLedger comenzó con cinco statuses, rutas `.sl/*` e `id_digits`;
- se añadieron `tdd`, el gate `in-review` con `review_required`, el terminal
  `discarded`, la validación humana `in-validation`, hints de readiness y
  `release.impacts`;
- el rename a ChangeLedger cambió comentarios, comandos y defaults de ruta;
- no existe `schema_version`, migrador ni comparación con el template vigente.

`loadConfig` solo parsea YAML. `check` detecta algunas incompatibilidades (por
ejemplo `in-validation` ausente), pero no puede decir qué generación produjo el
archivo ni repararlo. El paquete `yaml` ya expone un Document AST capaz de
conservar nodos/comentarios y `writeFileAtomic` proporciona escritura segura.

La configuración es política del proyecto: tipos, stages, rutas, readiness e
impactos pueden estar personalizados. Por eso una mutación implícita dentro de
`register` sería demasiado sorpresiva. La herramienta debe detectar y explicar;
la escritura debe ocurrir mediante un comando explícito con dry-run.

## Proposal

Introducir un entero `schema_version` en `templates/config.yml`; la primera
versión gestionada será `1`. Ausencia equivale al schema histórico `0`. Cada
salto futuro tendrá una función de migración explícita, secuencial y testeada; no
se comparará YAML genéricamente ni se copiará el template a ciegas.

Nuevo flujo:

```sh
changeledger config migrate --dry-run  # resumen + YAML candidato; no escribe
changeledger config migrate            # escritura atómica
changeledger check
```

La migración `0 → 1`:

- añade `schema_version: 1`, `tdd: true` y `specs_dir` solo cuando faltan;
- inserta los statuses canónicos ausentes en su orden canónico, conservando
  statuses custom y los valores ya presentes;
- añade `review_required: true` solo a `feature`, `bug` y `refactor` cuando la
  clave falta; un `false` explícito se conserva;
- añade defaults de `release.impacts` para tipos built-in cuando faltan,
  conservando impactos existentes; no inventa impacto para tipos custom;
- elimina únicamente `id_digits`, clave legacy conocida y sin efecto;
- refresca estructura y comentarios administrados desde el template actual,
  preservando valores, claves desconocidas y extensiones propias.

Las rutas configuradas se preservan literalmente, incluso `.sl/changes` o
`.sl/specs`: mover directorios es otra operación con riesgo de datos y queda
fuera de alcance. Los comentarios libres ligados a extensiones desconocidas se
conservan; los comentarios históricos administrados por ChangeLedger se
reemplazan por la explicación vigente.

`init` siembra el schema actual. `check` y `register` no migran silenciosamente:
cuando detectan schema antiguo muestran el comando accionable. Un schema futuro
falla cerrado para evitar downgrades destructivos. Ejecutar el migrador sobre un
archivo vigente es un no-op byte-idéntico.

## Specification

### CR1 — repos nuevos declaran schema vigente
- **Given** un repo sin `.changeledger/`
- **When** ejecuto `changeledger init`
- **Then** `.changeledger/config.yml` contiene `schema_version: 1`
- **And** conserva todos los defaults y comentarios del template vigente

### CR2 — detección accionable sin mutación implícita
- **Given** un config sin `schema_version`
- **When** ejecuto `changeledger check` o `changeledger register`
- **Then** se informa `config schema 0 is outdated; run \`changeledger config migrate --dry-run\``
- **And** ninguno modifica `config.yml`

### CR3 — dry-run muestra exactamente el candidato
- **Given** un config válido de schema `0`
- **When** ejecuto `changeledger config migrate --dry-run`
- **Then** stdout identifica `Config migration 0 → 1 (dry run)` y contiene el YAML candidato completo
- **And** el archivo original permanece byte-idéntico

### CR4 — migración histórica completa
- **Given** un config SpecLedger con statuses `[draft, approved, in-progress, blocked, done]`, sin `tdd`, release ni gates
- **When** ejecuto `changeledger config migrate`
- **Then** añade `schema_version: 1`, `tdd: true`, `in-review`, `in-validation`, `discarded`, los defaults `review_required` y `release.impacts`
- **And** elimina la clave obsoleta `id_digits`
- **And** `changeledger check` no reporta errores de estructura/configuración

### CR5 — valores y extensiones del repo se preservan
- **Given** un config schema `0` con `language: es`, rutas `.sl/*`, `tdd: false`, `feature.review_required: false`, impactos modificados, un status custom y claves desconocidas comentadas
- **When** se migra a schema `1`
- **Then** esos valores, rutas, status, claves y comentarios custom permanecen
- **And** solo se añaden defaults realmente ausentes
- **And** no se mueve, crea ni elimina ningún directorio de datos

### CR6 — tipos custom no reciben decisiones inventadas
- **Given** un tipo custom `experiment` sin `release.impacts.experiment`
- **When** ejecuto la migración
- **Then** el tipo y sus stages se preservan sin inventar `review_required` ni impacto
- **And** `check` conserva su diagnóstico normal si el repo necesita definir un impacto antes de release

### CR7 — escritura atómica e idempotente
- **Given** una migración válida `0 → 1`
- **When** se aplica y luego se ejecuta nuevamente
- **Then** la primera escritura reemplaza el archivo atómicamente
- **And** la segunda informa que el config ya está vigente y no cambia ningún byte

### CR8 — entradas inválidas o futuras fallan cerradas
- **Given** YAML inválido o `schema_version: 2` cuando el CLI soporta hasta `1`
- **When** ejecuto `changeledger config migrate`
- **Then** termina con código `1`, explica el problema y no modifica el archivo
- **And** para schema futuro incluye `config schema 2 is newer than supported schema 1`

### CR9 — cobertura de generaciones reales
- **Given** fixtures representativos del template inicial de SpecLedger y de cada adición semántica posterior
- **When** se ejecutan las migraciones en tests
- **Then** todos convergen al schema `1` preservando sus valores y pasan `changeledger check`

## Plan

- [ ] Añadir `schema_version: 1` al template y detección compartida en `src/config.mjs`, `src/check.mjs` y `src/commands/register.mjs`; verify: `test/config-migration.test.mjs`, `test/cli.test.mjs` y `test/check.test.mjs` cubren schema actual y antiguo (CR1, CR2, CR8)
- [ ] Implementar migraciones secuenciales y render preservador en `src/config-migration.mjs` usando el AST de `yaml` y `writeFileAtomic`; verify: fixtures históricas y casos custom en `test/config-migration.test.mjs` (CR3, CR4, CR5, CR6, CR7, CR8, CR9)
- [ ] Exponer `changeledger config migrate [--dry-run]` desde `bin/changeledger.mjs`; verify: `test/cli-bin.test.mjs` comprueba stdout, códigos de salida y no-escritura (CR2, CR3, CR7, CR8)
- [ ] Documentar el flujo de upgrade en `README.md` y el contexto de implementación; verify: inspección renderizada y `pnpm test` (support)
- [ ] Migrar el `.changeledger/config.yml` de este repo como caso dogfood y comprobar que conserva `language: es`, readiness e identidad (support)
- [ ] Ejecutar `pnpm verify` y probar la migración sobre copias temporales de configs históricos (support)

## Log
- **2026-06-28T11:42:01Z** — status: draft → approved
- **2026-06-28T11:51:01Z** — status: approved → in-progress
- **2026-06-28T11:51:01Z** — owner → raruiz-hiberuscom (auto)
