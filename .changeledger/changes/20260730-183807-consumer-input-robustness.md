---
id: "20260730-183807"
title: "El CLI ante entrada de consumidor: errores nombrados, sin reescrituras silenciosas"
type: bug
status: in-validation
created: 2026-07-30T18:38:07Z
depends_on: []
related_to:
  - "20260729-162616"
  - "20260730-002341"
owner: raruiz-hiberuscom
---

## Request

CH-7 de la iniciativa de endurecimiento, reactivado por la decisión de Roberto
(2026-07-30): si todo cierra hoy, hay release — y este change es exactamente
robustez de cara al repo consumidor. Seis defectos catalogados hace días y
**re-verificados hoy contra HEAD con reproducción literal en fixtures** (los
seis viven). Clase común: ante entrada con forma de consumidor, el CLI o
revienta con un error crudo que no nombra la causa, o reescribe ficheros del
consumidor sin avisar.

Excluidos con nombre, no cubiertos por este change: (a) documentar
`fix --plan-tags`/`--structured-sections` en el contrato servido — change
propio, prosa de contrato, no `src/`; (b) el narrowing (b) de `162616 CR7`
(warnings nuevos de menciones para `done`-sin-archivar y `archived` bajo
status abierto) — es comportamiento intencional ya registrado; su sede es la
nota de release, no un fix.

## Investigation

Investigación delegada fresca (2026-07-30), cada defecto reproducido en
fixture desechable con salida literal; sedes citadas por símbolo.

1. **`config migrate` re-indenta un comentario ajeno.** Con
   `git.integration_branch` vacío, `# Valid lifecycle statuses (order =
   progress)` gana 4 espacios. Aislado el disparador: con `integration_branch:
   main` no ocurre — es una rareza del stringify completo
   (`doc.toString({ lineWidth: 0, … })` en `src/config-migration.mjs`) ante un
   escalar nulo previo en el documento.
2. **`register` calcula `replaced` y solo avisa en `updated`.**
   `replaceDelimited` (`src/contract.mjs`) computa `replaced` cuando el bloque
   ya está en `BOOTSTRAP_VERSION` pero difiere del `REFERENCE`;
   `ensureReference` escribe para todo estado salvo `unchanged`/`equivalent`;
   `src/commands/register.mjs` solo `warn` en `updated`. Reproducido
   end-to-end: `AGENTS.md` de consumidor con bloque v4 manipulado →
   `registerRepo()` lo reescribe, warnings emitidos: `[]`.
3. **La migración 3→4 deja el bloque `# readiness:` comentado de la plantilla
   vieja** junto al vivo. `addReadinessSection` (`src/config-migration.mjs`)
   solo comprueba `doc.has('readiness')` (clave viva); no existe lógica que
   detecte o retire el bloque comentado. Reproducido con la plantilla
   pre-`da84722c` degradada a schema 3: tras migrar, `# readiness:` y
   `readiness:` conviven con valores idénticos. La decisión ya está tomada
   (Roberto, 2026-07-28, hallazgo 23): se retira cuando coincide verbatim con
   el texto que envió la plantilla; se conserva si el usuario lo tocó.
4. **`loadRepo` revienta crudo con formas de consumidor.** Un directorio con
   nombre de documento → `EISDIR: illegal operation on a directory, read`
   (lectura sin guarda en `loadRepoWithConfig`, `src/repo.mjs`); un symlink a
   fichero sin frontmatter → `Change is missing its frontmatter block` sin
   nombrar el path (`parseChange`, `src/change.mjs`). Ambos reproducidos.
5. **`changes_dir: "."` revienta antes de poder diagnosticarse.** `loadRepo`
   parsea todo `*.md` de raíz y muere con `Change is missing its frontmatter
   block` ante cualquier markdown normal (`AGENTS.md` incluido). Y el abort
   que `162616 CR9` puso en el guard de commit **es inalcanzable en el caso
   realista**: `commit.mjs` llama `loadRepo(cwd)` antes de su propia
   comprobación del prefijo colapsado — reproducido con `changeledger commit`
   real: sale `Change is missing its frontmatter block`, nunca el mensaje de
   CR9.
6. **`changeledger log <id> "[note] …"` duplica el prefijo.**
   `serializeLogEvent` (`src/lifecycle.mjs`) compone `` `[note]` `` y antepone
   el mensaje verbatim → `` `[note]` [note] this is a manual note ``.
   Reproducido por CLI.

Relacionados: `20260729-162616` (su CR9 puso el abort del guard de commit que
el punto 5 vuelve alcanzable), `20260730-002341` (última cirugía sobre la
atribución, superficie adyacente a `commit.mjs`). Cerrados → `related_to`.

## Specification

### CR1 — Migrar la config no reescribe lo que no migra
- **Given** una config schema 3 con `git.integration_branch` vacío y el
  comentario `# Valid lifecycle statuses (order = progress)` en columna 0
- **When** corre `config migrate`
- **Then** el comentario conserva su indentación original en la salida
  migrada, con `integration_branch` vacío y con valor
- **And** un test de fixture compara la línea del comentario antes y después

### CR2 — Toda reescritura del AGENTS.md del consumidor se anuncia
- **Given** un fichero de contrato del consumidor que `ensureReference` va a
  reescribir — cualquier estado que escribe: `updated`, `replaced`,
  `inserted` o `migrated`
- **When** corre `register`
- **Then** se emite un aviso que nombra el fichero y el estado para cada
  estado que escribe; los estados que no escriben
  (`unchanged`/`equivalent`) siguen en silencio
- **And** el test reproduce al menos `replaced` y uno de
  `inserted`/`migrated` y asserta el aviso, y un mutante que silencia el
  aviso de `replaced` falla

### CR3 — La migración retira el residuo de plantilla y respeta la autoría
- **Given** una config 3→4 que contiene el bloque `# readiness:` comentado
  idéntico verbatim al texto que envió la plantilla vieja
- **When** corre `config migrate`
- **Then** el bloque comentado desaparece y el bloque vivo queda como único
- **And** con el bloque comentado editado por el usuario (cualquier
  divergencia del verbatim de plantilla), la migración lo conserva intacto

### CR4 — loadRepo nombra el path y la causa, nunca un error crudo
- **Given** un `changes_dir` con un directorio cuyo nombre parece documento, o
  con un symlink a un fichero sin frontmatter
- **When** corre cualquier comando que cargue el repo
- **Then** el error nombra el path ofensor y la causa (directorio donde se
  esperaba fichero; documento sin frontmatter, con su path), nunca `EISDIR`
  crudo ni un mensaje sin path
- **And** ambos casos tienen test de fixture con el mensaje literal

### CR5 — El prefijo colapsado se diagnostica antes de reventar
- **Given** una config con `changes_dir: "."` y markdown normal en la raíz
- **When** corre `loadRepo` (directamente o vía `changeledger commit`)
- **Then** aborta nombrando el colapso de `changes_dir` como causa — el
  diagnóstico que `162616 CR9` ya redactó se alcanza también por esta vía, en
  vez de `Change is missing its frontmatter block`
- **And** el test reproduce la vía de `commit` real y asserta que el mensaje
  alcanzado es el del colapso, no el del frontmatter

### CR6 — El prefijo [note] no se duplica en el render
- **Given** `changeledger log <id> "[note] mensaje"`
- **When** se serializa la entrada
- **Then** el render queda `` `[note]` mensaje `` — el prefijo literal
  redundante del principio del mensaje se retira una sola vez al escribir, y
  un mensaje sin ese prefijo se conserva verbatim
- **And** el test cubre ambos casos y el de un `[note]` interior, que se
  conserva

## Plan

- [x] Corregir el re-stringify de la migración y retirar el residuo de
  plantilla respetando la autoría del usuario
  - **Target:** `src/config-migration.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-07-30T19:05:31Z`
- [x] Anunciar el estado replaced al registrar
  - **Target:** `src/commands/register.mjs`
  - **Verify:** `node --test test/register.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T19:05:32Z`
- [x] Errores nombrados en la carga del repo y diagnóstico del prefijo
  colapsado alcanzable
  - **Target:** `src/repo.mjs`
  - **Verify:** `node --test test/repo.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-07-30T19:05:32Z`
- [x] Retirar el prefijo redundante al serializar la nota
  - **Target:** `src/lifecycle.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-07-30T19:05:32Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T19:05:32Z`

## Log
- **2026-07-30T18:42:59Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T18:44:37Z** `[status]` approved → in-progress
- **2026-07-30T19:05:32Z** `[note]` Selección única resuelta (cuatro superficies src acopladas por la clase común y sus cuatro suites). Repro→rojo→verde literal por CR; mutantes explícitos en CR2 y CR6, revert-and-rerun en el resto. El condicional sobre commit.mjs NO disparó: el implementador construyó un changes_dir symlinkeado a '.' sin markdown colisionante en raíz y probó que el guard realpath de commit.mjs sigue siendo el único que lo caza — el guard viejo no es código muerto, queda intacto. Nota de disciplina para el review: el implementador usó git stash para verificar el rojo de CR1 pese al veto de git mutante del prompt; el stash quedó vacío y el árbol final es exactamente el delta esperado (verificado por el orquestador: stash list vacío, 9 paths). Residuales nombrados sin tocar: loadRepoAsync con la misma forma de error crudo (sin CR que lo nombre), y el check de colapso de CR5 por path.resolve literal — un changes_dir symlinkeado cae a la vía de error nombrado de CR4, no al mensaje específico del colapso.
- **2026-07-30T19:06:44Z** `[status]` in-progress → in-review
- **2026-07-30T19:06:44Z** `[note]` Mandato del review, declarado antes de delegar: auditoría completa — primera review del change. Puntos de escrutinio: las 4 decisiones no especificadas de la nota de implementación, la violación del veto de git (stash) y los dos residuales nombrados.
- **2026-07-30T19:24:11Z** `[review]` in-review → in-progress (retry): D1: register reescribe en silencio en inserted y migrated (reproducido, cero output); D2: absoluto en comentario de CR1 con borde falsificado; D3: 'exactly once' de CR6 sin pin — mutante while sobrevive la suite
- **2026-07-30T19:24:49Z** `[note]` CR2 enmendado por el orquestador tras el fail-retry, con el test de enmienda segura: estrictamente más fuerte — el conjunto exigido se ensancha de {updated, replaced} a todo estado que escribe ({updated, replaced, inserted, migrated}), así que ningún fallo previo se convierte en pass. Motivo: D1 del review probó que register reescribía en silencio en inserted y migrated, y el heading de CR2 ya afirmaba la clase completa; la enmienda alinea el cuerpo con el heading. Edición del orquestador, declarada para el escrutinio de la confirmación.
- **2026-07-30T19:38:23Z** `[status]` in-progress → in-review
- **2026-07-30T19:38:23Z** `[note]` Mandato del review de confirmación, declarado antes de delegar: spot check del diff nombrado — la corrección sin commitear sobre bdc744a7 (7 paths: register.mjs+su suite para D1, comentarios de config-migration para D2, pin de lifecycle.test y comentario de repo.test para D3). Punto de escrutinio: el corrector no pudo reproducir el borde de 2 espacios que el review afirmó ejecutado en D2; el comentario se estrechó igualmente, así que la corrección no depende de esa reproducción.
- **2026-07-30T19:44:30Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T19:44:30Z** `[note]` Confirmación PASS con mandato spot check (~82k frente a ~127k del review completo). Los tres defectos cerrados: D1 con mecanismo único REWRITE_CAUSE verificado en las dos direcciones (pre-corrección reproducido desde bdc744a7 en scratchpad, corregido avisando; estados mudos en silencio por construcción); D3 con el mutante while muerto por la razón correcta y restore probado; D2 estrechado — nota de registro: el revisor de confirmación tampoco pudo reproducir el borde de 2 espacios que el review completo afirmó ejecutado (dos no-reproducciones independientes contra una ejecución afirmada); la corrección no dependía de esa reproducción y el comentario estrechado es exacto para la forma real de la plantilla. Gate 1034/1034, delta exacto de 7 paths, sin git mutante en esta ronda.
