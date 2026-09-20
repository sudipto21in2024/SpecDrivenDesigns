# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **Session 2026-09-20: LOGI-0004 pushed and CI-verified (run #10 `fa324be` success); LOGI-0005
  (Driver CRUD, PRD F3) started — architect arm COMPLETE + handed off.**
  - Plan `state/plans/LOGI-0005-architect.plan.md` locked and 3/3 ticked; human checkpoint
    approved (SPEC_REVIEW→SPEC_APPROVED + CONTRACT_REVIEW→CONTRACT_APPROVED, as presented).
  - Spec `specs/features/LOGI-0005-drivers-crud.md` (AC-1..AC-9, `spec_approved`) + contract
    `/drivers` + `/drivers/{id}` + `DriverRequest`/`DriverResponse` (+149/−0 additive, spectral
    0 errors with `contracts/.spectral.yaml`, 20 unique operationIds) + journal
    `memory/journal/LOGI-0005.md`. Commit `a3a369d` (docs, manifest-exact); handoff
    architect→backend recorded; plan status done.
  - Key spec decisions: RBAC mirrors vehicles (read [Admin, Dispatcher, Viewer], write
    [Admin, Dispatcher], delete [Admin]; Driver role 403 on master data — F12/F13 are the
    driver surfaces); optional `User 1---1` link (userId nonexistent → 400, already linked →
    409, PUT userId null clears); status Active/OffDuty/Suspended default Active; **no
    createdAt** (approved schema §drivers has no created_at); licenseNumber unique (409),
    contract length 1..40; DELETE 409 declared-only until LOGI-0009 routes FK.
- Scoreboard: LOGI-0000 ✅ · LOGI-0001 ✅ · LOGI-0002 ✅ · LOGI-0003 ✅ · LOGI-0004 ✅ ·
  **LOGI-0005 🟡 — architect ✅ (`a3a369d`) · backend ⬜ · frontend ⬜ · qa ⬜**.

## Next action
1. **LOGI-0005 backend arm** (fresh-window child task per protocol; main thread never edits
   source): `tracker ready` → `resume-check`/`claim` → plan+lock `state/plans/LOGI-0005-backend.plan.md`
   → MediatR CRUD mirroring vehicles, unique-license 409, userId existence (400) / 1:1 (409)
   checks, migration `<Timestamp>_LOGI-0005_AddDrivers` (unique index `license_number`, nullable
   FK `user_id`→users.id NO ACTION), endpoint RBAC = contract x-roles, tests AC-1..AC-9.
2. Then frontend arm (typed-client regen + `features/drivers/*`, no createdAt in the UI model),
   then qa arm (`tests/e2e/drivers.spec.ts` AC-1..AC-9). Push after each seal and watch CI.

## Blockers / open questions
- None. Tree clean after the chore commit; `a3a369d` is docs-only (CI green expected).
- Deferred (journal LOGI-0005): role=Driver requirement on the user link; delete-referenced-by-
  route 409 enforcement (LOGI-0009); driver status lifecycle needs a BRD revision if wanted.

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task`.
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
- Editor-written plan files land CRLF — `sed -i 's/\r$//'` before validate/lock;
  `git check-ignore` consults the index (tracked files always report unignored).

