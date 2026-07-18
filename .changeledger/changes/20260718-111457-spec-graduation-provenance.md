---
id: "20260718-111457"
title: Registrar la procedencia estructurada de las specs
type: bug
status: in-progress
created: 2026-07-18T11:14:57Z
depends_on: []
owner: Roberto Ruiz

---

## Request

Las specs deberían conservar una relación navegable con cada change que graduó
verdad persistente hacia ellas. El formato histórico expresa esa procedencia
mediante frases `Graduado del change <id>` dentro del cuerpo Markdown. Además de
mezclar metadatos con prosa, el flujo actual `--new` → refinar → `--into` dejó de
crear esas frases, por lo que el viewer muestra `Graduation history` vacío aunque
los Logs de los changes registren la graduación.

Representar la procedencia como datos estructurados, restaurar la escritura
bidireccional y ofrecer una migración determinista para repositorios existentes.

## Investigation

- `checkSpecs()` afirma que una graduación deja dos marcadores: el Log del change
  contiene `graduado a spec \`<file>\`` y el cuerpo de la spec contiene
  `Graduado del change <id>`. Sin embargo, considera suficiente cualquiera de
  los dos para que la spec no sea huérfana y no valida que ambos coincidan.
- `splitGraduationHistory()` reconoce únicamente blockquotes consecutivos al
  inicio de la spec. El viewer renderiza sus contenidos como strings y no puede
  resolver metadatos ni navegar al change.
- El change `20260630-191857` separó la creación mecánica (`--new`) de la
  finalización (`--into`). El scaffold sustituyó el backlink durable por
  `Scaffold from change <id>`, mientras `--into` quedó limitado a actualizar
  `updated`, escribir el Log del change y fijar `reviewed: true`.
- El comentario de `graduate()` todavía dice que `--into` “links it back”, pero
  `setSpecUpdated()` solo reemplaza `updated`; la intención documentada y el
  comportamiento divergen desde el commit `036a97aae`.
- La reproducción con ChangeLedger 0.12.0 confirma el alcance:
  `backend-laravel` tiene 34 specs y 88 changes con marcador de graduación, pero
  0 specs con backlink; `ranchops` tiene 13 specs y 22 changes graduados, también
  con 0 backlinks. `changeledger check` no reporta esa asimetría.
- `related_to` no es adecuado para esta procedencia: expresa afinidad no
  bloqueante entre changes, mientras la graduación es una relación dirigida y
  auditable entre un change y la spec cuya verdad actualizó.

## Specification

### CR1 — Persistir procedencia estructurada al finalizar
- **Given** un change `A` en `done` y una spec refinada `architecture.md` sin `graduated_from`
- **When** se ejecuta `changeledger graduate A architecture --into`
- **Then** el frontmatter de la spec contiene `graduated_from: ["A"]`
- **And** `updated` se refresca, el cuerpo durable no cambia y el Log de `A` registra `graduado a spec \`architecture.md\``

### CR2 — Acumular graduaciones sin duplicados
- **Given** una spec con `graduated_from: ["A"]` y un segundo change `B` en `done`
- **When** se gradúa `B` hacia esa spec dos veces por una reejecución equivalente
- **Then** el frontmatter queda `graduated_from: ["A", "B"]`
- **And** cada id aparece una sola vez y conserva el orden cronológico de graduación

### CR3 — Mantener el scaffold pendiente sin afirmar procedencia
- **Given** un change `A` en `done` sin decisión de graduación
- **When** se ejecuta `changeledger graduate A architecture --new`
- **Then** el scaffold contiene `graduated_from: []`
- **And** no contiene `A` hasta que la spec se refine y finalice con `--into`

### CR4 — Validar el tipo y los dos sentidos del enlace
- **Given** un repositorio con changes y specs
- **When** `graduated_from` no es una lista, contiene un id inexistente, omite un change cuyo Log gradúa a esa spec o incluye un change cuyo Log apunta a otra spec
- **Then** `changeledger check` falla respectivamente con `graduated_from must be a list`, `graduated_from references missing change "<id>"`, `spec "<file>" missing graduated_from "<id>"` o `graduated_from "<id>" does not link back to spec "<file>"`

### CR5 — Migrar marcadores históricos y enlaces ausentes
- **Given** una spec con blockquotes `Graduado del change A` y `Graduado del change B`, más un change `C` cuyo Log gradúa a esa spec pero sin blockquote
- **When** se ejecuta `changeledger fix --graduation-links`
- **Then** la spec contiene `graduated_from: ["A", "B", "C"]`, ordenado por los timestamps de graduación disponibles
- **And** elimina los blockquotes históricos que ya fueron representados en el frontmatter
- **And** conserva sin cambios el resto del cuerpo durable

### CR6 — Previsualizar la reparación sin escribir
- **Given** un repositorio con enlaces históricos pendientes de migración
- **When** se ejecuta `changeledger fix --graduation-links --dry-run`
- **Then** la salida muestra el diff exacto de cada spec afectada
- **And** ningún archivo cambia

### CR7 — Fallar ante historia ambigua
- **Given** un blockquote histórico que referencia un change existente cuyo Log no identifica esa spec y no existe otro marcador que determine el destino
- **When** se ejecuta `changeledger fix --graduation-links`
- **Then** esa entrada no se elimina ni se convierte silenciosamente
- **And** el comando falla indicando la spec y el id que requieren decisión manual

### CR8 — Retirar el protocolo basado en frases
- **Given** un repositorio ya migrado
- **When** el checker y el viewer cargan sus specs
- **Then** obtienen la procedencia exclusivamente de `graduated_from`
- **And** no buscan `Graduado del change` en el cuerpo Markdown
- **And** los contextos de cierre documentan `graduated_from` como enlace canónico

## Plan

- [ ] Escribir primero tests del writer y de graduación, añadir `graduated_from: []` al scaffold y actualizarlo idempotentemente en `src/commands/graduate.mjs` y `src/writer.mjs`; verify: `node --test test/graduate.test.mjs test/writer.test.mjs` (CR1, CR2, CR3)
- [ ] Escribir primero tests bidireccionales y endurecer `checkSpecs()` en `src/check.mjs`; verify: `node --test test/check.test.mjs` (CR4)
- [ ] Escribir primero fixtures de migración y extender `src/commands/fix.mjs` y `bin/changeledger.mjs` con `fix --graduation-links [--dry-run]`; verify: `node --test test/fix.test.mjs test/cli-bin.test.mjs` (CR5, CR6, CR7)
- [ ] Retirar el parser de frases en `src/viewer/public/view-parts.js`, exponer `graduated_from` desde `src/viewer/domain.mjs` y actualizar `templates/contract/close.md`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs test/context.test.mjs` (CR8)
- [ ] Migrar `.changeledger/specs/**` con `changeledger fix --graduation-links`; verify: `node bin/changeledger.mjs check` (CR5, CR8)
- [ ] Ejecutar el gate completo `pnpm verify` (support)

## Log

- **2026-07-18T11:14:57Z** — Draft autorizado por el humano tras confirmar la regresión en `backend-laravel` y `ranchops`; se elige `graduated_from` por su semántica dirigida en lugar de sobrecargar `related_to`.
- **2026-07-18T11:18:35Z** — status: draft → approved
- **2026-07-18T11:20:04Z** — status: approved → in-progress
- **2026-07-18T11:20:04Z** — owner → Roberto Ruiz (auto)
