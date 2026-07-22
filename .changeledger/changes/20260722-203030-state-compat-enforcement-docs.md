---
id: "20260722-203030"
title: Documentar compatibilidad de cliente y alcance del enforcement
type: chore
status: draft
created: 2026-07-22T20:30:30Z
depends_on: []
related_to: ["20260721-193106", "20260722-202057"]
release_impact: none
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (fila UPG-4) encontró
tres huecos en la documentación operacional del estado global: dos medios por
riesgo de falsa confianza y uno LOW de recuperación:

1. `minimum_client_version` no está documentado: un operador que ve `state
   authority requires client >= X` no tiene referencia de qué significa ni cómo
   resolverlo (actualizar el CLI).
2. El README afirma que «Remote protection deliberately rejects a normal push
   that removes `.changeledger/authority.yml`», lo que sugiere que el tampering
   de authority está universalmente bloqueado. Falta el matiz: esa protección es
   de ámbito push/hook, no local — editar/revertir `authority.yml` en un clon es
   posible (el fix de comportamiento es `20260722-202057`; este chore documenta
   el alcance).
3. Si `state migrate --create` publica el baseline remoto pero el operador
   aborta antes del cutover, no existe un procedimiento documentado para
   verificar que authority sigue sin activar, resolver dependencias y eliminar
   de forma segura la ref remota huérfana sin tocar una réplica ya activada.

## Plan

- [ ] Documentar en `README.md` (sección Shared state replica) el significado de `minimum_client_version`, el mensaje de rechazo y su resolución; verify: `changeledger check` y revisión de la sección renderizada (support)
- [ ] Documentar en la misma sección el alcance real de la protección de authority (push/hook sí, local no) enlazando el runbook de recuperación; verify: `changeledger check` y revisión de la sección renderizada (support)
- [ ] Añadir al runbook el cleanup pre-cutover de un baseline remoto publicado: precondiciones verificables, ref y OID exactos, rechazo si authority ya está activa, borrado remoto explícito y comprobación posterior; verify: `changeledger check` y ensayo manual sobre un remoto bare desechable (support)

## Log

- **2026-07-22T20:30:30Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106 (fila UPG-4 de la ejecución paralela); el fix de comportamiento del downgrade local es 20260722-202057, este chore cubre solo la documentación del alcance.
- **2026-07-22T20:41:30Z** `[note]` Se incorpora el séptimo hallazgo LOW: cleanup seguro del baseline remoto publicado cuando el cutover se aborta antes de activar authority.
