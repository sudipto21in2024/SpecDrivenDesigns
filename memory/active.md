# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **Session 2026-09-20 (resume): LOGI-0004 COMPLETE — all four arms done (architect → backend →
  frontend → qa).**
  - Frontend arm sealed on resume: gates re-verified first (tsc clean, vitest **25/25** in 3
    suites) → commits `b4687f0` (feat: typed client + `features/vehicles` UI, 12 files
    manifest-exact) + `db0238d` (chore: plan done, handoff frontend→qa). The previous session had
    died mid-seal (steps 1-4 done, PLAN_DONE logged, nothing committed).
  - QA arm: recovered a draft plan + half-written files (api.ts corrupted by a mid-edit crash:
    duplicate `seedVehicle`, literal `\n` junk, `seedWarehouse` name lost → warehouses.spec.ts
    import broken). Locked the plan (validate → lock → claim), repaired api.ts, rebuilt the page
    object + spec, then gated: backend Release build 0/0 + `npx playwright test` → **30/30 green**
    (9 vehicles AC-1..AC-9 + 7 warehouses + 14 auth). Commits `f8823eb` (feat qa, manifest-exact)
    + `433570c` (chore: plan done, handoff qa→done — ticket complete).
  - MUI Select e2e lessons (journal qa-arm): Select is a `div[role=combobox]` — click + menu
    option, never `selectOption`; dialog selects have combined accessible names ("Type Vehicle
    type"); list filters render with NO accessible name (locate via
    `.MuiFormControl-root:has(#vehicle-<x>-label) .MuiSelect-select`); seeded rows need a re-goto
    or search (stale react-query list); >5 rows push seeds to page 2.
- Scoreboard: LOGI-0000 ✅ · LOGI-0001 ✅ · LOGI-0002 ✅ · LOGI-0003 ✅ (backend 20/20 + frontend
  18/18 + e2e 21/21) · **LOGI-0004 ✅ — architect ✅ (spec + contract, spectral 0 errors) +
  backend ✅ (dotnet 30/30) + frontend ✅ (vitest 25/25) + qa ✅ (playwright 30/30)**.

## Next action
1. Push `f1964d2..433570c` (9 commits: architect docs+chore, backend feat+chore, frontend
   feat+chore, qa feat+chore) and watch GitHub CI — local gates all green (spectral 0 errors,
   dotnet 30/30, vitest 25/25, playwright 30/30).
2. Next ticket from the backlog (LOGI-0005 Drivers?): architect arm first — spec + additive
   contract, human checkpoint, then backend/frontend/qa fan-out. RBAC matrix per ADR-007 from
   day one.

## Blockers / open questions
- None. Working tree clean; all LOGI-0004 artifacts committed (tracker: every arm done).
- Deferred items recorded in journal LOGI-0004: delete-referenced-by-route 409 waits for the
  LOGI-0009 routes FK; vehicle status lifecycle needs a BRD revision; MUI select a11y naming is
  worth a docs note/ADR if it bites again.

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task`.
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
- Editor-written plan files land CRLF — `sed -i 's/\r$//'` before validate/lock;
  `git check-ignore` consults the index (tracked files always report unignored).
