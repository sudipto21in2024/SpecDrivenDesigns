---
ticket: LOGI-0008
arm: qa
status: locked
created: 2026-09-26T12:32:03.143Z
depends_on_plans: LOGI-0008-backend, LOGI-0008-frontend
---

## 1. Objective
LOGI-0008 QA: prove edit (PATCH Pending-only) + detail (GET by id) + cancel (BR-6 role-gated Cancelled transition) + BR-1/BR-2 non-regression e2e against real API + SQLite (no MSW), plus AC-11 UI seam via Shipments page object. Remote CI is async, never polled.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/shipments.ts` | modify | Add `getShipment` + `patchShipment` helpers (typed 2xx/4xx, `token:null` for 401); keep existing exports byte-compatible (AC-1..AC-7) | ~60 |
| `tests/e2e/pages/shipments.page.ts` | modify | Add AC-11 drivers: `rowActions/ref`, `openEdit/fillEdit/saveEdit`, `openCancel/confirmCancel` + snackbar probe | ~90 |
| `tests/e2e/shipment-edit.spec.ts` | create | API edit/detail AC-1 AC-3..AC-6; every test `// LOGI-0008 AC-n` | ~70 |
| `tests/e2e/shipment-cancel.spec.ts` | create | API guards/cancel AC-2 AC-7..AC-10 AC-12 | ~75 |
| `tests/e2e/shipment-ui.spec.ts` | create | Thin UI seam AC-11 (matrix + dialog flows) | ~55 |
| `specs/features/LOGI-0008-edit-cancel-shipment.md` | modify | Close chore: `spec_approved` → `done` once sealed | 1 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0008-edit-cancel-shipment.md` | §4 AC-1..AC-12 | source of truth + BR-1/BR-2 rules |
| `tests/e2e/support/shipments.ts` | full | fixture idioms to extend without breaking LOGI-0006/0007 |
| `tests/e2e/pages/shipments.page.ts` | full | page-object idioms (accessible selectors, dialog drivers) |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | 358-381 | row-action aria-labels the page object drives |
| `Docs/business-rules/BR-sla-rules.md` | rules 1.5, 2.3 | slaDueAt immutable; Cancelled excluded from at-risk |

## 4. Steps (each with verify gate)
- [x] 1. **M1 Logic — API matrix AC-1..AC-10 + AC-12.** Add `getShipment/patchShipment`; new spec covers AC-1 happy path, AC-2 Pending-only 409s, AC-3 field-keyed 400s, AC-4 server-owned/priority 400s, AC-5 404s, AC-6 detail shape, AC-7 authz, AC-8 cancel happy path, AC-9 cancel 409s, AC-10 Driver-cancel 403, AC-12 slaDueAt/atRisk. → verify: new spec green locally on throwaway DB.
- [x] 2. **M2 Integration+UI — AC-11 seam + e2e happy paths.** Page-object edit/cancel drivers; role×status matrix, dialog pre-fill→PATCH→refresh, cancel confirm+note, 409 surfacing. No `src/**` or `contracts/**` changes. → verify: new spec fully green.
- [x] 3. **M3 Verification + handoff.** Full local e2e green, every test `// LOGI-0008 AC-n`, one atomic commit, spec → `done`, seal + handoff qa→done. → verify: `git status` only §2 files.

## 5. Risks / open questions
- Kill :5199/:5173 before local runs so `start-api.mjs` starts fresh; scope counts to own warehouse/id.
- slaDueAt asserted byte-identical (BR-1 1.5); Cancelled atRisk=false (BR-2 2.3); no wall-clock math.
- Seeded codes `SHPX-…` never match `^SHP-[0-9]{6}$`; shape assertions use API-created rows.
- Helpers send plain JSON; explicit `null` only for coordinate-clear; `{}` for AC-3 body 400.
- UI scope thin (vitest owns fine matrix); drop + journal rather than touch `src/**` if undrivable.
- Never write `nul`; check `git status --short` before commits.

## 6. Exit gates
- AC-1..AC-12 proven on real API + SQLite, no MSW; local e2e fully green 0 flakes.
- Real-JWT authz matrix (401 anon; Viewer 403 PATCH/cancel + 200 GET; Driver 403 edit/cancel, non-cancel Driver 2xx; Admin/Dispatcher 2xx).
- Nothing outside §2 changed; LOGI-0006/0007 specs still green; journal sealed; handoff qa→done; spec `done`.
