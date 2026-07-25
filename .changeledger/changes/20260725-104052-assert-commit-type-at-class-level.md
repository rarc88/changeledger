---
id: "20260725-104052"
title: Clasificar el tipo de objeto en todo resolvedor de autoridad y baseline
type: bug
status: in-progress
created: 2026-07-25T10:40:52Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260724-212722", "20260723-235910", "20260725-013425"]
release_impact: patch
---

## Request

La cuarta ejecución del audit `20260721-193106` reprodujo tres fallos con una
sola causa raíz: **el tipo de objeto se «verifica» pelando en vez de asertando.**

- **MIG-04, crítico.** Un tag anotado apuntado a mano como ref pública de estado
  en un remoto se convierte en el `baseline` del estado y llega committeado a
  `.changeledger/authority.yml`, en sha1 y en sha256. Reproducido end-to-end por
  API pública.
- **MIG-05, alto.** El mismo tag anotado nombrado como fuente de migración
  produce un OID y un `inventory_digest` distintos según se pida por
  `local:<ref>` o por `origin:<ref>`. No requiere corrupción alguna: basta un tag
  de release ordinario. Rompe el determinismo que `state migrate --preview`
  promete.
- **AUTH-12, medio, pre-existente.** Un tree escrito en `refs/changeledger/activation`
  se sirve como repo sano: `list` y `state status` responden con normalidad y
  `exportStateRecovery` materializa una rama de recovery desde una autoridad
  leída de un objeto que no es commit. `install` y `deactivate` sí rechazan, así
  que los resolvedores discrepan entre sí.

`20260724-212722` cerró este mismo defecto **en un solo sitio** —el tip fetched de
la réplica en `syncStateReplica` y `abortStatePending`— y lo dio por resuelto. El
crítico de hoy es la factura de ese cierre parcial. El techo de alcance
`20260725-013425` escribió la regla que lo prohíbe: un defecto se cierra a nivel
de clase, en todos los sitios donde vive, o no se cierra. Este change la aplica.

## Investigation

El defecto no es un olvido puntual: son dos semánticas distintas colapsadas en
una sola herramienta. `exactCommit` (`src/state-migration.mjs:121-125`) valida con
`rev-parse --verify <ref>^{commit}`, que **pela** tags anotados, y devuelve el
commit pelado. Tres llamadores **descartan** ese valor y conservan el OID crudo:

| Sitio | Qué conserva | Consecuencia |
| --- | --- | --- |
| `observeSource`, rama remota (`src/state-migration.mjs:165` y `:172`) | el OID de `ls-remote`, sin pelar | MIG-05: la rama local en `:153` sí usa el valor pelado, así que las dos rutas discrepan |
| `fetchRef` (`src/state-migration.mjs:957`) | `return oid` | MIG-04: `createStateBaseline:996-1002` adopta ese OID como `baseline` |
| `readStateMetadata` (`src/state-migration.mjs:1143`) | `revision`, y `ls-tree` vuelve a pelar | por eso la escalada a `authority.yml` no se caza |

Los llamadores que sí conservan el valor pelado son `:153`, `:1321`, `:1404`,
`:1494`, `:1685`, `:1792` y `:1926`.

Un cuarto sitio no usa `exactCommit` en absoluto:
`activationCommitOid` (`src/ledger-store.mjs:258-260`) devuelve `optionalRefOid`
sin peel y sin comprobación de tipo. `activationAuthority:265-268` lee después
`cat-file blob <oid>:.changeledger/authority.yml`, que resuelve para un **tree** y
falla para un **blob**: los blobs se salvan por accidente de la fontanería, no por
guard. El resolvedor equivalente de la ruta de migración,
`resolveActivationCommitOrNull` (`src/state-migration.mjs:1737-1762`), sí aserta con
`state activation ref refs/changeledger/activation must point to a commit`. Los dos
resolvedores de autoridad discrepan, y el comentario de `assertCommitTip`
(`src/state-store.mjs:164`) afirma paridad con una clasificación que el resolvedor
de lecturas no tiene.

**La distinción que faltaba.** Hay dos situaciones y exigen respuestas opuestas:

1. **Una ref que nombra un humano** (`--source local:refs/tags/v1`). Pelar es lo
   que un usuario de git espera: pedir el ledger tal como estaba en un release es
   intención legítima. El requisito real es que **las dos rutas pelen igual**.
2. **Una ref que el sistema lee como su propia verdad** (la ref pública de
   estado, un baseline, la activation ref). Aquí un objeto que no es commit es
   estado inválido, nunca verdad adoptable — la clasificación que
   `20260724-212722` ya aplicó al tip de la réplica y que `20260723-235910` aplicó
   a la activation ref en la ruta de migración.

El defecto fue conflar las dos. Este change las separa y aplica cada una en todos
sus sitios.

## Specification

### CR1 — Una fuente de migración que nombra un tag anotado registra su commit, por las dos rutas

- **Given** un repo legacy con un remoto configurado y un tag anotado `refs/tags/v1`
  sobre el commit `C` de la rama de integración
- **When** se ejecuta `previewStateMigration` con `sources: ['local:refs/tags/v1']`
  y, por separado, con `sources: ['origin:refs/tags/v1']`
- **Then** ambos planes registran `sources[0].commit === C` (el commit, no el OID
  del tag) y cada `documents[].candidates[].commit` vale también `C`
- **And** los dos planes son idénticos salvo en los campos que nombran la fuente
  —`sources[].name`, `sources[].kind`, `sources[].remote` y el `source` de cada
  candidato— y en el `inventory_digest`, que los cubre

  **Corrección de este criterio durante la implementación (2026-07-25):** su
  primera redacción exigía además el mismo `inventory_digest` por las dos rutas.
  Es imposible y no debe cumplirse: el digest cubre `sources` verbatim
  (`migrationInventory`, `src/state-migration.mjs:556-567`), incluidos `name`,
  `kind` y `remote`, y cada candidato lleva su `source`. Nombrar la misma fuente
  por dos rutas es procedencia distinta, y registrarla así es correcto. La
  redacción original trasladó la frase del audit («OID e inventory_digest
  distintos») a un criterio sin comprobar qué parte de esa diferencia era el
  defecto: lo era el OID, no el digest. Verificado empíricamente antes de
  corregir.

### CR2 — La ref pública de estado no adopta un objeto que no sea commit

- **Given** un remoto cuya `refs/heads/changeledger/state` fue apuntada a mano a un
  tag anotado, un blob o un tree
- **When** se ejecuta `state migrate --create --plan <plan>`
- **Then** falla con `state baseline ref refs/heads/changeledger/state must point to a commit`
  antes de escribir cualquier ref u objeto local
- **And** `.changeledger/authority.yml` no se crea ni se modifica, y no se crea
  ninguna rama de activación

### CR3 — `activate --prepare` rechaza un baseline publicado que no sea commit

- **Given** la misma corrupción remota y un `--baseline <oid>` que apunta al tag
- **When** se ejecuta `state activate --prepare --baseline <oid>`
- **Then** falla con el mismo diagnóstico de CR2, no con
  `published state baseline is <x>, expected <y>`
- **And** no se crea la rama `changeledger/activate-<prefix>`

### CR4 — El resolvedor de lecturas clasifica la activation ref

- **Given** un repo con réplica v2 activada cuya `refs/changeledger/activation` se
  reescribe a mano al OID de un tree
- **When** se ejecuta cualquier lectura (`changeledger list`, `changeledger state status`)
- **Then** falla con `state activation ref refs/changeledger/activation must point to a commit`,
  el mismo mensaje que ya emiten `install` y `deactivate`
- **And** ninguna lectura sirve un snapshot ni reporta el repo como sano

### CR5 — La recovery no se materializa desde una autoridad no-commit

- **Given** el repo de CR4 con la activation ref apuntando a un tree
- **When** se ejecuta `state export --recovery-branch`
- **Then** falla con el diagnóstico de CR4
- **And** no existe ninguna ref `refs/heads/changeledger/recover-*`

### CR6 — La procedencia no se resuelve desde un objeto no-commit

- **Given** el repo de CR4, y además una variante donde la activation ref apunta a
  un tree forjado con `git mktree` que no está contenido en ningún commit, rama ni tag
- **When** se emite cualquier receipt del CLI que lleve procedencia (por ejemplo
  `changeledger check`)
- **Then** falla con el diagnóstico de CR4 en lugar de devolver el `project_id`
  leído de ese objeto

### CR7 — Un blob y un tag en la activation ref reciben el mismo trato que un tree

- **Given** el repo de CR4 con la activation ref apuntando a un blob, y otra
  variante apuntando a un tag anotado sobre el commit de autoridad
- **When** se ejecuta una lectura
- **Then** el blob falla con el diagnóstico de CR4, no con
  `state authority is unavailable: ... has no readable .changeledger/authority.yml`
- **And** el tag anotado resuelve por peel explícito al commit de autoridad y la
  lectura funciona con normalidad, conservando el OID directo en las transacciones CAS

### CR8 — Los tips y baselines legítimos no se ven afectados

- **Given** un ciclo completo sobre un remoto honesto: `migrate --preview`,
  `--create`, `activate --prepare`, `--install`, `sync`, una mutación, `sync`,
  `export --recovery-branch` y `activate --deactivate`, en sha1 y en sha256
- **When** se ejecuta cada paso
- **Then** el comportamiento actual se conserva sin cambios, incluidos los OIDs
  publicados y el `inventory_digest`

## Plan

- [x] Añadir un test rojo por ruta que cubra CR1 (tag anotado como fuente por `local:` y por `origin:`, mismo commit y mismo digest) y hacerlo pasar conservando el valor pelado de `exactCommit` en la rama remota de `observeSource` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR1)
  - **Resolved:** `2026-07-25T10:55:44Z`
- [ ] Añadir tests rojos para CR2 y CR3 con la loose ref del remoto reescrita a mano hacia tag, blob y tree, y hacerlos pasar asertando el tipo commit del tip fetched de la ref pública de estado en `src/state-migration.mjs` (`fetchRef` y `readStateMetadata`) antes de cualquier escritura; verify: `node --test test/state-migration.test.mjs` (CR2, CR3)
- [ ] Añadir tests rojos para CR4, CR5, CR6 y CR7 y hacerlos pasar clasificando el tipo en `activationCommitOid` de `src/ledger-store.mjs` con la misma resolución en dos etapas que `resolveActivationCommitOrNull`, reusando su diagnóstico exacto; verify: `node --test test/ledger-store.test.mjs test/state-migration.test.mjs` (CR4, CR5, CR6, CR7)
- [ ] Reconciliar el comentario de `assertCommitTip` en `src/state-store.mjs`, que hoy afirma paridad con una clasificación que el resolvedor de lecturas no tenía; verify: `node --test test/state-store.test.mjs` (support)
- [ ] Anclar CR8 con el ciclo completo en ambos formatos de objeto y verificar por mutación sobre `src/state-migration.mjs`, `src/ledger-store.mjs` y `src/state-store.mjs` que retirar cualquiera de las cuatro clasificaciones rompe exactamente su propio test; verify: `pnpm verify` y `node --test test/state-migration.test.mjs` (CR8)

## Log

- **2026-07-25T10:40:52Z** `[note]` Draft creado desde los hallazgos MIG-04 (crítico), MIG-05 (alto) y AUTH-12 (medio) de la cuarta ejecución del audit `20260721-193106`, y bajo la regla de cierre por clase del techo `20260725-013425`. La superficie se inventarió con un delegado de solo lectura antes de escribir este documento: los cuatro sitios del defecto son `observeSource` rama remota (`state-migration.mjs:165`,`:172`), `fetchRef` (`:957`), `readStateMetadata` (`:1143`) y `activationCommitOid` (`ledger-store.mjs:258-260`), y los cuatro **sobreviven** al recorte de fuentes múltiples, así que este change no depende de él. Corrección de la ordenación propuesta antes en conversación: se creía que asertar antes del recorte era trabajo tirado, lo que era una suposición sin verificar. Además, pelar de forma consistente en las dos rutas de `observeSource` cierra MIG-05 sin necesidad de quitar fuentes múltiples, así que el recorte queda justificado por reducción de complejidad y no por cierre de defectos.
- **2026-07-25T10:48:30Z** `[status]` draft → approved
- **2026-07-25T10:50:27Z** `[status]` approved → in-progress
- **2026-07-25T10:50:27Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-25T10:55:44Z** `[note]` CR1 cerrado. observeSource conserva ahora el valor pelado de exactCommit en la rama remota: el OID crudo de ls-remote se retiene solo como 'tip' para la comprobación de drift contra lo que el remoto publica, mientras la fuente se registra por su commit pelado, igual que ya hacía la rama local. recordSourceActivity se llama dos veces por diseño: antes del fetch con el OID observado, para que un receipt de fallo conserve evidencia, y de nuevo tras pelar con éxito, ya que hace upsert por nombre. Corregido el propio CR1 durante la implementación: exigía el mismo inventory_digest por las dos rutas, lo cual es imposible y además incorrecto porque el digest cubre sources verbatim con name, kind y remote, y cada candidato lleva su source. Verificado empíricamente que los dos planes son idénticos salvo esos campos de nombrado, y el test ancla eso además de asertar que los digests SÍ difieren, para que nadie 'arregle' esa diferencia en el futuro. Suite de migración completa: 79/79.
