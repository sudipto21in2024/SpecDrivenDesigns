---
ticket: LOGI-0012
arm: frontend
status: locked
created: 2026-10-03T07:45:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-qa-followup.plan.md
---

## 1. Objective

LOGI-0012 frontend follow-up: **make the dashboard's route-scoped drill-down actually work in the
browser**, which is the last thing keeping AC-6's user-visible promise unmet.

The qa arm proved the API half is correct (165/165 e2e) and then found the client half is short by
three links in a chain. `shipmentListHref` has always emitted `routeId` on the `/shipments`
drill-down href, so a dispatcher filtering the dashboard by route clicks a tile and lands on an
UNFILTERED list. All three breaks are in this arm's scope:

1. **The generated type has no `routeId`.** `schema.d.ts` was generated before the architect arm
   amended the contract and never regenerated, so `ListShipmentsParams` cannot even express the
   filter. Fixed by regenerating — already verified: exactly +2 lines, one optional
   `routeId?: number`, idempotent and hand-edit-free.
2. **The client does not send it.** `listShipments` serializes eight params and skips `routeId`,
   so even a correct caller would drop it on the floor.
3. **The page ignores the URL.** `ShipmentsPage` initialises every filter from `useState('')` and
   never reads the query string, so `/shipments?routeId=7` renders the default unfiltered view.
   This is the break that makes the drill-down lossy even once 1 and 2 are fixed.

The design rule that keeps this honest: **the URL is the source of truth for the inbound filter,
the local state remains the source of truth for edits.** A deep link must hydrate the controls; a
control change must not rewrite the URL (the page has no requirement to be linkable on every
keystroke, and adding that would pull routing concerns into a list page). One-way hydration on
mount, then ordinary local state.
## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate | AC-6 — `ListShipmentsParams` gains `routeId` from the contract, never hand-written | generated |
| `src/frontend/src/api/client.ts` | modify | AC-6 — `listShipments` serializes `routeId`, the gap between a correct caller and a working filter | ~2 |
| `src/frontend/src/features/shipments/shipmentsFilterParams.ts` | create | AC-6 — the URL→params reader, extracted so parsing is unit-testable without a DOM | ~70 |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | modify | AC-6 — seed the filter state from the URL on mount and carry `routeId` into the params object | ~25 |
| `src/frontend/src/features/shipments/shipmentsFilterParams.test.ts` | create | AC-6 traceability for the parser: present/absent/garbage/non-numeric cases | ~90 |
| `src/frontend/src/mocks/handlers.ts` | verify only | the MSW shipments handler already parses and validates `routeId` — no edit expected | 0 |
| `state/plans/LOGI-0012-frontend-followup.plan.md` | create (via CLI) | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | frontend-followup journal section | via CLI |

A route filter CONTROL is deliberately **not** added. The dashboard already owns the route filter and
AC-6 only requires the drill-down target to honour the filter that arrives in the URL. A second route
control would be a product decision nobody asked for, and would enlarge this arm.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `src/frontend/src/features/dashboard/schema.ts` | 125-148 | `shipmentListHref`, the exact query shape the list page must consume |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | 55-96 | the filter state block and the params memo the hydration changes |
| `src/frontend/src/features/shipments/hooks.ts` | 14-19 | `useShipments`, whose query key is the params object — so hydration must happen before the first render, not in an effect |
| `src/frontend/src/mocks/handlers.ts` | 2170-2210 | the MSW list handler, to confirm the mock needs no change |
| `memory/journal/LOGI-0012.md` | qa-followup section | the three-link gap as recorded, so the fix targets the cause |
## 4. Milestones (vertical slices)

- [ ] 1. **M1 — the chain, end to end, with unit tests.** Regenerate the schema, add the `routeId`
      serialization to `listShipments`, and create the URL→params parser with its own test file. The
      parser is a pure function precisely so it can be tested without a router: garbage, empty,
      non-numeric and out-of-range `routeId` must all resolve to "no filter" rather than a request
      the API will reject with a 400 the page cannot attribute to any control.
      → verify: `npx tsc --noEmit` 0 errors; `npm test` green including the new parser cases;
      regenerating the schema twice produces no further diff (idempotent).

- [ ] 2. **M2 — hydrate the page from the URL.** Seed `ShipmentsPage`'s filter state from the parsed
      params during initial render (a lazy `useState` initialiser, NOT a `useEffect`) so the very
      first query already carries the filter and no unfiltered request is ever issued. The lazy
      initialiser matters: an effect would fire one unfiltered read first, briefly showing the
      dispatcher rows they filtered out.
      → verify: `npx tsc --noEmit` 0 errors; `npm run build` clean; `npm test` green with no
      pre-existing shipments test edited.

- [ ] 3. **M3 — the mock is honest, and the suite is green.** Confirm the MSW shipments handler
      already honours `routeId` so the frontend suite is not testing against a more capable mock than
      the API has, then run the whole frontend suite and `check-size.mjs` on the touched files.
      → verify: `npm test` all green; size gate clean or only pre-existing entries worse.

## 5. Risks

- **An effect-based hydration would pass the tests and still be wrong.** Every existing shipments test
  drives the page through its own controls, so an effect that populates state on mount would still
  render correctly in those tests while issuing one unfiltered request first in production. A lazy
  `useState` initialiser is the only version that avoids it, and it is invisible to the UI tests —
  which is exactly why it is called out here rather than left to judgement.
- **Reading the URL must not become a router dependency.** `ShipmentsPage` currently takes no props
  and reads no location. Pulling in a router hook for one param is more coupling than the feature
  warrants; a plain `window.location.search` read in the initialiser keeps the page self-contained.
  The test cost is that hydration is not unit-testable in isolation, which is why the PARSING lives
  in the extracted pure module and only the wiring is untested.
- **Garbage in the URL must not become a 400.** A hand-edited `?routeId=abc` should render the
  unfiltered list, not an error. The parser drops anything non-integer, so the page never sends a
  value the API will reject — the same fail-quietly-at-the-edge choice the dashboard filter bar makes.
- **MSW is not proof.** The mock already accepts `routeId`, so frontend tests can go green while the
  real API disagrees. The e2e arm is the only place the two are genuinely compared; this arm must not
  be reported as having verified the API contract.