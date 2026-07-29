---
id: "20260729-162616"
title: "Lo que no se puede decidir aborta y se nombra: barrido de fallos silenciosos"
type: bug
status: approved
created: 2026-07-29T16:26:16Z
depends_on: []
related_to: ["20260726-194220", "20260726-141124"]
owner: raruiz-hiberuscom
---

## Request

Barrido decidido por Roberto en la criba (§11 del acta): CH-6 + CH-12 + CH-13
colapsan en un change porque son la misma clase de arreglo — "cero ocurrencias
hoy, bomba armada" — bajo el principio ya escrito del contrato: **lo que no se
puede decidir aborta y se nombra; nunca se salta.** Nueve defectos, ninguno con
error visible hoy.

## Investigation

Todos reproducidos contra HEAD el 2026-07-29 en repos fixture (investigación
delegada; salida literal por defecto; anclas por símbolo, no por línea). Dos
hechos del acta quedan corregidos aquí.

1. **Tipo indecidible degrada en silencio.** `type: bogus` → `Active
   stages(bogus)=` vacío, exit 0, fragmento `readiness` omitido sin aviso. Sin
   `type` → literal `Active stages(undefined)=` y `review_required(undefined)=no`.
   Config con `stages` string → `check` lo nombra (`stages must be a list`,
   símbolo `checkConfig`) pero `context` sale 0 mudo. Sedes: `changePolicyBlock`
   y `fragmentsForType` en `src/commands/context.mjs`, ambas degradan vía
   `Array.isArray` sin rama de error.
2. **`review()` es el único verbo de lifecycle sin `assertTransition`.** En
   `src/commands/agent.mjs`: `status()`, `validation()`, `discard()` y
   `reopen()` lo llaman; `review()` solo comprueba `current !== 'in-review'` y
   escribe `setStatus` directo para sus tres salidas.
3. **`type: ""` produce mensaje con doble espacio.** Reproducido end-to-end:
   `Error:  changes must be reviewed before validation — move to in-review
   first`. Sede: el template `` `${type} changes...` `` en `assertTransition`
   (`src/lifecycle.mjs`) con tipo vacío.
4. **Un `chore` con `(CR99)` pasa limpio.** `checkCoverage` (`src/check.mjs`)
   retorna en `if (!active?.includes('specification')) return;` antes de llegar
   al diagnóstico de criterio desconocido; `src/task.mjs` sí parsea la
   referencia, que existe en memoria y nunca se valida.
5. **`tdd=on` se publica sin fragmento que lo defina.** `transversalPolicy`
   imprime la línea incondicionalmente; `readiness.md` —único fragmento que
   menciona `tdd`— se excluye para tipos sin `specification`. Un `chore` recibe
   una obligación sin su definición en toda la captura.
6. **El congelado como sujeto emite errores inarreglables.** Cuatro invariantes
   de `checkRepo`/`checkSpecs` (`src/check.mjs`) iteran `changes` sin filtrar:
   `depends_on references missing change`, `related_to references missing
   change`, `related_to cannot reference its own change`, `graduated to a
   missing spec`. **Corrección al acta**: el comentario sobre `frozenReason`
   documenta que lo congelado permanece como **dato** de los invariantes
   repo-wide a propósito — el defecto no es la iteración, es que un documento
   congelado pueda ser **sujeto emisor** de un error que nadie puede arreglar
   (`discarded` nunca reabre). Cero ocurrencias hoy; regla global de Roberto:
   lo cerrado no emite.
7. **Dos predicados de congelado conviven.** `frozenReason` (exportado:
   `discarded` o `done`+`archived`) construye `targets`;
   `checkUnclassifiedMentions` usa su propio inline
   `CLOSED_STATUSES.has(status) || archived === true`, más amplio (un `done`
   sin archivar ya se salta esa comprobación pero sigue siendo target del
   resto). `194220` lo dejó registrado sin unificar.
8. **El whitelist del guard de commit es case-sensitive.** `commit()` en
   `src/commands/commit.mjs` compara con `startsWith`/`Set.has` sin normalizar.
   **Corrección al acta sobre el vector**: `git add` normal no fabrica el path
   mal-caseado en APFS (git pliega el casing); el bypass real exige un índice
   con casing distinto — `update-index --cacheinfo`, o un cherry-pick/rebase
   que arrastre un tree entry mal-caseado. Reproducido:
   `.Changeledger/changes/injected-different-case.md` staged así se commitea en
   silencio, exit 0, sin el error "not declared".
9. **`changes_dir: "."` desactiva el guard entero.** Con esa config
   `changesDirRel === ""` y `prefixes = ["/"]`; ningún path staged de git
   empieza por `/`, así que el guard **no juzga ningún fichero** — más amplio
   que el "documento suelto en la raíz" del acta. Reproducido: un
   `leftover.tmp` no declarado y el borrado de `AGENTS.md` staged pasan y se
   commitean, exit 0.

Hallazgo lateral de la reproducción, **fuera de alcance** (sede: CH-7, robustez
del repo consumidor): con `changes_dir: "."`, `loadRepoWithConfig`
(`src/repo.mjs`) parsea todo `*.md` de la raíz sin try/catch y revienta con
`Change is missing its frontmatter block` ante cualquier markdown normal.
Fallo ruidoso, clase distinta; queda registrado en el acta.

Causa raíz común: seis rutas de degradación por defecto (`Array.isArray` sin
rama de error, `return` temprano, impresión incondicional, comparación sin
normalizar, prefijo colapsado) donde el contrato exige abortar nombrando.

## Specification

### CR1 — El tipo indecidible aborta nombrando

- **Given** un change con `type: bogus` (no declarado en `config.types`), otro
  sin clave `type`, y un config cuyo tipo declara `stages` como string
- **When** `changeledger context <id>` sobre cada uno
- **Then** los tres salen con exit distinto de 0 y un error que nombra el
  documento y la causa (`unknown type "bogus"`, `missing frontmatter "type"`,
  `stages must be a list` o equivalentes exactos fijados por el test); ninguna
  captura contiene `Active stages(undefined)=` ni una lista de stages vacía
  silenciosa
- **And** un tipo válido con stages válidas produce la captura de hoy sin
  cambio alguno

### CR2 — `review()` valida la transición como los demás verbos

- **Given** `review()` en `src/commands/agent.mjs`
- **When** registra `pass`, `fail --retry` o `fail --block`
- **Then** cada salida pasa por `assertTransition` antes de escribir, con el
  mismo contrato que `status()`/`validation()`/`discard()`/`reopen()`; un test
  lo fija por comportamiento: una arista ilegal inyectada en config es
  rechazada nombrándola y el documento queda byte-idéntico

### CR3 — Ningún mensaje de error con tipo vacío deforma su plantilla

- **Given** `assertTransition` con `type: ""`
- **When** se lanza el error de review-requerido
- **Then** el mensaje no contiene doble espacio: el tipo vacío se sustituye por
  un nombre neutro o la plantilla lo omite; el test asserta el mensaje literal
  completo

### CR4 — Una referencia a criterio inexistente es diagnóstico en todo tipo

- **Given** un change `chore` cuyo Plan cita `(CR99)`
- **When** `changeledger check`
- **Then** emite un diagnóstico que nombra la tarea y el criterio desconocido
  (un tipo sin `specification` no puede declarar criterios, así que toda
  referencia es desconocida); el nivel exacto (warning en `draft`, error en
  `approved`) sigue la matriz vigente de readiness
- **And** un `chore` sin referencias a CR sigue pasando limpio

### CR5 — La policy no publica obligaciones sin definición servida

- **Given** un change de tipo sin `specification` (chore/audit/quick)
- **When** `changeledger context <id>`
- **Then** la línea `Effective policy` no contiene `tdd=` — la obligación solo
  se publica cuando la captura sirve el fragmento que la define; para un tipo
  con `specification` la línea la conserva idéntica a hoy

### CR6 — Lo congelado nunca es sujeto emisor; sigue siendo dato

- **Given** un fixture con un change `discarded` cuyo `depends_on` cita un id
  inexistente, y un change abierto cuyo `depends_on` cita otro id inexistente
- **When** `changeledger check`
- **Then** el congelado no emite diagnóstico alguno (los cuatro invariantes:
  `depends_on`/`related_to` missing, `related_to` self, `graduated to a missing
  spec`); el abierto sí emite el suyo; y un abierto que referencia un id
  **congelado existente** resuelve sin error — congelado sigue siendo dato

### CR7 — Un solo predicado de congelado, por identidad de función

- **Given** `src/check.mjs`
- **When** se busca quién decide si un documento está congelado
- **Then** existe una sola sede (`frozenReason` o su derivado) y
  `checkUnclassifiedMentions` la consume por identidad de función — el inline
  `CLOSED_STATUSES.has(...) || archived` desaparece; un test fija que ambos
  caminos deciden igual sobre el caso divergente de hoy (`done` sin archivar)

### CR8 — El whitelist del guard de commit no depende del casing

- **Given** un índice con un path del directorio de changes en casing distinto
  (inyectado vía `git update-index --cacheinfo`, el vector real)
- **When** `changeledger commit`
- **Then** el guard lo juzga igual que el path canónico y rechaza el no
  declarado nombrándolo; la comparación normaliza casing solo cuando el
  filesystem es case-insensitive o normaliza siempre de forma segura — la
  decisión exacta la fija la implementación y el test la clava

### CR9 — Un prefijo de guard colapsado aborta, no desactiva

- **Given** un repo con `changes_dir: "."`
- **When** `changeledger commit` con cualquier cosa staged
- **Then** el comando falla nombrando que el directorio de changes colapsa a la
  raíz del repo y el guard no puede juzgar los paths — nunca commitea con el
  guard mudo; el resto de configs (subdirectorio normal) conservan el
  comportamiento de hoy

## Plan

- [ ] Abortar nombrando en `changePolicyBlock`/`fragmentsForType` de `src/commands/context.mjs` para tipo desconocido, ausente o `stages` malformadas, y omitir `tdd=` en `transversalPolicy` cuando la captura no sirve `readiness.md`; verify: `node --test test/context.test.mjs test/cli-bin.test.mjs` con los tres fixtures de CR1 en rojo antes del fix (CR1, CR5)
- [ ] Añadir `assertTransition` a `review()` en `src/commands/agent.mjs` y arreglar la plantilla de tipo vacío en `src/lifecycle.mjs`; verify: `node --test test/agent.test.mjs test/lifecycle.test.mjs` con la arista ilegal rechazada y el mensaje literal fijado (CR2, CR3)
- [ ] En `src/check.mjs`: diagnóstico de criterio desconocido para tipos sin `specification`, sujeto congelado excluido de los cuatro invariantes conservándolo como dato, y predicado único de congelado consumido por identidad; verify: `node --test test/check.test.mjs` con los fixtures de CR4 y CR6 en rojo antes del fix (CR4, CR6, CR7)
- [ ] En `src/commands/commit.mjs`: whitelist insensible al casing con el vector de `update-index` reproducido en test, y abort nombrado cuando `changes_dir` colapsa a la raíz; verify: `node --test test/commit.test.mjs` con ambos bypasses en rojo antes del fix (CR8, CR9)
- [ ] Correr el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-29T16:32:00Z** `[note]` Documentado sobre reproducción delegada contra HEAD en fixtures, no sobre el acta. Corrige dos hechos del acta: la iteración sin filtrar es diseño documentado para el congelado-como-dato (el defecto es el sujeto emisor), y el bypass de casing no es alcanzable por `git add` normal en APFS (el vector real es índice inyectado o rebase con tree mal-caseado). Eleva uno: `changes_dir: "."` desactiva el guard para todo fichero, no solo la raíz. Hallazgo lateral (loadRepo revienta con cualquier .md de raíz bajo `changes_dir: "."`) registrado para CH-7, fuera de alcance.
- **2026-07-29T16:33:18Z** `[status]` draft → approved
