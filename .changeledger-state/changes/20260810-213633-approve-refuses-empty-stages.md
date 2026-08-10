---
id: "20260810-213633"
title: approve rechaza stages activas vacías
type: quick
status: approved
created: 2026-08-10T21:36:33Z
depends_on: []
related_to: ["20260810-181801"]
owner: rarc88
---

## Request

Hallazgo del cierre de la costura de autoría: `changeledger approve`
aceptó un feature con Investigation/Proposal/Specification/Plan vacíos — la
severidad `approved` valida estructura, no contenido de stages. Un feature
aprobado con spec vacío no puede gobernar implementación ni review (fue la
causa del descarte de `20260810-181801`).

`approve` (y la misma puerta en el viewer) debe rechazar un draft cuyas
stages activas verificables (Specification y Plan al menos; decidir si
Investigation/Proposal también) estén vacías, nombrando las secciones y sin
mover el status. Los quicks (solo Request) no cambian: su Request vacío ya
debería rechazarse igual — verificar y pinear ese borde de paso.

## Log
- **2026-08-10T21:38:10Z** `[status]` draft → approved (human via conversation)
