# Active Context — LogiFlow

> ⚡ Read this file first at every session start. Update it before ending any session.
> Authoritative position: `node tools/tracker/index.mjs current` + this file.

## Current work
- **LOGI-0003 COMPLETE — all three arms done (2026-09-19).** qa arm sealed this session:
  plan `state/plans/LOGI-0003-qa.plan.md` (4/4 ticked, status done). Root causes fixed: e2e row
  asserts now `findRow()`-based (pagination beyond page 1) + AC-6 rename re-searches by new name
  (stale old-name server-side filter). Gates: `npx playwright test` **21/21** (20.2s),
  tsc --noEmit green. Commits: `87d5d57` → `95ea2f6` → `ec796bb` → `ce485a8`.
  Platform: `.gitignore` += `*.db-shm`/`*.db-wal`; deleted tracked `logiflow.db-shm/-wal`.
- Backend arm done (`0b04a02`, dotnet 20/20) · frontend arm done (`2c254a7`, vitest 18/18 +
  build). Ticket-wide gates all green; AC-1..12 covered by ≥1 e2e test each.
- **Remaining uncommitted (docs/architect only):** `Docs/adr/007-auth-model-identity-jwt-rbac.md`,
  `contracts/v1-openapi.yaml`, `Docs/ProjectTechGuidence/04-database-schema.md`,
  `specs/features/LOGI-0003-auth-roles.md`, `specs/features/LOGI-0002-sla-business-rules.md`,
  `Docs/business-rules/` — commit via a docs arm or fold into LOGI-0002. ⚠ confirm
  `Docs/business-rules/` belongs to LOGI-0002 before committing; review ADR-007 content.
- Earlier: LOGI-0001 (Warehouse CRUD) DONE; CI run 35339953505 green.

## Next action
1. Plan + lock the docs arm (or LOGI-0002 plan folding the architect artifacts in):
   commit ADR-007, `contracts/v1-openapi.yaml`, `04-database-schema.md`, both feature specs,
   `Docs/business-rules/` after ownership/content review.
2. Then LOGI-0002 (SLA spec-only doc) per original plan order.

## Blockers / open questions
- None blocking. E2E playwright gate now verified locally (21/21, 2 workers, 20.2s).
- OpenAPI spectral lint still CI-only; business-rules content unreviewed.

## Working agreements (quick ref)
- Main thread never edits source — dispatch via `new_task`.
- No plan, no code: every arm needs `state/plans/<T>-<arm>.plan.md` locked first.
- Micro-log every edit batch + gate run (`tracker micro`) — resume depends on it.
- Before resuming any arm: `tracker resume-check` (mandatory). Never trust a stale session.
- End of every session: update this file + journal; `tracker handoff` if mid-ticket.
- Editor-written plan files land CRLF — `sed -i 's/\r$//'` before validate/lock;
  `git check-ignore` consults the index (tracked files always report unignored).
