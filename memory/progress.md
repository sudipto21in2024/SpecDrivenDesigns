# Progress

Derived from ticket front matter in `specs/features/*.md` + `Docs/PROJECT_STATUS.md`.

| Ticket | Description | Status |
|---|---|---|
| LOGI-0000 | Scaffold | 🟢 DONE |
| LOGI-0001 | Warehouse CRUD | 🟢 DONE (E2E green, CI green) |
| LOGI-0002 | SLA business-rules (spec-only) | 🟢 DONE (BR-1/BR-2 reference `Docs/business-rules/BR-sla-rules.md` committed `896d3ab`; AC-1..7 verified vs BRD §6) |
| LOGI-0003 | Auth & roles (Identity + JWT + RBAC) | 🟢 DONE — backend ✅ (`0b04a02`, dotnet 20/20) + frontend ✅ (`2c254a7`, vitest 18/18) + qa ✅ (`ce485a8`, playwright 21/21) + docs ✅ (`d1ec277`, ADR-007 + auth contract + schema mirror) |
| LOGI-0004 | Vehicle CRUD | 🟢 DONE — architect ✅ (`f1964d2`, spec AC-1..AC-9 + `/vehicles` contract, spectral 0 errors) + backend ✅ (`c488279`, dotnet 30/30) + frontend ✅ (`b4687f0`, vitest 25/25) + qa ✅ (`f8823eb`, playwright 30/30) |
| LOGI-0005 | Driver CRUD + user link | 🟡 IN PROGRESS — architect ✅ (`a3a369d`, spec AC-1..AC-9 `spec_approved` + `/drivers` contract +149/−0, spectral 0 errors, human checkpoint approved) · backend ✅ (`c615744`, dotnet 42/42, migration `20260921041528_LOGI-0005_AddDrivers`) · frontend ⬜ qa ⬜ |
| LOGI-0006..0012 | Shipments, Routes, Board, Dashboard | ⬜ Backlog |

Remote CI: last verified green (run #10 `35522784324`, 2026-09-20, `fa324be` — the LOGI-0004 push:
spectral 0 errors, dotnet 30/30, vitest 25/25, playwright 30/30 all confirmed remotely).
2026-09-20: LOGI-0005 architect arm sealed (`a3a369d`, docs-only) — CI for it pending push.
2026-09-21: LOGI-0005 backend arm sealed (`c615744`, dotnet 42/42 local) — pushed. CI run #14:
**`build-and-test` job GREEN** (backend 42/42, frontend build+test, spectral 0 errors — verified
remotely), but the **`e2e` job FAILS**: login returns **500 mid-run** (22/30 tests passed before
onset; `support/api.ts:33` Expected:200 Received:500; no API stderr in the log; vite preview
proxies /api→localhost:5199, so the 500 may be proxy-vs-API). **NOT caused by the backend arm:**
runs #11–#13 (docs-only architect pushes, 2026-09-20) fail identically — environmental regression
on the runner since #10 (last green). **Deterministic, not flaky:** rerun of #14 (attempt 2) and
run #15 (docs-only memory push) both failed the same way — 5 failures in a row (#11–#15).
Also noted: actions run with Node 20→24 forced (deprecation warning) and setup-dotnet now installs
a .NET 10 runtime alongside the 9.0 SDK — both changed between #10 and #11. Next diagnostic step:
reproduce the e2e suite locally (`tests/e2e`) — green locally ⇒ runner-specific (pin image/actions);
red locally ⇒ debuggable with full logs.
