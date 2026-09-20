---
ticket: LOGI-0004
arm: architect
status: done
created: 2026-09-20T05:47:14.617Z
depends_on_plans:
---

## 1. Objective
LOGI-0004 spec-first phase (PRD F2): author `specs/features/LOGI-0004-vehicles-crud.md`, extend `contracts/v1-openapi.yaml` with `/vehicles` CRUD (auth pattern per ADR-007, enums from approved schema §vehicles), pass spectral + breaking-change review, then human checkpoint per `03-spec-driven-workflow.md` before backend/frontend/qa arms fan out.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0004-vehicles-crud.md` | create | Spec — AC-1..AC-9 source | ~110 |
| `contracts/v1-openapi.yaml` | modify | Architect — `/vehicles` + `/vehicles/{id}` + `Vehicle*` schemas, additive only | ~130 |
| `memory/journal/LOGI-0004.md` | create | Journal — architect-arm section | ~30 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0001-warehouses-crud.md` | full | Sibling CRUD spec to mirror (AC shape, out-of-scope style) |
| `specs/features/LOGI-0003-auth-roles.md` | §2, §4 AC-4..AC-6 | Role matrix now enforced (no open endpoints) |
| `contracts/v1-openapi.yaml` | 26-165, 179-276 | Warehouse CRUD + auth patterns to clone for /vehicles |
| `Docs/ProjectTechGuidence/04-database-schema.md` | §vehicles | Approved vehicle columns/enums (plate UNIQUE, type, capacity_kg, status) |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | full | Contract conventions (plural nouns, PagedResponse, x-roles, ProblemDetails) |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | full | Spec template structure (§1..§8 + downstream artifacts) |
| `Docs/productInfo/12-PRD.md` | §3.1 F2 | PRD F2 scope: vehicle CRUD (plate number, type, capacity, status) |
| `Docs/adr/007-auth-model-identity-jwt-rbac.md` | full | x-roles + 401/403 convention to apply to new endpoints |

## 4. Steps (each with verify gate)
- [x] 1. Author `specs/features/LOGI-0004-vehicles-crud.md` per template `09-sample-feature-spec.md`: summary (Dispatcher, PRD F2), roles (Admin full CRUD / Dispatcher create+update / Driver+Viewer read-only), preconditions (LOGI-0001 done, LOGI-0003 enforced), AC-1..AC-9 (create happy path, plate required+unique, type enum, capacity>0, status enum + default Available, pagination, get/update/delete incl. 404s, RBAC 401/403), out-of-scope (vehicle→route assignment LOGI-0009, capacity enforcement LOGI-0010), data touched (`vehicles` reads/writes), NFRs (<300ms list p95, ISO8601 UTC) → verify: `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0004-architect.plan.md` still lists the spec under §3-or-§2 correctly and spec §§1-8 + AC-1..AC-9 all present
- [x] 2. Extend `contracts/v1-openapi.yaml` (additive only — no existing path/schema touched): `VehicleRequest` (plateNumber 1..20, type enum Van/Truck/Trailer, capacityKg exclusiveMinimum 0, status enum default Available), `VehicleResponse` (+id, +createdAt), `GET /vehicles` (paged `allOf PagedResponse` idiom, x-roles [Admin, Dispatcher, Viewer], params page/pageSize/q/status/type, 200+401+403), `POST /vehicles` (x-roles [Admin, Dispatcher], 201+400+401+403), `/vehicles/{id}` GET/PUT/DELETE mirroring warehouses incl. `Conflict` 409 only on DELETE description (route FK lands in LOGI-0009; v1 hard-delete like warehouses) + 401/403/404 on all three → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml` → 0 errors, and `git diff --stat contracts/` shows only additions
- [x] 3. Migration plan note + human checkpoint: record that `vehicles` table comes from the already-approved `04-database-schema.md` §vehicles (no new ADR: enums Van/Truck/Trailer + Available/InRoute/Maintenance pre-approved; migration `<Timestamp>_LOGI-0004_AddVehicles` additive, unique index plate_number); set spec front matter `status: spec_approved` + journal architect-arm section in `memory/journal/LOGI-0004.md`; present spec+contract diff to human per `03-spec-driven-workflow.md` SPEC_REVIEW→SPEC_APPROVED and CONTRACT_REVIEW→CONTRACT_APPROVED gates → verify: human approval recorded; `git status --short` shows only the three §2 files

## 5. Risks / open questions
- Delete semantics when routes reference the vehicle (LOGI-0009 FK): v1 declares hard delete + 409 Conflict declared on contract only when a referencing route exists; enforcement detail deferred to LOGI-0009 — flagged in spec §5, not decided here.
- Status transitions (Available↔InRoute↔Maintenance) have no BRD rule — free-form PUT in v1; a BR-8-style lifecycle (if needed) would be a new spec + BRD revision, not invented here.
- No escalation triggers: enums/schema pre-approved, additive contract change, auth pattern copied from ADR-007 (no security-sensitive decision).

## 6. Exit gates
- Spec `specs/features/LOGI-0004-vehicles-crud.md` complete (§§1-8, AC-1..AC-9), front matter `status: spec_approved`.
- Contract extension additive, spectral 0 errors, 401/403 on every new protected op, camelCase fields matching schema mirror names.
- Human checkpoint approval recorded in journal; handoff architect→backend ready (DB migration + backend + frontend + qa fan-out per workflow).
