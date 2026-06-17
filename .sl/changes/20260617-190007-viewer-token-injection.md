---
id: "20260617-190007"
title: token inyectado en HTML via .replace() raw — escape de contexto posible
type: bug
status: done
created: 2026-06-17T19:00:07Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
---

## Request

`serveIndex` en `router.mjs:63` inyecta el write token directamente en el HTML con
`.replace('__SL_TOKEN_VALUE__', token)`. El token actual es `hex(32)` y es seguro,
pero el contrato de la función no garantiza el formato del token. Si el formato
cambia (ej. base64, UUID con guiones), un token que contenga `</script>` o comillas
podría escapar del contexto `<script>` del index.html, rompiendo la CSP o introduciendo
XSS reflexivo.

## Investigation

`src/viewer/server/router.mjs:60-65`:

```js
function serveIndex(res, token) {
  const html = fs
    .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    .replace('__SL_TOKEN_VALUE__', token);    // sin sanitizar
  send(res, 200, MIME['.html'], html);
}
```

`src/commands/view.mjs:15`:
```js
const token = crypto.randomBytes(16).toString('hex');
```

El token hex es seguro (`[0-9a-f]{32}`). Pero el punto de inyección es frágil:
`JSON.stringify("</script>")` produce `"</script>"` — el navegador cierra el tag
`<script>` al encontrar `</script>` literal, incluso dentro de un string JS. El
escaping correcto requiere serializar Y escapar `<` y `>` como escapes Unicode:

```js
// INCORRECTO — </script> todavía cierra el tag:
.replace('__SL_TOKEN_VALUE__', JSON.stringify(token))

// CORRECTO — < y > quedan como < / >, nunca cierran el tag:
const safeToken = JSON.stringify(token)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e');
.replace('__SL_TOKEN_VALUE__', safeToken)
```

O más simple: validar en `view.mjs` que el token es estrictamente hex antes de
pasarlo, para que `serveIndex` no necesite defenderse de su propio caller.

La solución correcta combina ambas: token hex-only en generación + escape Unicode
en inyección (defensa en profundidad).

## Specification

### CR1 — Inyección usa escape Unicode para < y >
- **Given** `serveIndex` inyecta el token en el HTML vía `<script>`
- **When** el token contiene `<` o `>`
- **Then** el HTML resultante contiene `\u003c`/`\u003e` en lugar de los literales `<`/`>`
- **And** el tag `<script>` no puede ser cerrado por el valor del token

### CR2 — index.html usa placeholder compatible con el nuevo reemplazo
- **Given** `index.html` tiene `window.__SL_TOKEN__ = __SL_TOKEN_VALUE__` en JS inline
- **When** se aplica el reemplazo con el valor escapado
- **Then** el JS resultante es sintácticamente válido y `window.__SL_TOKEN__` tiene el valor correcto

### CR3 — Test verifica que el valor del token no produce `</script>` literal en el body del script
- **Given** un token que contiene `</script>`
- **When** se llama `serveIndex`
- **Then** el cuerpo del bloque `<script>` (el contenido antes del tag de cierre real `</script>`) no contiene la secuencia `</script>` literal
- **Note** el HTML sí tiene un `</script>` al final — es el cierre legítimo; la verificación aplica solo al valor inyectado dentro del body

## Plan

- [x] Actualizar `serveIndex` en `src/viewer/server/router.mjs` para usar escape Unicode: `JSON.stringify(token).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')`, verificar con `test/view.test.mjs` (CR1, CR2) — 2026-06-17T20:27:08Z
- [x] Agregar test en `test/view.test.mjs`: token `x</script>x` → extraer body del `<script>` (todo antes del último `</script>`) y verificar que no contiene `</script>` literal en `src/viewer/server/router.mjs` (CR3) — 2026-06-17T20:27:08Z
- [x] Correr `pnpm test -- test/view.test.mjs` para confirmar `src/viewer/server/router.mjs` sin regresiones (CR1, CR2, CR3) — 2026-06-17T20:27:08Z

## Log

- **2026-06-17T19:00:07Z** — Detectado en auditoría. Token actual (hex) es seguro, pero el contrato es frágil. Fix preventivo antes de que el formato cambie.
- **2026-06-17T20:04:27Z** — status: draft → approved
- **2026-06-17T20:24:15Z** — status: approved → in-progress
- **2026-06-17T20:24:15Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T20:27:09Z** — status: in-progress → in-review
- **2026-06-17T20:27:33Z** — review → done (delegated subagent, clean context)
- **2026-06-17T20:27:34Z** — graduado a spec `architecture.md`
