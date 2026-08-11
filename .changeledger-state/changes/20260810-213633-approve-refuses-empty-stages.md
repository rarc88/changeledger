---
id: "20260810-213633"
title: approve rechaza stages activas vacías
type: quick
status: done
created: 2026-08-10T21:36:33Z
depends_on: []
reviewed: true
branch: quick/20260810-213633
related_to: ["20260810-181801"]
owner: claude
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
- **2026-08-10T22:00:54Z** `[status]` approved → in-progress
- **2026-08-10T22:00:54Z** `[branch]` set: quick/20260810-213633 (auto)
- **2026-08-10T22:00:55Z** `[owner]` set: claude
- **2026-08-10T22:08:20Z** `[note]` Investigated and implemented (then reverted) the fix. Seat found: status()'s existing asStatus-projected assertChangeTextValid gate (agent.mjs ~line 169-171), which viewer's changeStatus() also calls via applyStatusCmd — confirmed single seat, no viewer-side copy. Design: new checkStageEmptiness() in check.mjs reusing the existing SEMANTIC_STAGES set (request/investigation/proposal/specification/plan — log excluded by construction, matching checkCoverage's own carve-out) and the same draft=warn/approved+=err severity projection as checkCoverage, so quick's empty Request and feature's empty Investigation/Proposal are refused identically to Specification/Plan — decided uniformly rather than special-cased, and the CAUTION about check not failing repo-wide on a draft holds (draft stays warn-only). No pre-existing empty-Request/empty-stage enforcement was found anywhere (grep across check.mjs/agent.test.mjs/check.test.mjs) — nothing to pin, this needs implementing. STOPPED before landing: wiring the check live turned 289 tests red across test/agent.test.mjs, test/view.test.mjs, test/cli.test.mjs and test/cli-bin.test.mjs, because nearly every existing lifecycle fixture builds its approved/in-progress change from the bare newChange() scaffold and (per the 20260729-185200 CR1 precedent) only ever back-fills the Plan section, leaving Request/Investigation/Proposal/Specification genuinely blank. Migrating every such fixture to non-empty content is a cross-cutting rewrite of 100+ call sites across 4 test files, well beyond this quick's scope/risk budget — reverted src/check.mjs to baseline (git status confirmed clean) and returning this as a decision for the human: either authorize a follow-up to migrate the shared test fixtures first, or descope to Specification+Plan only (which still leaves Investigation/Proposal/Request unguarded, contradicting the Request's ask to decide and cover them).
- **2026-08-10T22:17:59Z** `[note]` Rescoped per coordinator: moved the emptiness gate off checkRepo/checkCoverage entirely (no repo-wide severity change now) into a new assertStagesNotEmpty(config, text) in check.mjs, called only from status()'s existing approved-transition seat in agent.mjs (same seat the viewer's changeStatus routes through). Checks active non-log stages (request/investigation/proposal/specification/plan) for blank body on draft->approved only; throws naming every empty stage, status untouched. New tests 213633 CR1 (feature: empty Specification+Plan named together) and 213633 CR2 (quick: empty Request) added in test/agent.test.mjs, captured literal pre-fix failure (Missing expected exception), and one isolated mutant (dropping the assertStagesNotEmpty call) killed both with the same literal failure, restored by editing, src confirmed clean of the MUTANT marker after restore. checkRepo/checkCoverage are byte-identical to baseline; check exit=0 and lint exit=0 confirm no repo-wide regression. However wiring the transition gate live still surfaces 131 pre-existing test failures across test/agent.test.mjs (105), test/view.test.mjs (17), test/cli-bin.test.mjs (9) and test/cli.test.mjs (3): dozens, not a handful, so per the coordinator's stop condition I did not touch those fixtures. All of them share the same root cause — they build an approved/in-progress change via the bare newChange() scaffold (Request/Investigation/Proposal/Specification left blank) and only ever back-fill Plan, a convention already visible in repoWithChange()'s comment about the 20260729-185200 CR1 precedent. Stopping here per instruction and reporting the count; pnpm test currently exits 1 until those fixtures are migrated or the human decides otherwise.
- **2026-08-10T22:32:24Z** `[note]` Migrated the shared fixture helpers per authorization (centralized root cause confirmed). Helper seats touched: repoWithChore(), repoWithAudit(), repoWithUnreadyChange(), repoWithTwoSamePrefix() in test/agent.test.mjs plus repoWithChange() (already patched earlier); draftChange()'s new fillNarrativeStages/fillFeatureStages helpers in test/view.test.mjs, reused at 6 individual call sites that build their own inline scaffold instead of going through draftChange(); one inline fixture edit each in test/cli-bin.test.mjs (125139 CR1 chore, 141944 CR6 feature, CR6 graduate --into chore, review wiring fail --block feature) and test/cli.test.mjs (124656 CR3). Residual individually-edited tests: 12 (7 in view.test.mjs's inline scaffolds, 4 in cli-bin.test.mjs, 1 in cli.test.mjs) — within the <=15 bound, no STOP needed. Judgment calls: (1) tests that reach 'done' via validation pass needed an explicit  before the pass — this is a pre-existing 'done'-severity check (assertChangeTextValid at validation()) surfaced only because the newly non-empty Plan stage now carries a real task; not part of the emptiness gate itself, called out so it isn't mistaken for scope creep. (2) 150231 CR2's fixture (deliberately incomplete task, asserts the rejection) got only fillNarrativeStages (Request/Investigation/Proposal/Specification), not the Plan default-fill, to preserve its single-incomplete-task semantics — a new fillNarrativeStages helper was split out for this. No defectiveDraft-style negative-empty-draft test needed touching; those assert on the emptiness itself. Gate unchanged from the transition-scoped assertStagesNotEmpty design. Final gate: pnpm lint exit 0, pnpm test exit 0 (1399 pass), node bin/changeledger.mjs check exit 0 (11 valid), GIT_DIR=/nonexistent/fake.git pnpm test exit 0 (1399 pass) — confirms no hidden git-dependent env leakage in the new code.
- **2026-08-10T22:34:29Z** `[status]` in-progress → in-validation
- **2026-08-11T00:35:21Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T00:36:10Z** `[graduation]` skipped: la verdad normativa del gate vive en el flujo de aprobación de INTENT.md y el asiento status() ya documentado; sin spec afectada
