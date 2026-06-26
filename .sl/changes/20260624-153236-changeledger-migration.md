---
id: "20260624-153236"
title: Migrate Spec Ledger to ChangeLedger
type: feature
status: in-progress
created: 2026-06-24T15:32:36Z
depends_on: []
release_impact: minor
owner: Roberto Ruiz
---

## Request

Renombrar integralmente Spec Ledger a **ChangeLedger** ahora que el producto aún
solo tiene uso conocido por su autor. La migración debe eliminar la identidad
anterior de todas las superficies públicas y técnicas: marca, paquete npm,
ejecutable, directorios del repositorio y del usuario, variables de entorno,
contrato, viewer, documentación, pruebas y automatización.

El resultado debe expresar con claridad la propuesta del producto: convertir una
conversación con una persona en un cambio estructurado, finito, verificable y
ejecutable; mantener ese acuerdo alineado con el código; y preservar como
documentación la verdad aceptada.

La nueva identidad será `ChangeLedger`, el paquete npm público `changeledger`, el
comando `changeledger` y el directorio de proyecto `.changeledger/`. No se
reservará un dominio como parte de este cambio.

## Investigation

El nombre Spec Ledger colisiona materialmente con `specledger/specledger`, un
proyecto anterior que también se presenta como toolkit SDD, instala un comando
`sl` y ofrece `sl init`. Aunque los productos difieren en alcance, mantener el
nombre y el binario crearía confusión de marca, documentación e instalación.

`changeledger` y `change-ledger` están libres en npm al investigar el cambio;
`changeledger` coincide exactamente con la nueva marca y evita perpetuar el
patrón anterior. `changeledger.dev` también aparece libre, pero el usuario ha
decidido no reservar dominio todavía. Existe un producto WordPress denominado
WP Change Ledger, por lo que el nombre es descriptivo y no supone por sí mismo
una autorización marcaria; no obstante, no se encontró una colisión equivalente
en tooling de desarrollo, npm o CLI.

La identidad anterior aparece en al menos 46 archivos del repositorio. Las
superficies con comportamiento, no solo texto, incluyen:

- `package.json`, `bin/sl.mjs`, metadata npm y el glob del tarball en CI.
- `.sl/`, sus rutas configuradas y el symlink local `.sl/AGENTS.md`.
- `~/.spec-ledger`, `SPEC_LEDGER_HOME` y el registro global de proyectos.
- El marcador `<!-- spec-ledger -->` inyectado en contratos raíz.
- Defaults, mensajes de error, documentación, viewer, hooks y pruebas.
- El propio historial dogfood: changes, specs y manifests de releases.

El paquete `@rarc88/spec-ledger@0.2.0` ya está publicado. npm no permite
renombrarlo: la transición requiere publicar un paquete nuevo y deprecar el
anterior después de comprobar que el reemplazo funciona. Los manifests de
release existentes sí pueden conservarse y continuar con `0.3.0`; al estar el
producto en `0.x`, este cambio incompatible se expresa como impacto `minor` sin
declarar estabilidad `1.0.0` prematuramente.

## Proposal

### Identidad canónica

Aplicar una única identidad, sin aliases ni fallback silencioso:

| Superficie | Nueva identidad |
|---|---|
| Producto | ChangeLedger |
| npm | `changeledger` |
| CLI | `changeledger` |
| Entrada ejecutable | `bin/changeledger.mjs` |
| Repositorio | `rarc88/changeledger` |
| Datos del proyecto | `.changeledger/` |
| Estado del usuario | `~/.changeledger/` |
| Variable de override | `CHANGELEDGER_HOME` |
| Marcador contractual | `<!-- changeledger -->` |

No conservar `sl`, `.sl/`, `SPEC_LEDGER_HOME` ni el marcador antiguo. Un corte
limpio evita mantener indefinidamente dos vocabularios y es aceptable porque no
hay consumidores conocidos fuera del autor. El paquete antiguo permanecerá en
npm únicamente como señal de migración.

### Datos y contrato

Mover mediante Git todo `.sl/` a `.changeledger/`, incluidos changes archivados,
specs y manifests de release. Conservar `project_id`, ids, timestamps, historial
y relaciones para que el rename no parezca un proyecto nuevo. Actualizar
`changes_dir`, `specs_dir`, readiness y `project_name` en la configuración.

Cambiar la detección del repositorio, la generación de symlinks y el contrato
instalado para usar `.changeledger/AGENTS.md`. El registro global nuevo vivirá en
`~/.changeledger/.registry.json`; la instalación de desarrollo actual se volverá
a registrar explícitamente, sin leer ni migrar automáticamente el registro
anterior.

### Producto público y release

Renombrar paquete, binario, ayuda, viewer, README, CONTRIBUTING, SECURITY,
metadata y URLs. La comunicación principal será:

> Turn conversations into buildable changes.

Tras la aceptación humana de este cambio, el agente calculará y registrará
`0.3.0`, actualizará la versión tecnológica, renombrará el repositorio GitHub y
publicará `changeledger@0.3.0`. El Trusted Publisher de npm debe apuntar al
repositorio y workflow renombrados antes de disparar el release. Solo después de
verificar una instalación real se deprecará `@rarc88/spec-ledger` con un mensaje
que dirija a `changeledger`.

### Alternativas descartadas

- Mantener `sl` como alias: conserva la colisión técnica que motiva el cambio.
- Aceptar `.sl/` y `.changeledger/`: duplica descubrimiento, documentación y
  pruebas para usuarios que no existen.
- Publicar un placeholder vacío para reservar npm: ofrece un artefacto engañoso
  y separa innecesariamente reserva de migración funcional.
- Reiniciar versiones o historial: pierde trazabilidad del mismo producto.

## Specification

### CR1 — Identidad pública única
- **Given** cualquier superficie pública, ayuda, metadata o interfaz de ChangeLedger
- **When** una persona descubre, instala o ejecuta el producto
- **Then** se presenta exclusivamente como ChangeLedger y usa `changeledger`
- **And** la identidad Spec Ledger solo puede aparecer en una nota histórica de migración

### CR2 — CLI sin colisión heredada
- **Given** el paquete `changeledger` instalado desde su tarball
- **When** se inspeccionan sus binarios y se ejecuta su ayuda
- **Then** expone el comando `changeledger` desde `bin/changeledger.mjs`
- **And** no instala ni anuncia un binario `sl`

### CR3 — Repositorio inicializado con la nueva estructura
- **Given** un repositorio nuevo con un contrato raíz válido
- **When** se ejecuta `changeledger init`
- **Then** se crea `.changeledger/` con configuración, changes y contrato enlazado
- **And** `changeledger check`, `new`, `view` y `register` descubren esa estructura desde subdirectorios

### CR4 — Historial dogfood preservado
- **Given** el repositorio actual con changes, specs y releases históricos
- **When** se migra de `.sl/` a `.changeledger/`
- **Then** se conservan ids, estados, archivos archivados, specs, releases y `project_id`
- **And** el repositorio completo pasa `changeledger check` sin depender de `.sl/`

### CR5 — Estado global completamente renombrado
- **Given** una instalación de ChangeLedger
- **When** registra o descubre proyectos globalmente
- **Then** usa `CHANGELEDGER_HOME` o `~/.changeledger/` y su nuevo registry
- **And** no lee ni escribe `SPEC_LEDGER_HOME` o `~/.spec-ledger/`

### CR6 — Contrato generado coherente
- **Given** un repositorio inicializado o registrado
- **When** un agente lee su `AGENTS.md` y `.changeledger/AGENTS.md`
- **Then** todas las instrucciones, ejemplos, rutas y comandos usan ChangeLedger
- **And** el marcador `<!-- changeledger -->` se genera idempotentemente

### CR7 — Automatización y hooks alineados
- **Given** CI, pre-commit y publicación ejecutándose en un checkout limpio
- **When** instalan, registran, validan o empaquetan el proyecto
- **Then** usan el comando, rutas y tarball de ChangeLedger
- **And** no requieren artefactos con la identidad anterior

### CR8 — Artefacto npm funcional
- **Given** el proyecto renombrado y empaquetado como `changeledger`
- **When** se instala el tarball en aislamiento
- **Then** `changeledger init` y `changeledger check` completan correctamente
- **And** el contenido publicado incluye la documentación y contrato renombrados

### CR9 — Corte limpio verificable
- **Given** la migración implementada
- **When** se buscan nombres, rutas, variables y binarios antiguos en archivos versionados
- **Then** no quedan referencias operativas a Spec Ledger, `.sl`, `SPEC_LEDGER_HOME` o `sl`
- **And** cualquier referencia histórica permitida identifica explícitamente la migración

## Plan

- [ ] Renombrar `package.json`, `bin/sl.mjs` y wiring del CLI a `changeledger`; verificar binario y ayuda en `test/cli-bin.test.mjs` con `node --test` (CR1, CR2)
- [ ] Mover `.sl/**` a `.changeledger/**` y actualizar defaults/configuración en `src/paths.mjs`, `src/repo.mjs` y `.changeledger/config.yml`; verificar descubrimiento e historial en `test/repo.test.mjs` y con `node bin/changeledger.mjs check` (CR3, CR4)
- [ ] Renombrar home, variable, registry, marcador y symlink en `src/registry.mjs`, `src/contract.mjs` y comandos relacionados; verificar aislamiento e idempotencia en `test/cli.test.mjs` y `test/registry.test.mjs` con `node --test` (CR5, CR6)
- [ ] Actualizar `templates/AGENTS.md`, `templates/config.yml`, `AGENTS.md` y hooks para la nueva convención; verificar repositorios nuevos y registrados en `test/cli.test.mjs` con `node --test` (CR3, CR6, CR7)
- [ ] Renombrar mensajes, comentarios, viewer, README, CONTRIBUTING, SECURITY, INTENT y metadata en `src/**` y documentos raíz; verificar ausencia de identidad operativa antigua mediante búsqueda versionada y `node --test` (CR1, CR9)
- [ ] Actualizar `.github/workflows/**`, hooks y `bin/changeledger.mjs` para el smoke test del tarball `changeledger`; verificar el checkout limpio en `test/cli-bin.test.mjs`, `pnpm verify` y `pnpm pack --dry-run` (CR7, CR8)
- [ ] Instalar el tarball generado desde `bin/changeledger.mjs` en un directorio aislado y ejecutar `changeledger init`, `changeledger check` y la ayuda; verificar contenido y nombre en `test/cli-bin.test.mjs` y con `npm pack --dry-run` (CR2, CR8)

## Log

- **2026-06-24T15:32:36Z** — Cambio autorizado para una migración integral a ChangeLedger; se adopta un corte limpio sin compatibilidad con la identidad anterior.
- **2026-06-26T23:24:53Z** — status: draft → approved
- **2026-06-26T23:26:46Z** — status: approved → in-progress
- **2026-06-26T23:26:46Z** — owner → Roberto Ruiz (auto)
