---
id: "20260726-141123"
title: Resolver la colisión del nombre audit
type: bug
status: approved
created: 2026-07-26T14:11:23Z
depends_on: []
related_to: []
owner: raruiz-hiberuscom
---

## Request

El rol de delegación `audit` (inspección de solo lectura posterior a la
revisión, con el cambio ya en `in-validation`) comparte nombre literal con el
tipo de cambio configurado `audit` (`stages: [request, investigation, log]`,
`.changeledger/config.yml:65-66` y `templates/config.yml`). Cuando se invoca
`changeledger agent-context audit <id>` sobre un cambio cuyo *tipo* es `audit`
pero cuyo *status* no es `in-validation`, el error `role audit requires
change status in-validation; got <status>` se lee como un bug del tipo
`audit`, no como una colisión de espacio de nombres entre rol y tipo.

## Investigation

Confirmado leyendo el código, no solo lo señalado en la auditoría original:

- `src/commands/agent-context.mjs:10` — `ROLES = ['investigation',
  'implementation', 'review', 'audit']`.
- `src/commands/agent-context.mjs:14` — `ALLOWED_STATUSES.audit =
  ['in-validation']`.
- `src/commands/agent-context.mjs:38-42` — al pedir el rol `audit` para un
  cambio en cualquier otro status, lanza literalmente `role audit requires
  change status in-validation; got <status>`.
- `.changeledger/config.yml:65-66` y `templates/config.yml` — `audit` también
  es un tipo de cambio configurado, con sus propias `stages`. Nombre de rol y
  nombre de tipo son la misma cadena `audit` en dos espacios de nombres
  distintos (roles de delegación vs. tipos de cambio) que este repo no
  distingue en los mensajes de error.
- `src/commands/agent-prompt.mjs:8` — confirmado: **la misma colisión existe
  en `agent-prompt`**. `ROLES = ['investigation', 'implementation', 'review',
  'audit']` es una constante duplicada e idéntica; `changeledger agent-prompt
  audit` tiene el mismo nombre de rol y el mismo problema de lectura.
- `bin/changeledger.mjs:272,280,287,295,298,308,316` — la ayuda de CLI de
  `agent-prompt` y `agent-context` también nombra el rol `audit` en la
  descripción del argumento, en el texto de ayuda y en los ejemplos.
- `templates/contract/agent-prompts/audit.md` y
  `templates/contract/agent-contexts/audit.md` — los esqueletos empaquetados
  usan `audit` en el nombre de archivo y en el contenido (`role: audit`,
  "READ-ONLY AUDIT delegate", "Read-Only Audit Delegate").
- `templates/contract/core.md:64-69` — el párrafo de delegación del contrato
  central lista los roles como `(investigation | implementation | review |
  audit)` y describe: "`audit` is a read-only post-review inspection of a
  change already in `in-validation`; it never issues a verdict or moves the
  change."
- `README.md:157-163` — repite la misma descripción con `audit` como nombre de
  rol.
- `test/agent-context.test.mjs` y `test/agent-prompt.test.mjs` — fijan el
  nombre `audit` como rol en aserciones literales (mensajes de error, listas
  de roles válidos, contenido de los esqueletos).

Veredicto: el defecto es real, no una lectura errónea de un mensaje correcto.
El nombre de rol y el nombre de tipo son la misma palabra en dos dominios sin
relación (delegación vs. ciclo de vida de cambios), y el mensaje de error
resultante (`role audit requires change status in-validation; got <status>`)
es ambiguo exactamente cuando el cambio bajo inspección es, además, del tipo
`audit`.

Fix mínimo decidido: renombrar el ROL, no el tipo — el tipo es configuración
de cara al usuario que los repos consumidores ya declaran en su
`config.yml`; renombrarlo sería un cambio incompatible con impacto externo
mayor. El propio contrato ya describe la actividad del rol con las mismas
palabras en dos sitios: `templates/contract/agent-contexts/audit.md:7-8`
("This is a **post-review** inspection of a change already sitting in
`in-validation`") y `templates/contract/core.md:68-69` ("a read-only
**post-review** inspection of a change already in `in-validation`"). Se
elige `post-review` como nuevo nombre de rol: es la palabra que el propio
contrato ya usa para describir la actividad, no colisiona con ningún tipo de
cambio configurado (`feature | bug | audit | refactor | chore | quick`), ni
con ningún otro rol (`investigation | implementation | review`), ni con
ningún `status` del ciclo de vida (`in-review` es distinto de
`post-review`). Sin alias de compatibilidad: el repo prohíbe residuo de
compatibilidad, así que `audit` deja de resolver como rol sin excepción.

## Specification

### CR1 — El rol renombrado se acepta y conserva la puerta `in-validation`
- **Given** un cambio en status `in-validation`
- **When** se ejecuta `changeledger agent-context post-review <id>`
- **Then** la salida enmarca `role: post-review` en la línea `BEGIN` y compone la cápsula de solo lectura sin error
- **And** pedir el mismo rol sobre un cambio en `approved` falla exactamente con `role post-review requires change status in-validation; got approved`

### CR2 — El nombre de rol anterior se rechaza en todas partes, sin alias
- **Given** cualquier estado del repositorio
- **When** se ejecuta `changeledger agent-context audit <id>` o `changeledger agent-prompt audit`
- **Then** ambos fallan exactamente con `Unknown role "audit" — valid roles: investigation, implementation, review, post-review`
- **And** ningún alias hace que `audit` siga resolviendo como rol

### CR3 — Toda la documentación empaquetada del rol usa el nombre nuevo
- **Given** la ayuda de CLI empaquetada (`bin/changeledger.mjs`), los esqueletos de rol bajo `templates/contract/agent-prompts/` y `templates/contract/agent-contexts/`, el párrafo de delegación del contrato central (`templates/contract/core.md`) y el párrafo de roles de `README.md`
- **When** cualquiera de ellos lista o describe el rol de inspección de solo lectura posterior a la revisión
- **Then** todas las apariciones lo nombran `post-review` y ninguna lo nombra `audit`
- **And** la descripción "a read-only post-review inspection of a change already in `in-validation`; it never issues a verdict or moves the change" (o su equivalente ya existente) se conserva
- **And** la descripción del argumento `<role>` en `agent-prompt` y `agent-context` (`bin/changeledger.mjs`) lee `investigation | implementation | review | post-review`

## Plan

- [ ] Actualizar `test/agent-context.test.mjs` y `test/agent-prompt.test.mjs` contra la resolución de rol actual de `src/commands/agent-context.mjs` y `src/commands/agent-prompt.mjs`: reemplazar todo uso del rol `'audit'` por `'post-review'`, actualizar los mensajes literales esperados a `role post-review requires change status in-validation; got <status>` y `valid roles: investigation, implementation, review, post-review`, y añadir el caso que exige que `audit` siga rechazándose con ese mismo mensaje de roles válidos; verify: `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs` (se espera en rojo) (CR1, CR2)
- [ ] Renombrar el rol en `src/commands/agent-context.mjs` (array `ROLES` en la línea 10, clave `ALLOWED_STATUSES` en la línea 14) y en `src/commands/agent-prompt.mjs` (array `ROLES` en la línea 8) de `audit` a `post-review`; verify: `node --test test/agent-context.test.mjs test/agent-prompt.test.mjs` (CR1, CR2)
- [ ] Renombrar `templates/contract/agent-prompts/audit.md` → `post-review.md` y `templates/contract/agent-contexts/audit.md` → `post-review.md`, actualizando el contenido interno (`role: audit`, "READ-ONLY AUDIT delegate", "Read-Only Audit Delegate") a `post-review`; verify: `node --test test/agent-prompt.test.mjs test/agent-context.test.mjs` (CR3)
- [ ] Actualizar las referencias al rol en `bin/changeledger.mjs` (descripciones de argumento y ejemplos de los comandos `agent-prompt` y `agent-context`, actualmente en las líneas 272, 280, 287, 295, 298, 308 y 316), el párrafo de delegación de `templates/contract/core.md` (líneas ~64-69) y el párrafo de roles de `README.md` (línea ~158), de `audit` a `post-review`, conservando la frase "never issues a verdict"; verify: `grep -n "investigation | implementation | review | post-review" bin/changeledger.mjs && ! grep -rn "review | audit" bin/changeledger.mjs templates/contract/core.md README.md` (CR3)
- [ ] Ejecutar la suite completa y el gate de calidad; verify: `pnpm verify` (support)

## Log
- **2026-07-26T15:05:09Z** `[status]` draft → approved
