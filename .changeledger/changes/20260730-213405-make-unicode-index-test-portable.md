---
id: "20260730-213405"
title: Hacer portable la prueba Unicode del índice
type: bug
status: approved
created: 2026-07-30T21:34:05Z
depends_on: []
related_to: ["20260726-141124"]
owner: rarc88
release_impact: none
---

## Request

Corregir la prueba del guard del índice que falla en Ubuntu al comparar una
ruta `changes_dir` no ASCII. La prueba debe verificar el diagnóstico
byte-exacto que corresponde a la entrada staged devuelta realmente por Git,
sin cambiar ni debilitar el comportamiento de producción.

## Investigation

El change relacionado `20260726-141124` endureció el commit para leer el índice
con una invocación fijada y conservar sus rutas como entrada opaca. Producción
ya cumple ese contrato: en Ubuntu Git entrega
`.changeledger/cambio\u0301s/20260711-999999-x.md`, `commit()` detecta el
documento ajeno y lanza el error esperado con esa secuencia NFD intacta.

El fallo está en `CR10 (20260726-141124): a non-ASCII changes_dir keeps the
boundary byte-exact`. El fixture crea `changes_dir` en NFD pero su predicado de
`assert.throws` exige una ruta NFC fija. En macOS `git init` configura
`core.precomposeunicode=true` y el índice devuelve NFC, mientras que Ubuntu
conserva los bytes NFD; por eso la excepción correcta no satisface el
predicado. La spec `git-traceability` exige normalizar únicamente cadenas
derivadas por la herramienta, nunca la entrada de Git.

## Specification

### CR1 — Expectativa derivada del índice real
- **Given** el test crea un `changes_dir` no ASCII y añade un documento ajeno al índice
- **When** Git devuelve las rutas staged mediante la misma invocación fijada que usa producción
- **Then** el test selecciona la ruta terminada en `20260711-999999-x.md`
- **And** exige que el error de `commit()` reproduzca exactamente esa ruta staged, sin normalizarla

### CR2 — El guard continúa abortando sin crear commit
- **Given** el índice contiene el documento ajeno bajo el `changes_dir` no ASCII
- **When** se invoca `commit()` para otro change declarado
- **Then** la operación falla con `Staged path(s) under the changes directory not declared for this commit: <ruta staged> (declared: 20260711-000001)`
- **And** el repositorio conserva el mismo número de commits

## Plan

- [ ] Derivar la expectativa Unicode desde la salida staged fijada y probar el aborto byte-exacto
  - **Target:** `test/commit.test.mjs`
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Ejecutar el gate completo después de la corrección
  - **Support:**
  - **Verify:** `pnpm verify`

## Log

- **2026-07-30T21:34:05Z** `[note]` Draft creado tras reproducir que macOS entrega NFC por `core.precomposeunicode=true` y Ubuntu conserva NFD; producción aborta correctamente en ambos casos y la expectativa fija del test es la única parte no portable.
- **2026-07-30T21:37:57Z** `[status]` draft → approved (human via conversation)
