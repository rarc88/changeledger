---
id: "20260806-103551"
title: Reconciliar la verdad durable durante la graduación
type: bug
status: in-validation
created: 2026-08-06T10:35:51Z
depends_on: []
related_to: ["20260630-191857", "20260705-134704"]
owner: Roberto Ruiz
---

## Request

Impedir que el cierre convierta mecánicamente la Specification de un change en
una spec persistente. Cuando el trabajo aceptado cambia la verdad durable, el
cierre debe reconciliar todas las specs afectadas: corregir o retirar afirmaciones
obsoletas y contradictorias, además de integrar la capacidad nueva. Solo se crea
una spec cuando ninguna existente gobierna esa verdad; si no cambió verdad
persistente, se registra `--skip`.

El problema se observó en repositorios WAIIS: `ionic-app` contiene una spec con
40 encabezados `### CRn`, y `backend-laravel` contiene 15 specs con 155 de esos
encabezados.

## Investigation

El contexto de cierre ya pide reescribir la semilla como verdad actual concisa,
pero el gate ejecutable solo busca el marcador
`<!-- changeledger:spec-scaffold -->`. `scaffoldSpec()` copia literalmente el
cuerpo de Specification o Proposal; después, `graduate --into` acepta el archivo
en cuanto el marcador desaparece, aunque conserve todos los criterios locales al
change. El validador global `checkSpecs()` comprueba metadatos y procedencia
bidireccional, pero no el cuerpo de la spec. Por eso una edición manual también
elude el gate.

Los changes `#20260630-191857` y `#20260705-134704` introdujeron y unificaron el
flujo de graduación en dos pasos; son contexto relacionado, no prerrequisitos.
La spec `lifecycle` describe ese flujo y será la verdad persistente que este
change deberá reconciliar al cerrarse.

Detectar un encabezado CR residual es determinista. Determinar qué specs están
afectadas y si su contenido se contradice requiere comprensión semántica; esa
parte pertenece al contrato de cierre y a su revisión, no a una heurística del
CLI.

## Specification

### CR1 — `graduate --into` rechaza criterios locales al change

- **Given** una spec objetivo sin marcador de scaffold que contiene fuera de bloques de código un encabezado Markdown `### CR1 — Caso`
- **When** se ejecuta `changeledger graduate <id> <slug> --into`
- **Then** falla con `spec contains change-local criterion heading "CR1"; rewrite it as durable current truth`
- **And** ni la spec ni el change se modifican

### CR2 — El check detecta specs contaminadas y evita falsos positivos

- **Given** una spec contiene fuera de bloques de código un encabezado Markdown de nivel 1 a 6 cuyo texto comienza con `CR` seguido de dígitos
- **When** se ejecuta `changeledger check`
- **Then** el archivo aparece como error con el mismo diagnóstico de verdad durable
- **And** una mención `CR1` en prosa o dentro de un bloque de código no produce ese error

### CR3 — Cerrar reconcilia toda la verdad afectada

- **Given** un change aceptado altera verdad persistente gobernada por una o más specs existentes
- **When** el agente ejecuta el cierre
- **Then** identifica y actualiza cada spec afectada como verdad actual coherente
- **And** corrige o elimina afirmaciones obsoletas o contradictorias antes de extender el contenido
- **And** no conserva encabezados ni identificadores de criterios locales al change como estructura de la spec

### CR4 — Crear y omitir son decisiones excluyentes basadas en la verdad

- **Given** un change aceptado está pendiente de graduación
- **When** el agente resuelve su verdad persistente
- **Then** usa `--new` solo cuando ninguna spec existente gobierna esa verdad y enlaza individualmente todas las specs creadas o modificadas antes de archivar
- **And** usa `--skip` solo cuando el change no altera verdad persistente

## Plan

- [x] Añadir primero los casos rojos y centralizar la validación de encabezados CR persistentes para `check` y `graduate --into`
  - **Target:** `test/check.test.mjs`, `test/graduate.test.mjs`, `src/check.mjs`, `src/commands/graduate.mjs`
  - **Verify:** `node --test test/check.test.mjs test/graduate.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-06T10:47:01Z`
- [x] Reescribir el contrato de cierre alrededor de reconciliación, creación y skip, y guardar sus obligaciones con patrones tolerantes a redacción
  - **Target:** `templates/contract/close.md`, `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-08-06T10:47:01Z`
- [x] Ejecutar el gate integral del repositorio
  - **Support:** calidad integral
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-06T10:48:04Z`

## Log
- **2026-08-06T10:37:24Z** `[note]` Draft autorizado tras confirmar que el cierre debe reconciliar, no solo extender, toda spec afectada.
- **2026-08-06T10:39:46Z** `[status]` draft → approved
- **2026-08-06T10:41:07Z** `[status]` approved → in-progress
- **2026-08-06T10:48:40Z** `[status]` in-progress → in-review
- **2026-08-06T10:50:12Z** `[note]` Mandato de review: auditoría completa de CR1-CR4, del gate compartido check/graduate, de falsos positivos Markdown, del contrato de cierre y de sus pruebas en baseline..HEAD.
- **2026-08-06T10:55:16Z** `[review]` in-review → in-progress (retry): CR2 incompleto: el detector ATX manual omite headings Markdown anidados y Setext, y produce falsos positivos en bloques de código y cierres de fence no válidos.
- **2026-08-06T10:57:54Z** `[status]` in-progress → in-review
- **2026-08-06T11:03:55Z** `[review]` in-review → in-progress (retry): CR2 aún admite una evasión en producción: parseSpec recorta la indentación inicial del cuerpo, cambia la semántica Markdown de un pseudo-fence y permite que check y graduate omitan un encabezado CR visible; se requiere preservar esa indentación y cubrir ambos flujos reales.
- **2026-08-06T11:07:01Z** `[note]` Corrección del segundo review: parseSpec preserva la indentación inicial del cuerpo; regresiones reales prueban que check detecta el CR tras pseudo-fence y graduate falla sin modificar spec ni change.
- **2026-08-06T11:07:01Z** `[status]` in-progress → in-review
- **2026-08-06T11:07:19Z** `[note]` Mandato de review de confirmación: comprobar solo la evasión por trim de parseSpec y regresiones introducidas por la corrección; ejecutar check desde una spec cargada y graduate --into con pseudo-fence indentado, verificar cero escrituras y revisar el efecto de trimEnd en consumidores.
- **2026-08-06T11:11:51Z** `[review]` in-review → in-validation (delegated subagent, clean context)
