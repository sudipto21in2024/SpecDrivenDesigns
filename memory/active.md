# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **LOGI-0003 (Auth & Roles) is IN PROGRESS — uncommitted in the working tree** (discovered
  2026-09-19 by `tracker resume-check` drift reconciliation, NOT visible in git history):
  - Backend: `AuthEndpoints.cs`, `Authorization/`, `Features/Auth/`, `ICurrentUser/ITokenIssuer/
    IUserCredentials` abstractions, `UnauthorizedException`, `AppUser`/`RefreshToken` domain,
    Identity migration `20260918121409_LOGI-0003_AddIdentityAndRefreshTokens`, `TestAuth.cs` +
    `AuthEndpointsTests.cs`, `ProblemDetailsWriter` middleware.
  - Frontend: `features/auth/`, `api/tokenStore.ts`, `test/renderApp.tsx`, schema.d.ts/client.ts touched.
  - E2E: `auth.spec.ts`, `pages/login.page.ts`, `tests/e2e/support/`.
- **No tracker plan/claim exists for this work** — it predates the platform. Reconcile before
  continuing: draft + validate + lock `state/plans/LOGI-0003-backend.plan.md` (already drafted,
  needs manifest reconciliation against the actual tree), then run `tracker claim`.
- Gate status unknown — run `dotnet test` + `npm test` + `npx playwright test` to establish
  whether the uncommitted state is green before any further edits.
- Earlier session note: LOGI-0001 (Warehouse CRUD) DONE; CI run 35339953505 green;
  `tests/e2e/warehouses.spec.ts` has in-flight edits (seedWarehouse signature change) — finish or revert.

## Next action
1. Establish gate truth for the uncommitted LOGI-0003 tree (build + tests).
2. Reconcile `state/plans/LOGI-0003-backend.plan.md` §2 with the actual touched files; lock.
3. Then LOGI-0002 (SLA spec-only doc) per original plan order.

## Blockers / open questions
- Is the uncommitted LOGI-0003 work complete enough to gate green? Unknown — verify first.

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task`.
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
