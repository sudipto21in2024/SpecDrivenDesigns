---
ticket: LOGI-0012
arm: architect
status: locked
created: 2026-10-02T08:40:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-architect.plan.md
  - state/plans/LOGI-0012-backend.plan.md
  - state/plans/LOGI-0012-frontend.plan.md
  - state/plans/LOGI-0012-qa.plan.md
---

## 1. Objective

LOGI-0012 architect follow-up: **close the AC-6 contract gap the qa arm found.**

The decision is already written down — this arm makes the contract obey it rather than re-litigating it.

- **AC-6** states: *"the dashboard defines no query parameter that `GET /shipments` does not already accept"*.
- **O4** states: *"it reuses the shipment list's filter vocabulary … AC-6 makes the drill-down into
  `GET /shipments` lossless"*, and names the rejected alternative: *"a dashboard-specific filter DSL
  (the tile and the list it links to could then disagree)"*.
- **The contract as built gives `GET /dashboard` a `routeId` parameter that `GET /shipments` does not
  have.** That is precisely the "dashboard-specific filter" O4 rejected, and it is not lossless: a
  dispatcher filters the dashboard to one route, clicks a tile, and lands on a list filtered by nothing.

So this is a defect against the ticket's own recorded decisions, and the fix follows from O4 directly:
**close the gap on the shipments side by adding `routeId` to `GET /shipments`**, making the vocabulary
genuinely shared and AC-6 literally true. The alternative — deleting `routeId` from the dashboard —
would satisfy the letter of AC-6 by removing capability, and would leave `GET /planning-board` with a
filter `GET /shipments` still lacks, so the inconsistency would simply move.

Adding it is additive and low-risk: `GET /shipments` is a read filter, `route_id` already exists on the
row (LOGI-0010), and `PlanningBoardFilters` already filters on it, so the predicate is proven. The
semantics chosen below deliberately mirror the planning board's, including the "not a null equality"
rule, so the two endpoints cannot drift.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `contracts/v1-openapi.yaml` | modify | AC-6/O4 — add `routeId` to the `listShipments` parameter list, mirroring the dashboard's description and constraints | ~2 |
| `contracts/v1/components/schemas/shipments.yaml` | modify | AC-6/O4 — document the shared filter's semantics beside the response schema, so the fragments and the bundle cannot drift | ~10 |
| `specs/features/LOGI-0012-operations-dashboard.md` | modify | AC-6 — record the resolved gap and the chosen fix as an explicit decision, so the qa arm's finding is closed rather than merely worked around | ~12 |
| `state/plans/LOGI-0012-architect-followup.plan.md` | modify (via CLI) | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | architect-followup journal section | via CLI |

Downstream code is deliberately **not** in this manifest: the contract change is what the backend and
frontend arms consume, and each edits only its own files under its own locked plan.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0012-operations-dashboard.md` | 118-122, 185 | AC-6's exact wording and the O4 decision that settles it |
| `contracts/v1-openapi.yaml` | 983-993, 1404-1412 | the `listShipments` and `getDashboard` parameter lists, so the new param is a true mirror |
| `memory/journal/LOGI-0012.md` | qa-arm section | the finding as recorded, including why the test compared on shared filters |
| `state/plans/LOGI-0012-qa.plan.md` | §5 | the risk that led to the finding, so the fix targets the cause |
## 4. Milestones (vertical slices)

- [ ] 1. **M1 — amend the contract so the vocabulary is genuinely shared.** Add `routeId` to
      `listShipments` with the same name, type, constraint and description the dashboard already uses,
      document the semantics (including that a `routeId` filter does not imply "and unassigned is
      excluded", matching the planning board), and regenerate the bundle.
      → verify: `node tools/contract/index.mjs bundle --check` clean; both operations list `routeId`;
      `node tools/contract/index.mjs show --resource shipments --fields params` resolves.

- [ ] 2. **M2 — close the decision in the spec and re-check the ticket's own invariants.** Record the
      gap, the two candidate fixes and why the additive one was chosen (O4 rejects a dashboard-specific
      DSL; deleting the dashboard's filter would move the inconsistency rather than remove it), and
      confirm the amendment leaves the dashboard read-only and introduces no new persisted state.
      → verify: `node tools/spec/index.mjs show --ticket LOGI-0012 --section ac` still resolves with
      9 ACs; `node tools/contract/index.mjs show --resource dashboard --fields params` shows the
      dashboard parameters are now a SUBSET of the shipments list's, which is the invariant AC-6 wants.

- [ ] 3. **M3 — arm verification.** Run spectral and the size check so the amendment is provably
      clean, confirm the contract diff is additive only (no existing parameter removed or retyped),
      seal the journal, and HANDOFF backend→frontend→qa naming exactly what each must pick up.
      → verify: spectral 0 errors 0 warnings; size baseline respected; `git diff` on `contracts/` shows
      only added lines; `validate-plan` 0 errors; one atomic commit
      `fix(LOGI-0012): share the routeId filter between GET /shipments and the dashboard`.

## 5. Risks / open questions

- **The fix is additive on purpose.** No existing parameter is removed, renamed or retyped, so no
  current caller can change behaviour. `routeId` is an optional filter whose absence means "no
  restriction", which is exactly what today's `GET /shipments` callers already get.
- **Semantics must not be invented here.** The dashboard's `routeId` description says *"a null routeId
  is not implied"*, and the planning board implements that rule. Mirroring the existing
  `PlanningBoardFilters` behaviour is what keeps the three endpoints from drifting; inventing a
  different meaning for the list would create a second definition, which is the very failure mode this
  ticket exists to prevent.
- **Bundle and fragment budgets.** Adding a parameter grows the bundle; `tools/contract/check-size.mjs`
  and the size baseline must still pass, or the fix needs a compensating trim rather than a raised
  budget.
- **This does not by itself make the SPA drill-down live.** The SPA has no router: the tile `href`s are
  real anchors but nothing consumes them yet, and the shipments page does not read a `routeId` from
  the URL. Making the click navigate is frontend work beyond this ticket's read-only scope, so this arm
  fixes the *contract* invariant and records the remaining UI gap rather than pretending the
  drill-down is end-to-end.

## 6. Exit gates

- `node tools/contract/index.mjs bundle --check` clean and spectral reports 0 errors 0 warnings.
- `tools/contract/check-size.mjs` respects the existing size baseline.
- The dashboard's parameter list is a SUBSET of `GET /shipments`'s — the invariant AC-6 asserts.
- `git diff` over `contracts/` is additions only: no existing parameter removed, renamed or retyped.
- `node tools/spec/index.mjs show --ticket LOGI-0012 --section ac` resolves with exactly 9 ACs.
- `node tools/tracker/index.mjs validate-plan` reports 0 errors for this plan; one atomic commit.
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardFilters.cs` | whole | the existing route-filter semantics to mirror, including the "not a null equality" rule |
| `tools/contract/size-baseline.json` | whole | the fragment/bundle size budget the amendment must respect |