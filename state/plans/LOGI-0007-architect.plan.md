---
ticket: LOGI-0007
arm: architect
status: locked
created: 2026-09-23T09:53:22.492Z
depends_on_plans: LOGI-0006-architect,LOGI-0006-backend,LOGI-0006-frontend,LOGI-0006-qa
---

## 1. Objective
Create shipment (F5) + shipment list/search (F8) per BR-1/BR-2/BR-6/BR-7: feature spec AC-1..AC-11 + contract slices (POST/GET /shipments, ShipmentRequest/ShipmentResponse) + shipments resource in the contract slicer + human checkpoint

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0007-create-shipment.md` | create | Spec — AC-1..AC-11 source (create + list/search; reuses Shipment.Create, the initial audit row and the LOGI-0006 transition endpoint) | ~150 |
| `contracts/v1-openapi.yaml` | modify | Architect — `POST /shipments` + `GET /shipments` + `ShipmentRequest`/`ShipmentResponse` schemas, additive only | ~90 |
| `tools/contract/index.mjs` | modify | Tooling follow-up flagged by LOGI-0006 §5: register the `shipments` resource in RESOURCES so `contract:shipments` slice pointers resolve | ~1 |
| `memory/journal/LOGI-0007.md` | create | Journal — architect-arm section (written by `tracker seal`) | ~5 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `Docs/productInfo/11-BRD.md` | 62-77 | BR-1 (due = created_at + 48h Standard / +12h Express), BR-6 (Admin/Dispatcher create; Viewer read-only), BR-7 (Pending start state; transitions owned by LOGI-0006) |
| `Docs/business-rules/BR-sla-rules.md` | 14-46, 49-92 | BR-1 rules 1.1-1.7 (server `created_at` anchor, default Standard, unknown priority fails loudly) + BR-2 rules 2.1-2.7 with the read-time projection seam explicitly on the LOGI-0007 list query |
| `Docs/ProjectTechGuidence/04-database-schema.md` | 49-65, 109-126 | `shipments` columns (reference_code, origin_warehouse_id FK, destination_*, weight_kg, status, priority, sla_due_at, created_at/updated_at), `shipment_status_history`, index rules (unique reference_code, status + sla_due_at indexes) |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | 6-29, 70-97 | Plural nouns, paged envelope (`items/page/pageSize/totalCount/totalPages`), the `/shipments` worked example (x-roles, 201/400) |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | 8-97 | Spec template (§1..§8 + downstream artifacts) and the LOGI-0007 worked example (AC-1..AC-5) folded in |
| `Docs/productInfo/12-PRD.md` | 33-40 | F5 (create: origin warehouse, destination address, weight, priority; generated reference code; BR-1 due date) + F8 (list filters status/priority/warehouse/SLA-risk, paginated, sortable by SLA due) |
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | full | Sibling spec to mirror (AC shape, deferral style, downstream-artifacts section) — the transition endpoint this ticket reuses |
| `specs/features/LOGI-0005-drivers-crud.md` | 1-60 | Sibling CRUD spec conventions (front matter, preconditions, out-of-scope style) |
| `contract:warehouses (x-roles, params, responses)` | slice | GET-list + POST idiom to clone (paged allOf envelope, 201 + ValidationProblem/401/403) |
| `contract:vehicles (schemas)` | slice | Request/response schema idiom (required + enums + range-validated numbers) |

## 4. Steps (each with verify gate)
- [x] 1. Author `specs/features/LOGI-0007-create-shipment.md` from the template `09-sample-feature-spec.md`, front matter `status: draft`: summary (F5 create + F8 list/search, reusing the LOGI-0006 state machine, the initial Pending audit row and `GET /shipments/{id}`-free read model), actors/roles (Admin + Dispatcher create; Viewer read-only list; Driver cannot create per BR-6, list access deferred to the own-route scoping of LOGI-0009/0010), preconditions (auth enforced from LOGI-0003; warehouses CRUD live; `shipments`/`shipment_status_history` already migrated by LOGI-0006), AC-1..AC-11 — AC-1 happy-path create (201, status Pending, `SHP-######`, initial history row with fromStatus null + creator as actor, shipment appears in the list), AC-2 BR-1 due date (Standard +48h / Express +12h anchored on server `created_at`; client-supplied createdAt/slaDueAt never trusted), AC-3 priority defaults to `Standard` when omitted and an unknown priority fails loudly with 400, AC-4 create validation 400 (weightKg > 0, destinationAddress required, unknown originWarehouseId → `errors.originWarehouseId`), AC-5 reference-code uniqueness under concurrent creates, AC-6 paged list envelope + defaults + 400 on invalid page/pageSize, AC-7 filters status/priority/originWarehouseId/q/slaRisk AND-combined + unknown enum → 400, AC-8 sort `createdAt|-createdAt|slaDueAt|-slaDueAt` + deterministic tiebreak + unknown sort → 400, AC-9 BR-2 at-risk read-time projection (inclusive boundary, whole-second, null slaDueAt → false, excludes Delivered/Cancelled, never stored) with `slaRisk` as its filter, AC-10 RBAC matrix (401 anonymous; 403 Viewer and Driver on create; 200 list for Admin/Dispatcher/Viewer), AC-11 integration seam with LOGI-0006 (a created Pending shipment is immediately transitionable and its `status-history` starts with the initial row); out-of-scope (edit/cancel LOGI-0008, routes LOGI-0009/0010, board LOGI-0011, dashboard aggregates LOGI-0012 — only the BR-2 read-time projection lands here per the BR-SLA enforcement seam, geocoding, bulk import) → verify: spec has §1..§8 headings, 11 `**AC-` headings, front matter id/title/status/depends_on present
- [x] 2. Extend `contracts/v1-openapi.yaml` (additive only): `ShipmentRequest` (required originWarehouseId, destinationAddress, weightKg; optional destinationLat/Lng range-validated, priority enum default Standard) + `ShipmentResponse` (id, referenceCode pattern `^SHP-\d{6}$`, originWarehouseId, destinationAddress/Lat/Lng, weightKg, status enum, priority enum, slaDueAt, routeId nullable, atRisk read-time boolean, createdAt, updatedAt) beside the existing schemas; `GET /shipments` (x-roles Admin/Dispatcher/Viewer; params page/pageSize/status/priority/originWarehouseId/slaRisk/q/sort; 200 as the allOf PagedResponse envelope; 400/401/403) + `POST /shipments` (x-roles Admin/Dispatcher; 201 ShipmentResponse; 400/401/403) inserted before `/shipments/{id}/status-transitions`; register the `shipments` resource in `tools/contract/index.mjs` RESOURCES (schemas ShipmentRequest/ShipmentResponse/StatusTransitionRequest/ShipmentStatusEvent/PagedResponse; paths `/shipments` + both status sub-resources) → verify: spectral lint 0 errors; `git diff --stat contracts/` additions-only; operationIds createShipment/listShipments unique (grep count 1 each); `node tools/contract/index.mjs show --resource shipments --fields x-roles` prints the 3 expected rows and `--resource warehouses` still resolves (no regression)

- [ ] 3. Human checkpoint + seal: present the spec + contract summary per `03-spec-driven-workflow.md` (SPEC_REVIEW→SPEC_APPROVED, CONTRACT_REVIEW→CONTRACT_APPROVED); on approval set the spec front matter `status: spec_approved`, seal the architect arm (`tracker seal`), hand off architect→backend → verify: journal section exists; `git status --short` shows only the four §2 files; single docs commit `docs(LOGI-0007): architect — create shipment + list/search spec (AC-1..AC-11) + /shipments contract (steps 1-3/3)`

## 5. Risks / open questions
- **Scope:** F5 (create) + F8 (list/search) both land here per `memory/active.md`. Shipment detail `GET /shipments/{id}` is deferred to LOGI-0008 (which needs it for edit) — flagged at checkpoint.
- **Driver role:** BR-6 gives Driver no create; the list x-roles excludes Driver (per the `05-api-contract-standards` example) — own-route visibility is enforced from LOGI-0009/0010, mirroring the LOGI-0006 deferral. Flag at checkpoint.
- **`atRisk` is a computed read-time field** (BR-sla-rules 2.5 — no stored column, and §5 of that doc rules out an `at_risk`/`breached` column). It is additive in `ShipmentResponse` and must never be persisted. Flag at checkpoint.
- **Missing shipment on create is a validation failure, not a 404:** unknown `originWarehouseId` → 400 with `errors.originWarehouseId`, mirroring the `DriverUserLink` precedent (FK existence is validated in the Application layer, not surfaced as a missing request resource). Flag at checkpoint.
- **Fail-loud filters:** unknown status/priority/sort values → 400 (spirit of BR-1 rule 1.7) instead of silently empty pages. Flag at checkpoint.
- **Tooling edge:** the slicer edit touches `tools/contract/index.mjs`, outside the architect arm's nominal write list (LOGI-0006 §5 recorded it as a follow-up). It is a single additive table row needed so `contract:shipments` slice pointers resolve in downstream plans; no behaviour change to existing resources.
- **201 + body, no Location header:** matches the existing warehouse/vehicle create idiom, kept for consistency.

## 6. Exit gates
- Spec complete (§§1-8, AC-1..AC-11), front matter `status: spec_approved` after the checkpoint.
- Contract additive only, spectral 0 errors, `POST /shipments` + `GET /shipments` documented with 400/401/403 and the paged envelope, camelCase names matching the DB schema mirror.
- Slicer resource `shipments` resolves; existing resources (`drivers`, `vehicles`, `warehouses`, `auth`) unaffected.
- Human checkpoint recorded in the journal; handoff architect→backend ready (backend: `CreateShipmentCommand` + `SlaPolicy` + `ListShipmentsQuery`; **no migration** — tables and indexes already exist from LOGI-0006).
