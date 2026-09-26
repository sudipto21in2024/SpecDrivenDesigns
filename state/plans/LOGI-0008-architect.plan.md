---
ticket: LOGI-0008
arm: architect
status: done
created: 2026-09-26T06:08:26.330Z
depends_on_plans:
---

## 1. Objective
LOGI-0008 architect arm: specify F6 (edit fields while Pending; cancel from Pending/Assigned per BR-6/BR-7) in specs/features/LOGI-0008-edit-cancel-shipment.md (ACs + defaults) and extend the API contract additively (PATCH /shipments/{id} + POST /shipments/{id}/cancel with x-roles Admin/Dispatcher) plus the contract slicer resource, ending in a human checkpoint. No src/** or tests/** work in this arm.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0008-edit-cancel-shipment.md` | create | F6 spec: AC-1..AC-12 + §5 out-of-scope + §7 defaults | ~240 |
| `contracts/v1-openapi.yaml` | modify (additive) | `GET /shipments/{id}`, `PATCH /shipments/{id}`, `ShipmentUpdateRequest`, role×toStatus cancel rule text | ~+90 |
| `tools/contract/index.mjs` | modify | `shipments` resource lists the two new operations | ~6 |
| `state/plans/LOGI-0008-architect.plan.md` | modify | this plan | auto |
| `memory/journal/LOGI-0008.md` | append (tracker seal) | architect-arm section + checkpoint decisions | ~10 |
| `state/events.jsonl` | append (CLI only) | PLAN_*, TASK_STARTED, STEP_DONE, HANDOFF | ~7 |
| `state/handoffs.jsonl` | append (CLI only) | HANDOFF architect→backend | 1 |
| `state/tasks.json` | derived (CLI only) | snapshot rebuild | auto |
| `memory/active.md` | regenerate (tracker active) | pointer to LOGI-0008 backend arm | ~20 |
| `memory/progress.md` | modify (tracker progress) | LOGI-0008 row → architect drafted / checkpoint | 1 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `Docs/productInfo/12-PRD.md` | 33-40 | F6 exact wording (edit while Pending; cancel while Pending/Assigned) + F7 audit rule |
| `Docs/productInfo/11-BRD.md` | 66-78 | BR-6 (only Admin/Dispatcher create/edit/cancel) + BR-7 (legal transitions incl. →Cancelled) |
| `Docs/business-rules/BR-sla-rules.md` | 14-46 | BR-1 offsets + the "LOGI-0007 sets sla_due_at; no other ticket writes this column" enforcement seam |
| `specs/features/LOGI-0007-create-shipment.md` | slices (`--section scope`, `--section defaults`) | two explicit deferrals into LOGI-0008 (`GET /shipments/{id}`, cancel UX) + defaults style to mirror |
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | slices (`--section ac`) | AC-2 (Cancelled only from Pending/Assigned, 409 otherwise) + AC-8 RBAC matrix incl. Driver |
| `contracts/v1-openapi.yaml` | slice only (`--resource shipments`, `--fields x-roles`) | existing ops/x-roles; new ops must not disturb them |
| `tools/contract/index.mjs` | 14-21 | `RESOURCES.shipments` map to extend |
| `state/plans/LOGI-0008-architect.plan.md` | this file | manifest + gates |

## 4. Steps (each with verify gate)
- [ ] 1. Milestone 1 — Spec: write `specs/features/LOGI-0008-edit-cancel-shipment.md` (§§1-8 mirroring LOGI-0007) for F6: `GET /shipments/{id}` detail, `PATCH /shipments/{id}` edit (Pending-only; §7 default = `priority` immutable so BR-1 keeps its single `sla_due_at` writer), and cancel through the existing LOGI-0006 transition endpoint (`toStatus: Cancelled`) with the new BR-6 role rule (Driver 403 on Cancelled) → verify: `node tools/spec/index.mjs show --ticket LOGI-0008 --section ac` / `--section summary` / `--section scope` all resolve; every AC numbered AC-1..AC-12 with Given/When/Then and the `// LOGI-0008 AC-n` traceability convention stated
- [x] 2. Milestone 2 — Contract (additive) + slicer: add `GET /shipments/{id}` and `PATCH /shipments/{id}` + `ShipmentUpdateRequest` (x-roles: GET Admin/Dispatcher/Viewer, PATCH Admin/Dispatcher), document the Driver-cannot-cancel rule on the transitions operation, register both operationIds in the `shipments` slicer resource → verify: `npx spectral lint contracts/v1-openapi.yaml` 0 errors; `node tools/contract/index.mjs show --resource shipments --fields x-roles` lists the new ops; `git diff --stat -- contracts/` additions-only
- [x] 3. Milestone 3 — Checkpoint + handoff + one atomic commit: record the checkpoint questions/decisions (O1-O4 defaults applied on merit), `tracker seal`, `tracker handoff --ticket LOGI-0008 --from architect --to backend`, commit `docs(LOGI-0008): spec + contract for edit/cancel shipment` → verify: journal carries the architect-arm seal incl. the checkpoint list; `tracker show --ticket LOGI-0008` next=backend; `git status --short` clean (manifest §2 only)

## 5. Risks / open questions
- **O1 priority editability:** BR-1's enforcement seam says only LOGI-0007 writes `sla_due_at`. Default: `priority` is **immutable** through PATCH (400 with `errors.priority` + a "create a new shipment" hint). The alternative (recompute from `created_at`) requires amending `Docs/business-rules/BR-sla-rules.md`, which is outside this arm's boundary. Checkpoint item.
- **O2 cancel path:** cancel reuses the LOGI-0006 transition endpoint (no new status-write path — the PROJECT_STATUS rule table pins BR-7 to `Shipment.TransitionTo` only); `x-roles` on that operation stay `[Admin, Dispatcher, Driver]`, so BR-6 becomes a role×toStatus rule that only the server can enforce and that the contract documents in prose. Checkpoint item.
- **O3 edit auditing:** field edits write no `shipment_status_history` row (F7 audits *status* transitions only). Default: no audit row in v1. Checkpoint item.
- **O4 Driver-cancel hole (found while planning):** the LOGI-0006 `x-roles` let a Driver JWT cancel *any* shipment today, which BR-6 forbids. LOGI-0008 closes Cancelled specifically; own-route scoping for the remaining Driver transitions stays LOGI-0009/0010.
- No migration is expected (edits touch existing columns only). If the EF schema turns out to need one, escalate before proceeding.

## 6. Exit gates
- Spec complete: §§1-8 present, AC-1..AC-12 in Given/When/Then form, traceability convention (`// LOGI-0008 AC-n`) mandated, §5 out-of-scope explicit (route assignment, Driver own-route scoping, BR-1 amendment, bulk edit).
- Contract additive only (`git diff -- contracts/v1-openapi.yaml` shows no deletions), `npx spectral lint contracts/v1-openapi.yaml` 0 errors, new ops carry `x-roles` plus 400/401/403/404/409 responses and camelCase schemas.
- Slicer: `node tools/contract/index.mjs show --resource shipments --fields x-roles` lists `getShipment` + `updateShipment`; `warehouses`/`drivers`/`vehicles`/`auth` slices unaffected.
- Checkpoint recorded in the journal (O1-O4 defaults + the rejected alternatives) and `HANDOFF architect→backend` written with gates; the backend arm scope is named (GetShipmentQuery + UpdateShipmentCommand + role×toStatus cancel rule; no migration).
- `tracker show --ticket LOGI-0008` → next=backend; `git status --short` clean apart from derived state files; one atomic commit for the arm.
