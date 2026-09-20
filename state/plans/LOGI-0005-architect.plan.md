---
ticket: LOGI-0005
arm: architect
status: done
created: 2026-09-20T16:29:38.962Z
depends_on_plans:
---

## 1. Objective
LOGI-0005 spec-first phase (PRD F3): author specs/features/LOGI-0005-drivers-crud.md, extend contracts/v1-openapi.yaml additively with /drivers CRUD (ADR-007 x-roles, enums from approved schema section drivers), pass spectral + additions-only review, human checkpoint before backend/frontend/qa fan-out.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0005-drivers-crud.md` | create | Spec — AC-1..AC-9 source | ~125 |
| `contracts/v1-openapi.yaml` | modify | Architect — `/drivers` + `/drivers/{id}` + `Driver*` schemas, additive only | ~150 |
| `memory/journal/LOGI-0005.md` | create | Journal — architect-arm section | ~30 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0004-vehicles-crud.md` | full | Sibling CRUD spec to mirror (AC shape, out-of-scope style) |
| `contracts/v1-openapi.yaml` | 96-202, 315-419 | Vehicle/warehouse patterns to clone for /drivers (schema idiom, responses components, x-roles, PagedResponse allOf) |
| `Docs/ProjectTechGuidence/04-database-schema.md` | 39-47, 78-95, 120-133 | Approved driver columns/enums (user_id FK NULL, full_name, license_number UNIQUE, phone, status) + users + indexing rules |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | full | Contract conventions (plural nouns, PagedResponse, x-roles, ProblemDetails) |
| `Docs/productInfo/12-PRD.md` | 24-30, 50-54, 114-119 | PRD F3 scope + F12/F13 boundary + driver-login open question |
| `Docs/adr/007-auth-model-identity-jwt-rbac.md` | full | x-roles + 401/403 convention + ownership-scoping negative |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | full | Spec template structure (§1..§8 + downstream artifacts) |

## 4. Steps (each with verify gate)
- [x] 1. Author `specs/features/LOGI-0005-drivers-crud.md` per template `09-sample-feature-spec.md`, front matter `status: draft`: summary (Dispatcher, PRD F3, RBAC day one per ADR-007), roles (Admin full CRUD / Dispatcher create+update / Viewer read-only / Driver role excluded from master data — F12/F13 are separate surfaces), preconditions (LOGI-0003 enforced), AC-1..AC-9 (create happy path, fullName required, licenseNumber unique -> 409, status enum + default Active, optional user link: userId nonexistent -> 400, userId already linked -> 409, PUT sets/clears the link, pagination + q/status filters, get/update/delete + 404s, RBAC 401/403), out-of-scope (route assignment BR-4 -> LOGI-0009, ownership scoping -> LOGI-0009/0010/0013, F12/F13 driver self-service, soft delete, status lifecycle), data touched (`drivers` new table + `users` reads), NFRs (<300ms list p95; no createdAt in payload — approved schema §drivers has no created_at) → verify: `grep -c "AC-[1-9]"` on the spec = 9 headings and §1..§8 headings all present
- [x] 2. Extend `contracts/v1-openapi.yaml` (additive only): `DriverRequest` (fullName 1..200, licenseNumber 1..40, phone <=40 optional, status enum Active/OffDuty/Suspended default Active, userId int64 optional) + `DriverResponse` (+id, +userId nullable, NO createdAt) after `VehicleResponse` (before PagedResponse); `GET /drivers` (paged allOf PagedResponse idiom, x-roles [Admin, Dispatcher, Viewer], params page/pageSize/q/status), `POST /drivers` (x-roles [Admin, Dispatcher], 201+400+401+403+409), `/drivers/{id}` GET/PUT/DELETE mirroring `/vehicles/{id}` incl. 409 on DELETE declared for the LOGI-0009 routes FK → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` → 0 errors; `git diff --stat contracts/` additions-only; operationIds listDrivers/createDriver/getDriver/updateDriver/deleteDriver unique (grep count 1 each)
- [x] 3. Human checkpoint + seal: present spec+contract summary to the human per `03-spec-driven-workflow.md` (SPEC_REVIEW→SPEC_APPROVED, CONTRACT_REVIEW→CONTRACT_APPROVED); on approval set spec front matter `status: spec_approved`, write `memory/journal/LOGI-0005.md` architect-arm section (incl. migration plan note: additive `<Timestamp>_LOGI-0005_AddDrivers`, unique index `license_number`, nullable FK `user_id`→users.id default NO ACTION per schema) → verify: journal exists; `git status --short` shows only the three §2 files; single docs commit `docs(LOGI-0005): architect — driver CRUD spec (AC-1..AC-9) + /drivers contract (steps 1-3/3)`

## 5. Risks / open questions
- One-to-one user link: schema ER says `User 1---1 Driver (optional link)` — interpreting "a user already linked to another driver" as 409 Conflict; whether the linked user must hold the Driver role is NOT specified — v1 validates existence + 1:1 only, role check left as an open question (PRD §9 leaves driver-login rollout open).
- `license_number` max length is not in the approved schema; contract-level 1..40 is an input constraint only (same class of choice as warehouse name 1..200 / vehicle plate 1..20), flagged for the checkpoint.
- No createdAt on drivers (approved schema §drivers has no created_at) — the response deliberately omits it; list ordering is id asc (no timestamp column to sort by). Do not "fix" the schema mirror from this arm.
- Delete-when-referenced-by-route (BR-4 / `routes.driver_id` FK): 409 declared only, enforcement lands with LOGI-0009 (same deferred pattern as vehicles).
- No escalation triggers: schema/enums pre-approved, additive contract change, auth matrix copied from ADR-007 (no security-sensitive decision).

## 6. Exit gates
- Spec `specs/features/LOGI-0005-drivers-crud.md` complete (§§1-8, AC-1..AC-9), front matter `status: spec_approved` after the checkpoint.
- Contract extension additive, spectral 0 errors, 401/403 on every new protected op, camelCase fields matching schema mirror names, no createdAt invented.
- Human checkpoint approval recorded in journal; handoff architect→backend ready (migration + backend + frontend + qa fan-out per workflow).

