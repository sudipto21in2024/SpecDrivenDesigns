---
ticket: LOGI-0003
arm: qa
status: locked
created: 2026-09-19T18:26:46.167Z
depends_on_plans: LOGI-0003-backend,LOGI-0003-frontend
---

## 1. Objective
Establish the Playwright e2e gate for LOGI-0003: reconcile the pre-existing uncommitted QA tree
(`seedWarehouse` signature drift is already aligned in-tree), fix the AC-12 pagination failures
from the prior failed run, gitignore stray SQLite sidecar files, and get `npx playwright test`
green locally.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/auth.spec.ts` | modify | AC-12: use findRow/search for seeded rows (pagination) | ~6 |
| `tests/e2e/warehouses.spec.ts` | modify | reconcile `seedWarehouse` signature (already in-tree, verify) | ~4 |
| `tests/e2e/global-setup.ts` | modify | reconcile against support/api helpers (already in-tree, verify) | ~0 |
| `tests/e2e/pages/warehouses.page.ts` | modify | reconcile auth-aware goto/signOut (already in-tree, verify) | ~0 |
| `.gitignore` | modify | add `*.db-shm`/`*.db-wal`/`*.db` sidecars (platform note from backend arm) | ~3 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0003-auth-roles.md` | full | ACs (source of truth) |
| `tests/e2e/support/api.ts` | full | signIn/seedWarehouse/authHeaders contract |
| `tests/e2e/pages/login.page.ts` | full | page-object contract |
| `tests/e2e/playwright.config.ts` | full | webServer/global-setup wiring |
| `memory/journal/LOGI-0003.md` | full | upstream backend/frontend findings |

## 4. Steps (each with verify gate)
- [x] 1. Verify/finish `seedWarehouse` signature reconciliation across specs + page objects → verify: `npx tsc --noEmit` (e2e) green — 2026-09-19 (tsc 5.9.3 exit 0)
- [x] 2. Fix AC-12 auth.spec pagination-visible assertions (use `findRow`) → verify: `npx tsc --noEmit` green — 2026-09-19 (all 3 AC-12 tests now search-then-assert)
- [ ] 3. Add `.gitignore` entries for SQLite sidecars; remove stale `test-results/` traces → verify: `git status` clean of runtime artifacts
- [ ] 4. Run full e2e gate → verify: `npx playwright test` green (all specs)

## 5. Risks / open questions
- Prior local run failed 3/16 (AC-12 Admin controls, AC-6, AC-7) because both spec files ran
  concurrently against one shared SQLite DB and rows beyond page 1 (pageSize 5) are only reachable
  via server-side search. `findRow()` (added in-tree) resolves warehouses.spec; auth.spec AC-12
  still asserts `row(name).toBeVisible()` directly. `fullyParallel: false` already serializes
  workers; both spec files share one worker by default, so the interleave came from retry/reporter
  timing — the pagination fix makes order irrelevant.
- Playwright needs a Release backend build (`--no-build`) + frontend build in webServer; both exist.
- Playwright browsers must be installed locally (`npx playwright install`) if missing.

## 6. Exit gates
- `npx playwright test` green (all specs, from `tests/e2e`)
- `git status`: no stray runtime artifacts (`*.db-shm`, `*.db-wal`, `test-results/`) staged
- All AC-1..12 from spec §4 mapped to at least one passing e2e test (testing-strategy coverage rule)
