---
ticket: LOGI-0006
arm: architect
status: locked
created: 2026-09-22T05:59:55.828Z
depends_on_plans:
---

## 1. Objective
Shipment status lifecycle: TransitionTo state machine per BR-7 - spec + OpenAPI contract slice + human checkpoint

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | create | Spec — AC-1..AC-8 source (state machine, transition endpoint, audit history) | ~130 |
| `contracts/v1-openapi.yaml` | modify | Architect — `POST /shipments/{id}/status-transitions` + `GET /shipments/{id}/status-history` + transition schemas, additive only | ~120 |
| `memory/journal/LOGI-0006.md` | create | Journal — architect-arm section | ~30 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `Docs/productInfo/11-BRD.md` | 70-78 | BR-6 (roles allowed to transition) + BR-7 (exact legal transitions: Pending→Assigned→InTransit→Delivered; Cancelled from Pending/Assigned; Delayed from InTransit and back) |
| `Docs/ProjectTechGuidence/04-database-schema.md` | 49-64, 109-118 | Approved `shipments` columns (status enum) + `shipment_status_history` audit table (from_status, to_status, changed_by_user_id, changed_at, note) |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | 9-30, 70-95 | Transition convention: `POST /shipments/{id}/status-transitions` with `{toStatus, note}`; transitions are their own sub-resource, not raw PATCH |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | full | Spec template structure (§1..§8 + downstream artifacts) |
| `Docs/adr/007-auth-model-identity-jwt-rbac.md` | full | x-roles + 401/403 convention; Driver-role ownership scoping boundary |
| `specs/features/LOGI-0005-drivers-crud.md` | full | Sibling spec to mirror (AC shape, out-of-scope style) |
| `contract:vehicles (x-roles, responses)` | slice | x-roles/401/403/404 idiom to clone — resolve via `node tools/contract/index.mjs show --resource vehicles` |

## 4. Steps (each with verify gate)
- [x] 1. Author `specs/features/LOGI-0006-shipment-status-lifecycle.md` per template `09-sample-feature-spec.md`, front matter `status: draft`: summary (BR-7 state machine as a first-class sub-resource; audit trail BO-4), roles (Admin + Dispatcher transition any shipment; Driver role transitions only shipments on own routes — ownership scoping lands with LOGI-0009/0010, v1 notes the boundary; Viewer read-only), preconditions (LOGI-0003 enforced; shipments entity per approved schema §shipments — create/edit are LOGI-0007/0008), AC-1..AC-8 (legal forward transition Pending→Assigned→InTransit→Delivered each step; Cancelled allowed only from Pending/Assigned; Delayed only from InTransit, and InTransit restore from Delayed; illegal transition → 409 with ProblemDetails naming the legal next states; unknown/missing toStatus → 400; transition on nonexistent shipment → 404; each successful transition appends a `shipment_status_history` row with actor + timestamp + optional note; history listing ordered oldest→newest with from/to/who/when/note; RBAC 401/403), out-of-scope (shipment creation/edit/cancel UX → LOGI-0007/0008, route assignment BR-4/BR-5 → LOGI-0009/0010, SLA at-risk projection → BR-sla read-time seam, vehicle/driver free-form status stays CRUD per LOGI-0004/0005 §5), data touched (`shipments.status` update + `shipment_status_history` append in one transaction), NFRs (transition p95 <200ms; history query <300ms) → verify: `grep -c "AC-[1-8]"` on the spec = 8 headings and §1..§8 headings all present
- [ ] 2. Extend `contracts/v1-openapi.yaml` (additive only): `StatusTransitionRequest` (toStatus enum Pending/Assigned/InTransit/Delivered/Delayed/Cancelled, note ≤500 optional) + `ShipmentStatusEvent` (id, fromStatus nullable, toStatus, changedByUserId, changedAt, note nullable) + `ShipmentStatusHistoryPage` (allOf PagedResponse idiom) after existing schemas; `POST /shipments/{id}/status-transitions` (x-roles [Admin, Dispatcher, Driver], 200/400/401/403/404/409 — 409 documented as illegal-transition per BR-7) + `GET /shipments/{id}/status-history` (x-roles [Admin, Dispatcher, Driver, Viewer], paged, 401/403/404); description states the BR-7 transition table verbatim → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` → 0 errors; `git diff --stat contracts/` additions-only; operationIds createShipmentStatusTransition/listShipmentStatusHistory unique (grep count 1 each)
- [ ] 3. Human checkpoint + seal: present spec+contract summary per `03-spec-driven-workflow.md` (SPEC_REVIEW→SPEC_APPROVED, CONTRACT_REVIEW→CONTRACT_APPROVED); on approval set spec front matter `status: spec_approved`, write `memory/journal/LOGI-0006.md` architect-arm section (state machine table + note that 409 carries legal-next-states + Driver-role ownership scoping deferred to LOGI-0009/0010) → verify: journal exists; `git status --short` shows only the three §2 files; single docs commit `docs(LOGI-0006): architect — shipment status lifecycle spec (AC-1..AC-8) + status-transitions contract (steps 1-3/3)`

## 5. Risks / open questions
- Ordering: LOGI-0006 lands before shipment create (LOGI-0007), so no producer rows exist until 0007/0008. The state machine + history-table migration ship with 0006; CRUD reuses it. Flag at checkpoint.
- Driver-role transition on own-route shipments (BR-6) requires routes/assignment (LOGI-0009/0010). Default: list Driver in x-roles now, spec notes the deferral. Flag at checkpoint.
- `Delayed` is InTransit-scoped per BR-7; Delayed→Cancelled is NOT listed as legal (only Pending/Assigned → Cancelled) — interpreted strictly as illegal. Flag at checkpoint.
- 409 (vs 422) chosen for illegal transitions — state-conflict semantics, ProblemDetails carries legal next states. Flag at checkpoint.
- No escalation triggers beyond above: additive contract change, enums pre-approved in schema §shipments, auth matrix per ADR-007.

## 6. Exit gates
- Spec `specs/features/LOGI-0006-shipment-status-lifecycle.md` complete (§§1-8, AC-1..AC-8), front matter `status: spec_approved` after the checkpoint.
- Contract extension additive, spectral 0 errors, 401/403 on both new ops, 409 documented for illegal transitions per BR-7, camelCase fields matching schema mirror names.
- Human checkpoint approval recorded in journal; handoff architect→backend ready (migration: `shipment_status_history` table + state-machine validation in Application layer + backend/frontend/qa fan-out per workflow).
