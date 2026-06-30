---
id: "20260630-191857"
title: Hacer explícita y verificable la intención de graduación
type: bug
status: in-progress
created: 2026-06-30T19:18:57Z
depends_on: []
owner: Roberto Ruiz
---

## Request

Evitar que un agente convierta por accidente una decisión de `--skip` en una
spec llamada `skip*.md`, y evitar que una spec nueva quede marcada como verdad
persistente revisada mientras todavía contiene el scaffold mecánico copiado del
change. El problema se observó en `ionic-app`: el commit
`bdbb95b6404b8b0d98487376c5a746b423307b70` creó `skip.md`,
`skip-map-driver-riders.md` y `skip-panel-breakpoints.md`; graduaciones anteriores
dejaron además specs con los `CR*` del change sin convertirlos en documentación
durable.

## Investigation

`bin/changeledger.mjs` modela `graduate` con tres posicionales opcionales
(`[change-id] [spec-slug] [reason...]`) y usa la ausencia de `--skip` como señal
implícita para crear una spec. Por eso `graduate <id> skip` y
`graduate <id> skip-map-driver-riders` son creaciones válidas, no errores. El CLI
no puede distinguir la intención equivocada.

`src/commands/graduate.mjs` agrava el problema de contenido: la ruta de spec
nueva copia mecánicamente `Specification` (o `Proposal`) y en la misma operación
escribe el marcador `graduado a spec` y `reviewed: true`. Sin embargo,
`templates/contract/close.md` llama a ese contenido un seed y exige refinarlo
manualmente. El estado declara resuelta la graduación antes de que termine el
trabajo requerido.

`close.md` sí se usa desde `src/commands/context.mjs` para un change con
`status: done`, pero solo aparece al ejecutar `changeledger context <id>`. El
bootstrap obliga a cargar únicamente `changeledger context`; si el agente no
vuelve a pedir contexto después de la aceptación humana, no recibe la guía de
cierre. La protección principal debe estar por tanto en el CLI, y el contexto
base debe indicar explícitamente que hay que recargar el contexto por id al
cambiar de fase.

Los cuatro specs reportados no nacieron todos del mismo commit: tres fueron
creados el 26 de junio y migrados desde `.sl/specs/`; `device-snapshot.md` fue
creado el 29 de junio. Todos muestran el segundo fallo: contienen el bloque
`Specification`/`CR*` prácticamente literal y quedaron revisados en la misma
operación.

## Specification

### CR1 — La creación de spec requiere intención explícita
- **Given** un change `done` y un slug cualquiera, incluido `skip` o `skip-*`
- **When** se ejecuta `changeledger graduate <id> <slug>` sin modo
- **Then** el comando falla sin escribir el change ni la spec
- **And** el error muestra las alternativas literales `--new`, `--into` y `--skip`

### CR2 — Crear un scaffold no resuelve la graduación
- **Given** un change `done` sin decisión de graduación y un slug inexistente
- **When** se ejecuta `changeledger graduate <id> <slug> --new`
- **Then** se crea la spec semilla a partir del change
- **And** la spec contiene un marcador explícito de scaffold pendiente
- **And** el change conserva `reviewed` distinto de `true` y no recibe el marcador `graduado a spec`
- **And** la salida indica que se debe refinar la spec y finalizar con `--into`

### CR3 — La spec refinada se finaliza explícitamente
- **Given** una spec existente cuyo contenido durable ya fue revisado manualmente y cuyo marcador de scaffold fue eliminado
- **When** se ejecuta `changeledger graduate <id> <slug> --into`
- **Then** el comando actualiza `updated`, añade el marcador `graduado a spec` y fija `reviewed: true`
- **And** no modifica el cuerpo de la spec
- **And** si el marcador de scaffold sigue presente, falla sin modificar el change ni la spec

### CR4 — Skip sigue siendo una decisión explícita y atómica
- **Given** un change `done` que no cambia verdad persistente
- **When** se ejecuta `changeledger graduate <id> --skip <reason>`
- **Then** se añade `graduation skipped: <reason>` y se fija `reviewed: true`
- **And** no se crea ni modifica ninguna spec

### CR5 — Los modos incompatibles fallan sin escrituras
- **Given** cualquier change
- **When** se combinan dos o más de `--new`, `--into`, `--skip` y `--pending`, o se pasan argumentos incompatibles con el modo elegido
- **Then** el comando falla con un mensaje de uso accionable
- **And** no modifica ningún archivo

### CR6 — El contrato conduce al cierre correcto
- **Given** un agente que carga el contexto base o el contexto de un change `done`
- **When** lee la instrucción de cierre
- **Then** ve que debe recargar `changeledger context <id>` después de la aceptación
- **And** ve el flujo literal `--new` → refinar → `--into`, además de `--skip`
- **And** no se describe una spec semilla como graduación terminada

### CR7 — La deuda existente queda identificada para reparación
- **Given** el historial de `ionic-app`
- **When** se auditan specs y marcadores de graduación
- **Then** el resultado distingue las specs accidentales ya corregidas tras `bdbb95b6` de las cuatro specs no refinadas reportadas
- **And** documenta una reparación separada en ese repositorio sin alterar su código de producto

## Plan

- [x] Definir en `bin/changeledger.mjs` mediante `test/cli-bin.test.mjs` el modo explícito, la exclusión de flags y la ausencia de escrituras ante errores; verify: `node --test test/cli-bin.test.mjs` (CR1, CR4, CR5) — 2026-06-30T19:43:42Z
- [x] Separar scaffold y finalización en `src/commands/graduate.mjs` y cablear `--new` en `bin/changeledger.mjs`, dejando la creación pendiente hasta `--into`; verify: `node --test test/graduate.test.mjs test/cli-bin.test.mjs` (CR1, CR2, CR3, CR4, CR5) — 2026-06-30T19:43:42Z
- [x] Actualizar la guía de cierre y el handoff de fase en `templates/contract/core.md` y `templates/contract/close.md`, con hashes y expectativas correspondientes en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR6) — 2026-06-30T19:43:42Z
- [x] Alinear `README.md` con la ayuda canónica de `templates/contract/close.md` y sus expectativas de contexto; verify: `node --test test/context.test.mjs` y `rg -n "graduate" README.md templates bin test` (CR1, CR2, CR3, CR4, CR6) — 2026-06-30T19:43:42Z
- [ ] Ejecutar `pnpm verify` y confirmar que el cambio completo y la verdad persistente permanecen consistentes (support)
- [ ] Crear en `ionic-app` un change de reparación para `.changeledger/specs/auth-session-persistence.md`, `.changeledger/specs/competitor-detection.md`, `.changeledger/specs/device-snapshot.md` y `.changeledger/specs/firebase-app-check.md` como verdad durable, preservando sus vínculos de graduación; verify: `node bin/changeledger.mjs check` o el binario instalado equivalente en `ionic-app` (CR7)

## Log

- **2026-06-30T19:18:57Z** — change creado como draft tras reproducir la ambigüedad del parser, verificar el overlay `close` para `done` y auditar el historial de graduación de `ionic-app`.
- **2026-06-30T19:37:31Z** — status: draft → approved
- **2026-06-30T19:45:00Z** — Durante el TDD se precisó la condición verificable de refinamiento: `--new` deja un marcador de scaffold y `--into` no puede finalizar mientras siga presente.
- **2026-06-30T19:38:23Z** — status: approved → in-progress
- **2026-06-30T19:38:23Z** — owner → Roberto Ruiz (auto)
