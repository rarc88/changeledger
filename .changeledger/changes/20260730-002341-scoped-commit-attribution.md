---
id: "20260730-002341"
title: La atribución de ids se acota a la declaración del commit
type: bug
status: in-validation
created: 2026-07-30T00:23:41Z
depends_on: []
related_to: ["20260728-151336"]
owner: raruiz-hiberuscom
release_impact: patch
---

## Request

Dos huecos de la gramática de declaración `ChangeLedger` en commits, ambos
residuos declarados que [#20260728-151336] dejó fuera de su alcance autorizado:

1. **La atribución lee todo el mensaje.** `gitRefs` atribuye un commit a un
   change grepeando `[#id]` sobre el mensaje completo, así que un id citado en
   texto libre — incluida la razón de un commit `ChangeLedger: none` — atribuye
   el commit a ese change. Un commit que declara que ningún change lo cubre
   aparece en las refs de un change: exactamente la ambigüedad que la regla de
   coexistencia evita. Decisión de Roberto (2026-07-29): **las razones sí pueden
   citar ids**, así que el arreglo es acotar la atribución a la declaración —
   marcador del subject y línea canónica `ChangeLedger:` del body — y nunca al
   texto libre.
2. **El body no admite ninguna línea además de la declaración.** Las regex del
   lint anclan `^…$` sobre el body entero trimeado, así que un commit multi-id u
   operativo no puede llevar párrafo de porqué ni trailer (`Co-Authored-By`):
   choca con la convención de commits que pide body cuando el porqué no es
   obvio.

## Investigation

Investigación fresca contra HEAD del 2026-07-29 (delegada, con reproducciones
en repo scratch y salidas literales).

**Dos rutas de código independientes.** El lint (`commitMarkerViolation`,
consumido por `lintCommitRange` ← `check --commits`) y la atribución
(`gitRefs`, consumida solo por la ruta `/api/git` del viewer) no comparten
regex ni función. `gitRefs` hace `git log --all -F --grep=[#<id>]` sobre el
mensaje completo, sin distinguir subject, línea canónica ni prosa.

**Repro 1 — el commit none se atribuye.** Repo scratch con commit A
(`feat: initial [#X]`) y commit B (body
`ChangeLedger: none — supersedes [#X], no longer needed`): el lint acepta B
(`LINT: []`) y `gitRefs(X)` devuelve **ambos** commits.

**Repro 2 — la prosa atribuye.** Commit con subject `feat: third [#Y]` y una
línea de body de prosa citando `[#Z]`: `gitRefs(Y)` y `gitRefs(Z)` devuelven el
**mismo** commit — un id mencionado en una nota atribuye igual que el marcador.

**Repro 3 — el body rechaza toda línea extra.** Línea canónica
`ChangeLedger: [#A] [#B]` más un párrafo de porqué → el lint responde
`malformed ChangeLedger body`; lo mismo con un trailer `Co-Authored-By`. Causa:
`MULTI_BODY_RE` y `NONE_REASON_RE` anclan `^…$` sin flags sobre el body entero
trimeado.

**Red de seguridad existente.** `test/git.test.mjs` pinnea el parseo de campos,
los fallos de git y — el único de atribución real — que la línea canónica del
body atribuye (`225638 CR5`): debe seguir pasando. Ningún test pinnea la
atribución por prosa, así que retirarla no rompe ninguno. El ancla de body
entero la pinnean seis tests de `test/check.test.mjs` (los de `225638 CR4` y la
familia `151336`: declaración entre otras líneas, razón solo-espacios, em dash
con padding, guion plano, declaración dentro de una línea más larga,
declaración duplicada) — los que cambian de semántica se retargetean con
evidencia y los demás quedan intactos.

**Diseño que cierra los dos huecos sin abrir rutas de escape.** La declaración
del body pasa de "es el body entero" a "es la **primera línea** del body,
única": las líneas posteriores son texto libre sin efecto sobre lint ni
atribución, salvo que empiecen por `ChangeLedger:` — segunda declaración o
declaración enterrada siguen siendo `malformed ChangeLedger body`, fail-closed.
La atribución reconoce exactamente dos sedes: marcador al final del subject y
línea canónica multi-id en cabeza del body. La batería adversarial de
[#20260728-151336] (~50 rutas de escape) conserva su propiedad: ninguna ruta
alcanza la exención sin la declaración literal, ahora en cabeza del body.

## Specification

Interfaces externas: ninguna nueva. La forma `{commits, branches}` de `gitRefs`
que consume el viewer no cambia; solo se estrecha qué commits entran.

### CR1 — El commit none no se atribuye aunque su razón cite el id
- **Given** un repo con commit A `feat: initial [#X]` y commit B cuyo body es
  `ChangeLedger: none — supersedes [#X], no longer needed`
- **When** `gitRefs(root, "X")` y `lintCommitRange` sobre el rango
- **Then** `gitRefs` devuelve solo A — hoy, reproducido: devuelve A y B — y el
  lint sigue aceptando B sin violación

### CR2 — La prosa no atribuye; el subject y la línea canónica sí
- **Given** un commit C con subject `feat: third [#Y]` y una línea de body de
  prosa `Related to work also tracked under [#Z] in a prose note.`, y un commit
  D con subject limpio y primera línea de body `ChangeLedger: [#Y] [#Z]`
- **When** `gitRefs` por cada id
- **Then** `gitRefs(Y)` devuelve C y D, y `gitRefs(Z)` devuelve solo D — hoy,
  reproducido: C se atribuye también a Z — y el test existente
  `225638 CR5: gitRefs finds a body marker and returns the clean subject` pasa
  sin cambios

### CR3 — El body admite líneas adicionales bajo la declaración
- **Given** un commit multi-id cuya primera línea de body es
  `ChangeLedger: [#A] [#B]`, seguida de un párrafo de porqué y del trailer
  `Co-Authored-By: Someone <someone@example.com>`, y un commit operativo cuya
  primera línea de body es `ChangeLedger: none — <razón>` seguida de un párrafo
- **When** `changeledger check --commits` sobre el rango
- **Then** cero violaciones — hoy, reproducido: ambos dan
  `malformed ChangeLedger body`

### CR4 — La declaración sigue siendo única y en cabeza, fail-closed
- **Given** un body cuya línea canónica va precedida por otra línea de texto, y
  un body con dos líneas que empiezan por `ChangeLedger:`
- **When** `changeledger check --commits`
- **Then** ambos siguen dando `malformed ChangeLedger body` — la declaración
  enterrada y la duplicada no ganan legalidad con la relajación — y los tests
  existentes de razón solo-espacios, em dash con padding y guion plano pasan
  byte-idénticos, sin retarget

## Plan

- [x] Acotar la atribución en `gitRefs`: filtro sobre los candidatos del grep que exige marcador al final del subject o línea canónica en cabeza del body
  - **Target:** `src/git.mjs`
  - **Verify:** `node --test test/git.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-07-30T10:02:45Z`
- [x] Relajar `commitMarkerViolation` a declaración-en-primera-línea con cola libre, fail-closed ante segunda declaración, retargeteando los tests de `225638 CR4` y `151336` cuya semántica cambia
  - **Target:** `src/git.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-30T10:02:46Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo
  - **Resolved:** `2026-07-30T10:02:46Z`

## Log
- **2026-07-30T09:46:33Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T09:48:29Z** `[status]` approved → in-progress
- **2026-07-30T10:03:05Z** `[note]` Selección única resuelta. Evidencia: repros de baseline literales (commit none atribuido, prosa atribuye, línea extra rechazada), rojo-verde por CR, 5 mutantes de uno en uno — M3 (atribución leyendo el body entero) no tenía asesino y se añadió el test 002341 CR2 de marcador-en-cola-libre, ruta de escape que el documento no nombraba. Batería adversarial re-derivada: 38 rutas, 0 regresiones; la propiedad se mantiene con la declaración en cabeza. Cero retargets en check.test.mjs: inventariado que ningún test existente tenía declaración legal seguida de cola — diff 102 inserciones, 0 borrados; los seis tests nombrados en CR4 pasan byte-idénticos. pnpm test 1010/1010, check exit 0.
- **2026-07-30T10:03:05Z** `[note]` Protocolo y residuos para el review: (1) el implementador usó git stash una vez para probar el caso NBSP — regla de restaurar-editando incumplida, round-trip limpio y auto-reportado. (2) NBSP antes de la etiqueta se acepta: preexistente, verificado contra baseline, sin tocar. (3) .changeledger/specs/git-traceability.md queda contradicha en dos puntos (body exactamente la declaración; gitRefs busca el mensaje entero) — se corrige en la graduación al cerrar. (4) commit.mjs no ofrece componer párrafo de porqué en --no-change, ahora gramática legal: follow-up, no implementado. Decisiones no especificadas: hasBodyLabel sigue leyendo el body entero (más fail-closed, M5 lo prueba portador); precedencia de mensajes byte-idéntica; regla de cola startsWith no includes.
- **2026-07-30T10:03:05Z** `[note]` Mandato de review, registrado antes de delegar: auditoría del rango a190de7e..HEAD de la rama change/scoped-commit-attribution por revisor fresco top-tier. Puntos de escrutinio: las 3 decisiones no especificadas, el incidente del stash, la cobertura del caso NBSP como residuo preexistente, que la relajación no abra ninguna ruta de la batería (re-derivarla o muestrearla), y las notas de este Log al estándar del implementador.
- **2026-07-30T10:03:06Z** `[status]` in-progress → in-review
- **2026-07-30T10:18:44Z** `[review]` in-review → in-progress (retry): Tres mutantes sobreviven la suite completa en código nuevo del change: el trim() que rechaza la segunda declaración indentada no lo pinnea ningún test (un refactor futuro lo quita con suite verde y reabre la ruta), y el asiento marcador-cierra-el-subject de CR2 tampoco está pinneado. Comportamiento correcto hoy, verificado e2e, pero sin red: misma clase que el CR6 de 203257. Corrección: dos tests de pin que maten M-d y M-f, más corrección de dos afirmaciones del Log (la precedencia de mensajes no es byte-idéntica a nivel de resultado en dos formas ya ilegales; el set de mutantes estaba incompleto).
- **2026-07-30T10:19:19Z** `[note]` Correcciones del review a afirmaciones previas de este Log: (1) 'precedencia de mensajes byte-idéntica' es verdad estructural pero falsa a nivel de resultado en dos formas ya ilegales — none con cola sin razón pasa de malformed a 'requires a reason', y none+marcador pasa a 'cannot coexist' — ambas siguen siendo violación y el mensaje nuevo es más exacto. (2) 'cinco mutantes de uno en uno' era un set incompleto: tres supervivientes en código nuevo (M-d trim de la segunda declaración indentada, M-f marcador-cierra-subject, M-c startsWith→includes benigno). (3) Residuo adicional no listado: comentario rancio en src/commands/commit.mjs que aún dice que la declaración es el body entero — fuera del Target autorizado, queda para follow-up con el del párrafo de porqué. (4) El cap -n 100 de gitRefs ahora acota candidatos pre-filtro, no resultados: preexistente, insignificante a esta escala, anotado.
- **2026-07-30T10:23:30Z** `[note]` Corrección del retry: dos tests de pin añadidos — '002341 CR4: an indented second declaration is still malformed' (mata M-d: bajo el mutante el commit queda exento, exit 0 literal) y '002341 CR2: a marker that does not close the subject does not attribute' (mata M-f, con commit de control positivo contra el pase vacuo). Ambos verdes en código real antes de plantar mutante; restauración editando con diff vacío contra HEAD probado entre mutantes; M-c queda sin pin por dirección benigna (solo puede rechazar más). Suite 1012/1012. Corrección sin commitear a la espera de confirmación fresca.
- **2026-07-30T10:23:30Z** `[note]` Mandato de la ronda de confirmación, registrado antes de delegar: mandato mínimo — verificar que el diff sin commitear son solo los dos tests (+43 líneas, adiciones puras) más la ventana del ledger, re-derivar los dos rojos-bajo-mutante, y correr la suite y check. Nada más: el resto del rango tiene PASS técnico de la auditoría.
- **2026-07-30T10:23:30Z** `[status]` in-progress → in-review
- **2026-07-30T10:28:33Z** `[review]` in-review → in-validation (delegated subagent, clean context)
