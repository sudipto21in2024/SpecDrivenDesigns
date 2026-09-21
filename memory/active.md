# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **Session 2026-09-21: LOGI-0005 backend arm SEALED — handoff backend→frontend recorded. Next: plan the frontend arm.**
  - Executed INLINE by the main thread (user explicitly approved overriding the fresh-window
    rule for this environment; agent name `orchestrator-inline` in the event log). All 5 steps
    green with per-step commits: `2195d47` (entity+migration) → `80a4664` (commands/queries+DI) →
    `da6df72` (endpoints+wiring) → `204708e` (tests 42/42) → `c615744` (seal+journal+handoff).
  - Gates: `dotnet build` pass ×3; `dotnet test` full suite **42/42** (auth+warehouses+vehicles+drivers).
  - Migration `20260921041528_LOGI-0005_AddDrivers` (dotnet-ef 9.0.8): drivers table, UNIQUE
    `ix_drivers_license_number`, nullable FK user_id→users.id NO ACTION (no ON DELETE clause =
    SQLite default). EF also auto-added a NON-unique `IX_drivers_user_id` (FK convention —
    documented in the journal; the 1:1 rule stays handler-enforced).
  - Semantics delivered per plan: license dup → 409 POST+PUT (excludes self + UNIQUE backstop);
    nonexistent userId → 400 errors.userId; linked-elsewhere → 409 (excludes self); PUT null or
    omitted clears the link; status default Active; no createdAt; list id asc; RBAC = contract
    x-roles (Driver role 403 on all /drivers, incl. reads).
- Scoreboard: LOGI-0000 ✅ · 0001 ✅ · 0002 ✅ · 0003 ✅ · 0004 ✅ ·
  **LOGI-0005 🟡 — architect ✅ (`a3a369d`) · backend ✅ (`c615744`, 42/42) · frontend ⬜ · qa ⬜**.

## Next action
1. **Plan the LOGI-0005 frontend arm** (planner phase may run inline — it writes only state/):
   skill `plan-arm` → §3 reads (frontend-conventions doc, `src/frontend` vehicles-feature idiom,
   typed-client regen path) → `state/plans/LOGI-0005-frontend.plan.md` (typed-client regen +
   `features/drivers/*`, UI model has NO createdAt, PUT always sends the current userId) →
   `validate-plan` clean → `tracker plan lock`.
2. Then dispatch the frontend EXECUTOR (fresh window via `new_task`, or user-approved inline
   again — ask first). After seal: verify HANDOFF, update memory, push, watch CI. Then the qa
   arm (`tests/e2e/drivers.spec.ts` AC-1..AC-9), then close the ticket.
3. Push each seal and watch CI (no gh CLI — verify via GitHub web or the public API).

## Blockers / open questions
- **CI `e2e` job red platform-wide (not this ticket's regression):** runs #11–#14 all fail at the
  e2e step — login returns 500 mid-run (variable onset: 9–22 tests in), including on docs-only
  commits (#11–#13). Runs #10 and earlier were green; Node 20→24 forcing + a .NET 10 runtime now
  installed by setup-dotnet changed in between. `build-and-test` (backend+frontend+spectral) is
  green on #14. Deterministic (rerun + docs-only #15 failed too); see memory/progress.md. Frontend/qa arms should not be
  trusted to CI until this is root-caused (local suites are the gates meanwhile).
- None blocking the backend arm itself: journal LOGI-0005 #backend-arm records the 1:1 race
  accepted for v1; non-unique `IX_drivers_user_id` convention artifact; deferred items (role=Driver
  check on the link, delete-referenced 409 in LOGI-0009, status lifecycle).
- `graphify extract` unavailable (0.6.0 lacks the 0.9.33 `extract` command) — §3 scoping done by
  targeted reads; optional to update graphify later.
- `gh` CLI not installed — CI checks done via the public API + the repo's own stored credential
  (used read-only for log/artifact download; token never echoed).

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task` (user may approve inline overrides).
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
- Editor-written plan files land CRLF — `sed -i 's/\r$//'` before validate/lock;
  `git check-ignore` consults the index (tracked files always report unignored).
