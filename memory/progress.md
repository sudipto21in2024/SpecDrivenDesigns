# Progress

Derived from ticket front matter in `specs/features/*.md` + `Docs/PROJECT_STATUS.md`.

| Ticket | Description | Status |
|---|---|---|
| LOGI-0000 | Scaffold | 🟢 DONE |
| LOGI-0001 | Warehouse CRUD | 🟢 DONE (E2E 7/7, CI green) — but `tests/e2e/*` has uncommitted in-flight edits |
| LOGI-0002 | SLA business-rules (spec-only) | ⬜ Not started |
| LOGI-0003 | Auth & roles (Identity + JWT + RBAC) | 🟡 IN PROGRESS — backend ✅ (`0b04a02`, dotnet 20/20) + frontend ✅ (`2c254a7`, vitest 18/18, build green); remaining: e2e arm (playwright unverified locally) + docs/architect artifacts |
| LOGI-0004..0012 | Vehicles, Drivers, Shipments, Routes, Board, Dashboard | ⬜ Backlog |

Remote CI: green (run 35339953505) as of 2026-09-18. Local tree: heavily modified, uncommitted.
