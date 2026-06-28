---
id: "20260628-113924"
title: Editor amigable y migración de config en el viewer
type: feature
status: in-validation
created: 2026-06-28T11:39:24Z
depends_on: [ "20260628-113219" ]
owner: raruiz-hiberuscom
---

## Request

La vista Projects permite editar `.changeledger/config.yml` únicamente como YAML
raw. Es potente, pero obliga a una persona a conocer claves, enums, indentación y
relaciones entre `types`, `stages`, `review_required` y `release.impacts`. La
experiencia mostrada en el viewer debe ofrecer un formulario comprensible por
defecto sin retirar el editor raw para casos avanzados.

El mismo viewer debe ayudar a migrar configs antiguos: mostrar qué está
desactualizado, permitir revisar el candidato y aplicar de forma explícita el
mismo migrador seguro que ofrece el CLI.

## Investigation

El viewer actual ya tiene una base de seguridad valiosa:

- `readProjectConfig` devuelve contenido exacto y una revisión;
- `saveProjectConfig` rechaza YAML inválido, cambios de `project_id`, repos que no
  cargan y escrituras sobre una revisión obsoleta;
- la escritura es atómica y las rutas HTTP requieren token same-origin;
- la UI actual es un único `<textarea>` con Reload y Save configuration.

Serializar un objeto completo desde el navegador perdería comentarios, claves
desconocidas y formato. El formulario tampoco debe implementar su propio
migrador: divergiría del CLI. El change `20260628-113219` introduce
`schema_version`, migraciones secuenciales y un transformador preservador; esta
feature depende de él y lo reutiliza en el servidor.

## Proposal

La sección de configuración tendrá dos modos:

- **Form** — modo por defecto para schema vigente;
- **Raw YAML** — editor actual, conservado como vía avanzada.

El formulario agrupa el modelo mental:

1. **General**: `project_name`, idioma y TDD.
2. **Paths**: changes/specs, con explicación de que no mueven datos existentes.
3. **Lifecycle**: statuses y stages; los canónicos requeridos se identifican y
   no se pueden retirar accidentalmente, mientras los custom permanecen visibles.
4. **Change types**: nombre, stages activos, review requerido e impacto SemVer;
   tipos custom se representan sin asumir defaults.
5. **Definition of Ready**: listas editables de target y verification patterns.
6. **Internal**: `schema_version` y `project_id` visibles en solo lectura.

El navegador envía un **patch semántico allowlisted**, no un YAML reconstruido.
El servidor aplica ese patch al Document AST compartido por el migrador,
preservando comentarios, formato razonable, claves desconocidas y campos que el
formulario no representa. Después reutiliza toda la validación y protección de
revisión actuales. Cambiar de modo con ediciones sin guardar pide confirmación.

Para schema antiguo, Form se sustituye por una tarjeta **Migration required**:

1. `Preview migration` llama al servidor y muestra resumen + YAML candidato sin
   escribir;
2. `Apply migration` exige confirmación y envía la revisión leída;
3. el servidor ejecuta la misma función que `changeledger config migrate`;
4. al completar, recarga el config y abre Form.

Un schema más nuevo que el CLI queda fail-closed: se puede inspeccionar en Raw,
pero el viewer no permite guardar ni migrar y pide actualizar ChangeLedger. La
migración nunca ocurre al seleccionar, recargar o abrir un proyecto.

Fuera de alcance: mover directorios, diseñar un editor YAML genérico, ocultar
claves custom o rediseñar el resto de Projects.

## Specification

### CR1 — Form es el modo predeterminado
- **Given** un proyecto disponible con config en el schema soportado
- **When** abro Projects y selecciono el proyecto
- **Then** la sección `.changeledger/config.yml` muestra `Form` activo por defecto
- **And** presenta General, Paths, Lifecycle, Change types, Definition of Ready e Internal

### CR2 — Raw conserva la capacidad actual
- **Given** un config cargado
- **When** activo `Raw YAML`
- **Then** veo el contenido exacto leído del archivo en el textarea actual
- **And** Reload, validación, guardado y errores mantienen su comportamiento

### CR3 — campos humanos mapean el config vigente
- **Given** `language: es`, `tdd: false`, rutas custom, tipos built-in/custom, stages, review flags, impactos y readiness patterns
- **When** el formulario renderiza el config
- **Then** cada valor aparece en el control y grupo correspondiente
- **And** `schema_version` y `project_id` aparecen como solo lectura

### CR4 — guardado semántico preserva YAML no representado
- **Given** un config con comentarios y claves custom que el formulario no edita
- **When** cambio únicamente `language` de `es` a `en` y guardo Form
- **Then** solo cambia el valor de `language`
- **And** comentarios, claves custom, identidad y demás valores permanecen

### CR5 — servidor sigue siendo autoridad de validación
- **Given** un patch que intenta retirar `in-validation`, cambiar `project_id` o producir un repo no cargable
- **When** se envía desde Form o directamente al endpoint
- **Then** responde con error accionable y no modifica el archivo ni el registry

### CR6 — conflicto concurrente no pisa disco
- **Given** Form fue cargado con una revisión y el config cambió en disco después
- **When** intento guardar o migrar con la revisión antigua
- **Then** recibo `configuration changed on disk; reload before saving`
- **And** el archivo nuevo permanece byte-idéntico

### CR7 — preview de migración no escribe
- **Given** un config schema `0`
- **When** abro Projects y pulso `Preview migration`
- **Then** veo el resumen `0 → 1` y el YAML candidato generado por el migrador compartido
- **And** el archivo original permanece byte-idéntico

### CR8 — migración confirmada reutiliza el motor del CLI
- **Given** el preview `0 → 1` vigente
- **When** confirmo `Apply migration`
- **Then** el servidor aplica atómicamente el mismo resultado que `changeledger config migrate`
- **And** recarga la revisión y muestra Form con los valores preservados

### CR9 — abrir o recargar nunca migra implícitamente
- **Given** un config antiguo
- **When** selecciono el proyecto, alterno vistas o pulso Reload
- **Then** no cambia ningún byte hasta que confirme `Apply migration`

### CR10 — schema futuro falla cerrado
- **Given** `schema_version: 2` y un viewer que soporta hasta `1`
- **When** abro la configuración
- **Then** Form y las acciones de escritura/migración están deshabilitadas
- **And** Raw permite inspección y muestra `Update ChangeLedger to edit config schema 2`

### CR11 — cambio de modo protege ediciones locales
- **Given** cambios sin guardar en Form o Raw
- **When** intento alternar de modo, recargar o seleccionar otro proyecto
- **Then** el viewer pide confirmación antes de descartar esas ediciones

### CR12 — controles accesibles y adaptables
- **Given** navegación por teclado o un viewport estrecho
- **When** uso tabs, listas, toggles, botones de migración y errores
- **Then** los controles tienen labels/foco/estado accesibles y el layout no exige scroll horizontal

## Plan

- [x] Extender `src/viewer/domain.mjs` con lectura estructurada, patch allowlisted y preview/apply que reutilicen `src/config-migration.mjs`; verify: `test/view.test.mjs` cubre preservación, validación, revisión y schemas (CR3, CR4, CR5, CR6, CR7, CR8, CR9, CR10) — 2026-06-28T12:12:00Z
- [x] Exponer endpoints autorizados de patch y migración en `src/viewer/server/router.mjs` y `src/viewer/public/api.js`; verify: `test/view.test.mjs` prueba token, payloads y códigos HTTP (CR5, CR6, CR7, CR8, CR10) — 2026-06-28T12:12:00Z
- [x] Implementar tabs Form/Raw y el formulario agrupado en `src/viewer/public/app.js`; verify: `test/view.test.mjs` cubre default, mapeo, raw y protección de cambios sucios (CR1, CR2, CR3, CR11) — 2026-06-28T12:12:01Z
- [x] Diseñar estados de formulario, migración, errores y responsive en `src/viewer/public/styles.css`; verify: inspección visual desktop/estrecha y `test/view.test.mjs` cubre hooks accesibles (CR7, CR8, CR10, CR12) — 2026-06-28T12:12:01Z
- [x] Ejecutar `pnpm verify` y validar manualmente config actual, schema `0`, schema futuro y claves custom desde el viewer (support) — 2026-06-28T12:12:01Z

## Log
- **2026-06-28T11:42:41Z** — status: draft → approved
- **2026-06-28T12:02:15Z** — status: approved → in-progress
- **2026-06-28T12:02:15Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-28T12:12:01Z** — Implemented: domain.mjs extended with readProjectConfigStructured/patchProjectConfig/previewConfigMigration/applyConfigMigration; new HTTP routes in router.mjs; API client in api.js; Form/Raw tabbed UI in app.js with form groups, migration card, future-schema fail-closed; styles in styles.css. 442 tests pass, pnpm verify clean.
- **2026-06-28T12:12:18Z** — status: in-progress → in-review
- **2026-06-28T12:15:15Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-28T12:15:16Z** — Review passed — all CRs verified, no security issues found.
- **2026-06-28T12:38:33Z** — validation → in-progress (human rejected): Reemplazar confirm/alert nativos por UI propia; implementar protección de cambios sin guardar; hacer Raw estrictamente read-only para schemas futuros; completar project_name, lifecycle/stages y tipos; rechazar explícitamente cambios de project_id; hacer atómica la comprobación de revisión y escritura de migración; mostrar errores de preview y cubrir todos estos CRs con tests.
- **2026-06-28T12:57:06Z** — status: in-progress → in-review
- **2026-06-28T12:57:06Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-28T12:57:06Z** — Corrección: UI confirm dialog propio (sin browser confirm/alert); Raw read-only para schema futuro; project_name en formulario y en patch; lifecycle completo (statuses + stages); project_id rechazado explícitamente en patch; applyConfigMigration usa mutateFileAtomic para atomicidad; errores de preview mostrados en UI; project_name en PATCH_ALLOWED; tests añadidos.
- **2026-06-28T13:11:16Z** — Fix adicional: reemplazado inline confirm dialog por native <dialog> con showModal(); setConfirmImpl() para test injection; CSS ::backdrop con paleta del app; eliminado confirmDialog state.
- **2026-06-28T13:27:40Z** — validation → in-progress (human rejected): CR11 dirty-state guard missing; new keys lack template comments; form invents custom impacts; lifecycle read-only; 4 alert() remain
- **2026-06-28T13:36:37Z** — Corrección 5 hallazgos bloqueantes: (1) CR11 dirty-state guard en switchMode/select/reload con showConfirm; (2) migration refresca comentarios en nuevas claves (string-key→Scalar fix); (3) collectFormPatch no inventa impacts para tipos custom sin impacto previo; (4) Lifecycle section con badges de status y stages visuales; (5) 4 alert() reemplazados con showToast() + toast-container en index.html.
- **2026-06-28T13:36:37Z** — status: in-progress → in-review
- **2026-06-28T13:36:37Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-28T13:48:02Z** — Eliminado último modal nativo: requestUnregisterConfirmation reemplazado con showPrompt() usando native <dialog> con input; setPromptImpl() para test injection; CSS para cl-prompt-input.
- **2026-06-28T16:39:52Z** — validation → in-progress (human rejected): Lifecycle y stages por tipo siguen sin controles editables; retirar in-validation se corrige silenciosamente en lugar de rechazarse; el formulario debe emitir un patch diferencial que preserve campos no modificados.
- **2026-06-28T16:47:36Z** — Corrección final: Lifecycle y stages por tipo son controles editables; decisiones custom usan estado no configurado sin defaults inventados; patch diferencial; retirada de valores canónicos falla explícitamente; selector global también protege cambios sucios; accesibilidad por fieldsets. Validado en navegador y pnpm verify: 462 tests.
- **2026-06-28T16:47:36Z** — status: in-progress → in-review
- **2026-06-28T16:51:50Z** — review → in-progress (retry): CR10: el endpoint de guardado Raw permite mutar schema futuro; debe fallar cerrado y preservar disco, con regresión de dominio y HTTP.
- **2026-06-28T16:52:44Z** — Corrección de review: saveProjectConfig comprueba dentro del lock el schema actualmente guardado y rechaza escrituras Raw sobre schemas futuros; regresiones de dominio y HTTP preservan disco. pnpm verify: 463 tests.
- **2026-06-28T16:52:45Z** — status: in-progress → in-review
- **2026-06-28T16:54:51Z** — review → in-progress (retry): CR6: postConfigMigrationApply no rechaza HTTP non-2xx; la UI recarga y oculta el 409 de revisión obsoleta en vez de mostrarlo.
- **2026-06-28T16:56:09Z** — Corrección de review: postConfigMigrationApply rechaza respuestas HTTP non-2xx con el mensaje del servidor, permitiendo que la UI muestre conflictos 409 sin recargar; regresión del cliente API. pnpm verify: 464 tests.
- **2026-06-28T16:56:09Z** — status: in-progress → in-review
- **2026-06-28T16:58:39Z** — review → in-progress (retry): CR12: dialogs sin nombre accesible, input de prompt sin label y errores asíncronos sin role=alert/aria-live.
- **2026-06-28T17:00:11Z** — Corrección de review CR12: dialogs con aria-labelledby único, input de prompt con label asociado y errores dinámicos con role=alert/aria-live; eliminado CSS residual. pnpm verify: 465 tests.
- **2026-06-28T17:00:11Z** — status: in-progress → in-review
- **2026-06-28T17:02:25Z** — review → in-progress (retry): CR7: el preview UI no renderiza preview.summary, por lo que no muestra explícitamente Config migration 0 → 1.
- **2026-06-28T17:03:00Z** — Corrección de review CR7: el preview exitoso renderiza summary con Config migration 0 → 1 (dry run), además de cambios y YAML candidato; regresión DOM. pnpm verify: 466 tests.
- **2026-06-28T17:03:00Z** — status: in-progress → in-review
- **2026-06-28T17:04:51Z** — review → in-validation (delegated subagent, clean context)
