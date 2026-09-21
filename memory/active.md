# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **Session 2026-09-21 (3): LOGI-0005 frontend arm SEALED — handoff frontend→qa recorded.**
  - First task was **recovery**: an *interrupted* inline frontend run had left drivers code in the tree
    with **no locked plan, no tracker events, no commits, no micro-log**, and `DriverFormDialog.tsx`
    misfiled under a stray `C/Sudipto/...` path (a root `nul` artifact too). `tracker resume-check` →
    `mid_step`. The plan `state/plans/LOGI-0005-frontend.plan.md` was therefore authored as an **audit**
    plan: steps 2-3 re-verify that work **by gate**, never by trust. Validated, locked, arm claimed
    (`orchestrator-inline`, inline per the user-approved override for this environment).
  - Per-step commits: `765e07c` (plan + recovery) → `b20588c` (typed client + capabilities + MSW) →
    `590fa74` (drivers UI) → `20d8fe2` (role-gated Drivers tab) → `f3c8e72` (vitest suite + fixes) →
    seal commit.
  - **Gates:** `npm run generate:api` → **zero diff** on `api/schema.d.ts` (238 insertions unchanged ⇒
    the typed client is provably generated from the contract); `npx tsc --noEmit` clean; `npm test`
    **41/41** (warehouses 8, auth 10, vehicles 7, drivers 16); `npm run build` OK.
  - **Audit fixes** (all inside the §2 manifest): `handleFormSubmit` typed `DriverInput` (2 TS errors the
    interrupted run never reached a gate for); `TablePagination` moved out of `<Table>` (invalid DOM
    nesting); search field `InputProps` → `inputProps` (aria-label must reach the input).
  - **MUI gotcha recorded:** `Tabs` (v5) injects `value`/`onChange`/`indicator` via `cloneElement` on
    **direct** children and has no TabsContext — a `Tab` wrapped in another component renders but never
    switches (first attempt: 15/16 specs failed). Tab state now lives in `MasterDataTabs`, below
    `AuthProvider`, with the `Tab`s as direct children of `Tabs`.
- **Session 2026-09-21 (2): root-caused and fixed the platform-wide red `e2e` CI job as ticket
  LOGI-0013 (qa arm, inline).** Verification of run #14's log + the green #10 baseline proved the
  failure was environmental, not the LOGI-0005 backend arm.
  - **Root cause:** `global-setup.ts` deleted the live `e2e-logiflow.db`(+`-wal`/`-shm`) while the API
    held them open. Linux `unlink` succeeds → SQLite writes into deleted inodes → the next connection
    re-creates an empty DB → `no such table …` → `POST /auth/login` 500s for the rest of the run
    (#10 was green only as *flaky*: same error, recovered on retry). Windows locks the file, so local
    runs never reproduced it.
  - **Fix (4 files):** `tests/e2e/start-api.mjs` (new webServer wrapper: clean the throwaway DB, then
    start the API with an absolute `Data Source`), `playwright.config.ts` (absolute `E2E_DB_PATH`),
    `global-setup.ts` (no file deletion; API-only row reset, now incl. `drivers` for the qa arm),
    `.github/workflows/ci.yml` (on failure upload `Logs/` + DB + `test-results` — the API's own
    exception was never visible in CI).
  - **Gates:** local `npx playwright test` **30 passed / 0 flaky**; migrations applied with **0**
    `no such table` lines; config lists 30 tests; ci.yml parsed. **CI confirmed green: run #17
    (`75c039e`) — `build-and-test` ✅ + `e2e` ✅, remote summary `30 passed (34.9s)`, 0 flaky.**
  - Commits `f404e8c` → `afd16e4` → `b308efc` → `75c039e` (pushed; run #16).
- **Session 2026-09-21 (1): LOGI-0005 backend arm SEALED — handoff backend→frontend recorded.**

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
  **LOGI-0005 🟡 — architect ✅ (`a3a369d`) · backend ✅ (`c615744`, 42/42) · frontend ✅
  (`f3c8e72`, vitest 41/41) · qa ⬜**.

## Next action
1. **Dispatch the LOGI-0005 qa arm** (fresh window via `new_task`, or user-approved inline): plan
   `state/plans/LOGI-0005-qa.plan.md` → `tests/e2e/drivers.spec.ts` covering AC-1..AC-9 against the real
   API — licence 409 on POST+PUT, userId 400 then 409, PUT null/omitted clears the link, paged
   q/status list (id asc), 404s, and the full RBAC matrix incl. **Driver role 403 on reads**; reuse the
   LOGI-0013 harness (`start-api.mjs`, API-only row reset — `drivers` is already reset there). Gates:
   `npx playwright test` green locally, then CI run green.
2. After the qa seal: handoff qa→done, flip `specs/features/LOGI-0005-drivers-crud.md` status, update
   this file + `memory/progress.md`, then close the ticket.
3. Push each seal and watch CI (no `gh` CLI — verify via GitHub web or the public API).
4. Optional cleanups (not blocking): fix the pre-existing `validateDOMNesting` defect in
   `WarehousesPage.tsx` (~line 187, LOGI-0001 shape) as a small platform ticket, and remove the stale
   detached worktree `.kilo/worktrees/lime-spirit` (`git worktree remove`).

## Blockers / open questions
- **CI `e2e` job red platform-wide → RESOLVED (LOGI-0013, run #17 green).** Root cause was the harness,
  not the runner: `global-setup.ts` unlinked the live SQLite file (Linux allows it → SQLite wrote into
  deleted inodes → empty DB re-created → `no such table` → 500s). Fix: DB prepared *before* the API
  starts (`start-api.mjs`) + absolute `Data Source`; CI now uploads the API's Serilog log + DB +
  `test-results` when e2e fails, so future failures are self-diagnosing. Confirmed: run #17 `75c039e`
  = `build-and-test` ✅ + `e2e` ✅ (30 passed, 0 flaky). CI gates can be trusted again.
- None blocking the backend arm itself: journal LOGI-0005 #backend-arm records the 1:1 race
  accepted for v1; non-unique `IX_drivers_user_id` convention artifact; deferred items (role=Driver
  check on the link, delete-referenced 409 in LOGI-0009, status lifecycle).
- Frontend arm findings (deferred, not blocking): pre-existing `validateDOMNesting` warning in
  `WarehousesPage.tsx` (~line 187 — `TablePagination` inside `<Table>`; the drivers page had the same
  shape and was fixed inside this arm's manifest); stale detached worktree
  `.kilo/worktrees/lime-spirit` (2433dc8) still on disk. Both are listed as optional cleanups above.
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
