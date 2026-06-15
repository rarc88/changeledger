---
id: "20260614-192815"
title: Confinar el visor a localhost y proteger su API de escritura
type: bug
status: approved
created: 2026-06-14T19:28:15Z
depends_on: []
---

## Request

Convertir `sl view` en un servicio realmente local y reducir la capacidad de
sitios externos o clientes no autorizados para leer repositorios o modificar
changes mediante su API HTTP.

## Investigation

- `server.listen(port)` no especifica host; Node escucha por defecto en una
  dirección no restringida a loopback cuando la plataforma lo permite.
- Los endpoints exponen rutas absolutas, contenido completo de changes/specs,
  resultados de búsqueda e historial Git de todos los repos registrados.
- `POST /api/status` escribe en el repositorio y no valida `Origin`, token de
  sesión ni otro secreto por proceso.
- El body del POST se acumula sin límite, y el servidor no define límites o
  timeouts defensivos propios.
- El fallback `projects.find(...) ?? projects[0]` permite que un identificador
  de proyecto desconocido actúe sobre el primer proyecto registrado; una API de
  escritura debe exigir un match exacto.

## Specification

### CR1 — Solo loopback
- **Given** que ejecuto `sl view`
- **When** el servidor comienza a escuchar
- **Then** queda enlazado explícitamente a `127.0.0.1` o `::1`
- **And** la URL impresa coincide con el host utilizado

### CR2 — Escritura ligada a la sesión
- **Given** un servidor del visor en ejecución
- **When** un cliente llama `POST /api/status` sin la credencial efímera de esa
  sesión o desde un origen no permitido
- **Then** recibe `403`
- **And** ningún archivo cambia

### CR3 — Proyecto exacto
- **Given** un payload con un `project` inexistente
- **When** llama `POST /api/status`
- **Then** recibe `404`
- **And** no se usa el primer proyecto como fallback

### CR4 — Body acotado
- **Given** un body mayor al límite documentado
- **When** se envía a `POST /api/status`
- **Then** el servidor responde `413`
- **And** cierra o drena la request sin acumularla indefinidamente

### CR5 — Lecturas locales endurecidas
- **Given** una request a la API
- **When** el host u origen no pertenece al visor local
- **Then** se rechaza según la política documentada
- **And** las respuestas incluyen headers defensivos apropiados para la UI local

## Plan

- [ ] Enlazar el servidor explícitamente a loopback y cubrir selección/reintento de puerto — `src/commands/view.mjs`, tests del visor (CR1)
- [ ] Generar una credencial efímera por proceso y exigirla junto con validación de origen en escrituras — `src/commands/view.mjs`, `src/viewer/public/app.js` (CR2)
- [ ] Eliminar fallbacks ambiguos de proyecto en endpoints con efectos y devolver errores exactos — `src/commands/view.mjs` (CR3)
- [ ] Limitar body, configurar timeouts y añadir headers de seguridad sin romper los assets locales — `src/commands/view.mjs` (CR4, CR5)
- [ ] Añadir tests HTTP de acceso autorizado/no autorizado y ausencia de escrituras ante rechazo — `test/view.test.mjs` (CR1, CR2, CR3, CR4, CR5)
- [ ] Actualizar la arquitectura y ejecutar `pnpm verify` (CR1, CR2, CR4, CR5)

## Log
- **2026-06-15T11:38:40Z** — status: draft → approved
