# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **LOGI-0003 backend arm: DONE** (2026-09-19, commit `0b04a02`). The pre-platform uncommitted
  auth stack (Identity + JWT, refresh rotation, RBAC, ProblemDetails) was reconciled to a
  locked+done plan `state/plans/LOGI-0003-backend.plan.md` (manifest rewritten to match the
  actual tree; old draft's `RoleAuthMiddleware` approach was superseded in code by
  `Authorization/` + endpoint policies). Gates: `dotnet test` **20/20**, `npm test` **18/18**.
  `tracker resume-check` verdict: **clean**. Formal HANDOFF backend → frontend recorded;
  stray `e2e-logiflow.db-shm/-wal` removed before commit.
- **Remaining uncommitted (each needs its own plan, in dispatch order):**
  1. `LOGI-0003-qa` — `tests/e2e/auth.spec.ts`, `login.page.ts`, `support/`, `global-setup.ts`,
     `warehouses.page.ts`, `warehouses.spec.ts` (⚠ in-flight `seedWarehouse` signature change —
     finish or revert). Gates: `npx playwright test` (not yet run locally).
  2. Docs/architect artifacts per spec §9: ADR-007, `contracts/v1-openapi.yaml`,
     `04-database-schema.md`, `Docs/business-rules/`, `specs/features/LOGI-0003-auth-roles.md`,
     `LOGI-0002-sla-business-rules.md` — uncommitted; commit via a docs/architect arm or
     fold into LOGI-0002.
  3. LOGI-0003 frontend arm ✅ done (`2c254a7`, plan `LOGI-0003-frontend.plan.md` status done;
     gates vitest 18/18 + build green; handoff frontend→qa recorded 2026-09-19).
- ** Earlier session note: LOGI-0001 (Warehouse CRUD) DONE; CI run 35339953505 green.

## Next action
1. Plan + lock `state/plans/LOGI-0003-qa.plan.md` (depends on backend+frontend plans, both done)
   → first resolve the `seedWarehouse` signature drift in `warehouses.spec.ts`, then
   run `npx playwright test` to establish e2e gate truth → dispatch qa arm.
2. Commit docs/architect artifacts (ADR-007, openapi, schema doc, specs) — via docs arm or LOGI-0002.
3. Then LOGI-0002 (SLA spec-only doc) per original plan order.

## Blockers / open questions
- None blocking. E2E playwright gates unverified locally (CI-only so far);
  `Docs/business-rules/` content unreviewed — confirm it belongs to LOGI-0002 before committing.

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task`.
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
