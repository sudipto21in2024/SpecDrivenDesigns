---
ticket: LOGI-0008
arm: frontend
status: locked
created: 2026-09-26T07:42:54.919Z
depends_on_plans:
---

## 1. Objective
LOGI-0008 frontend arm: land the AC-11 UI seam on top of the sealed backend arm — regenerate
`schema.d.ts` for the two new `/shipments/{id}` operations, add `api.getShipment`/`api.updateShipment`,
model GET/PATCH in MSW, and add the row actions (Edit → `EditShipmentDialog`, Cancel → confirmation
dialog) with the exact status/role matrix of AC-11. Local gate: `npm run build` (tsc) + `npm test`
(vitest). No Playwright work here — that is the qa arm.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate (`npm run generate:api`) | `getShipment`/`updateShipment` + `ShipmentUpdateRequest` types (AC-6) | generated |
| `src/frontend/src/api/client.ts` | modify | `ShipmentUpdateInput` alias + `getShipment` + `updateShipment` (AC-6, AC-1) | ~25 |
| `src/frontend/src/features/auth/permissions.ts` | modify | `editShipments` (x-roles Admin/Dispatcher on PATCH) + narrow `cancelShipments` (AC-11, AC-10) | ~14 |
| `src/frontend/src/features/shipments/schema.ts` | modify | `shipmentEditFormSchema` + `toShipmentUpdateInput` (presence-aware subset, AC-3) | ~45 |
| `src/frontend/src/features/shipments/hooks.ts` | modify | detail query key + `useShipment`/`useUpdateShipment`/`useCancelShipment` (AC-1, AC-8) | ~40 |
| `src/frontend/src/features/shipments/EditShipmentDialog.tsx` | create | pre-filled edit dialog, field-keyed 400s (AC-11, AC-3) | ~210 |
| `src/frontend/src/features/shipments/CancelShipmentDialog.tsx` | create | confirmation before `toStatus: "Cancelled"` (AC-11, AC-8) | ~90 |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | modify | Actions column + status/role gating + 409 refresh (AC-11) | ~110 |
| `src/frontend/src/mocks/handlers.ts` | modify | GET/PATCH `/:id` with Pending-only 409, server-owned 400s, BR-6 cancel role guard (AC-1..AC-7, AC-10) | ~170 |
| `src/frontend/src/features/shipments/ShipmentsPage.test.tsx` | modify | AC-11 matrix + edit/cancel integration through the page | ~220 |
| `state/plans/LOGI-0008-frontend.plan.md` | modify | this plan | auto |
| `memory/journal/LOGI-0008.md` | append (tracker seal) | frontend-arm section | ~10 |
| `state/events.jsonl`, `state/handoffs.jsonl`, `state/tasks.json`, `memory/active.md`, `memory/progress.md` | derived (CLI only) | bookkeeping | auto |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| spec:LOGI-0008 | `node tools/spec/index.mjs show --ticket LOGI-0008 --section ac` | AC-1..AC-12, esp. AC-11 |
| contract:shipments | `node tools/contract/index.mjs show --resource shipments --fields x-roles,schemas` | role matrix + `ShipmentUpdateRequest` shape |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | 1-338 | the page being extended (row markup, filters, snackbar idiom) |
| `src/frontend/src/features/shipments/ShipmentFormDialog.tsx` | full | RHF+Zod+field-error mapping idiom the edit dialog mirrors |
| `src/frontend/src/features/shipments/hooks.ts` | full | query-key + invalidation idiom |
| `src/frontend/src/mocks/handlers.ts` | 89-160, 850-1010 | mock store, `legalTransitions`, `shipmentListRules`, create/transition handlers |
| `src/frontend/src/features/shipments/ShipmentsPage.test.tsx` | full | test idioms (`seedShipment`, `rowFor`, `column`) |
| `Docs/ProjectTechGuidence/07-coding-standards.md` | relevant | frontend conventions |

## 4. Steps (each with verify gate)
- [x] 1. **Milestone 1 — types + API client + mocks + unit tests (Logic layer).** Regenerate
      `schema.d.ts`; add `ShipmentUpdateInput`/`getShipment`/`updateShipment` to the client; add the
      `editShipments`/`cancelShipments` capabilities (BR-6 narrowing: `transitionShipments` stays for
      non-terminal statuses, a separate `cancelShipments` is Admin/Dispatcher-only); add the
      presence-aware `shipmentEditFormSchema` + mapper; add `useShipment`/`useUpdateShipment`/
      `useCancelShipment`; implement MSW GET/PATCH `/:id` (Pending-only 409, field-keyed 400s,
      server-owned/immutable 400s, 404) and the BR-6 cancel guard on the transitions handler.
      → verify: `npx tsc --noEmit` clean; `npm test -- ShipmentsPage` green including the new
      AC-11 matrix tests; the contract slicer still lists the two new ops.
- [x] 2. **Milestone 2 — UI integration: row actions, edit dialog, cancel confirmation.** Add the
      Actions column to `ShipmentsPage` with the exact matrix (Pending → Edit + Cancel; Assigned →
      Cancel only; InTransit/Delayed/Delayed/Cancelled → none; Viewer/Driver → none), mount
      `EditShipmentDialog` (pre-filled from `GET /shipments/{id}`, PATCH on save, field errors on
      400) and `CancelShipmentDialog` (explicit confirmation, note field), and on a 409 from either
      surface a message and refetch the row. → verify: `npm run build` (tsc + vite) clean;
      `npm test` fully green; every new test carries a `// LOGI-0008 AC-n` comment.
- [ ] 3. **Milestone 3 — arm verification + handoff.** Confirm the capabilities table matches the
      contract `x-roles` slice, re-run the full gate, one atomic commit
      `feat(LOGI-0008): frontend arm — shipment edit/cancel row actions`, `tracker seal`,
      `tracker handoff --ticket LOGI-0008 --from frontend --to qa` → verify: `tracker plan-slice
      --ticket LOGI-0008 --arm frontend` all steps done; `git status --short` clean apart from
      derived state; `tracker show --ticket LOGI-0008` → next=qa.

## 5. Risks / open questions
- **R1:** the PATCH body is a *partial* update, so a naive form that always sends all five fields
  would silently clear `destinationLat`/`destinationLng` when the user leaves them blank. The edit
  form therefore tracks the loaded detail and sends only changed keys; an explicit blank
  lat/lng is sent as `null` only when the user cleared a previously-set value.
- **R2:** AC-11 says Viewer and Driver "see no row actions at all", but the contract still lets a
  Driver POST non-terminal transitions. `permissions.ts` must therefore split the old single
  `transitionShipments` capability into `transitionShipments` (unchanged, LOGI-0006) and
  `cancelShipments` (Admin/Dispatcher, AC-10) rather than narrowing the existing one and breaking
  the LOGI-0006 behaviour.
- **R3:** `schema.d.ts` is generated; hand-editing it is forbidden. If `npm run generate:api` cannot
  read the YAML from the frontend package dir, run it from the repo root with the same output path
  rather than patching types by hand.
- **R4:** the list rows already carry everything the edit dialog needs except `atRisk`/`routeId`;
  AC-11 requires the dialog to be pre-filled from `GET /shipments/{id}`, so the dialog fetches the
  detail itself via `useShipment` (also proving the detail read works) instead of trusting the row.
- **R5:** the mock PATCH must not append a status-history row (an edit is not a transition) and must
  leave `priority`/`slaDueAt` untouched, or the vitest suite would contradict the sealed backend arm.
- Out of scope: Playwright specs (qa arm), route assignment/driver scoping (LOGI-0009/0010), the
  `LOGI-0007-F1/F2` follow-ups.

## 6. Exit gates
- `npm run build` in `src/frontend` clean (tsc + vite) and `npm test` fully green, no existing
  shipment test weakened.
- AC-11 asserted per role and per status, AC-3's field-keyed 400s asserted through the dialog, and
  the AC-10 Driver-cancel 403 asserted at the API level through the mock.
- Capabilities in `permissions.ts` match the `shipments` contract `x-roles` slice exactly.
- MSW parity: GET/PATCH `/:id` 404/400/409 semantics and the no-history-row rule match the sealed
  backend arm.
- One atomic commit; `tracker seal` + `HANDOFF frontend→qa` recorded; `tracker show --ticket
  LOGI-0008` → next=qa.
