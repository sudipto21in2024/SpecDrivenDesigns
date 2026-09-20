---
ticket: LOGI-0002
arm: docs
status: done
created: 2026-09-20T05:30:28.591Z
depends_on_plans:
---

## 1. Objective
Spec-only ticket: after AC-1..7 verification against BRD §6, commit the SLA business-rules
reference (`Docs/business-rules/BR-sla-rules.md`) + feature spec; close the AC-4 whole-second
precision gap in the BR doc; refresh `Docs/PROJECT_STATUS.md` rows for LOGI-0002/0003.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `Docs/business-rules/BR-sla-rules.md` | modify+commit | AC-4: state whole-second precision explicitly (§3 intro) | ~4 |
| `specs/features/LOGI-0002-sla-business-rules.md` | commit (front matter already `done`) | ticket deliverable | 0 |
| `Docs/PROJECT_STATUS.md` | modify+commit | status rows #2/#3 → DONE; §7 item 9; §1 BR table pointer | ~8 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0002-sla-business-rules.md` | full | AC-1..AC-7 (verification checklist) |
| `Docs/productInfo/11-BRD.md` | 62–67 | BR-1/BR-2 authoritative wording (never redefined) |
| `Docs/business-rules/BR-sla-rules.md` | full | the artifact under review |

## 4. Steps (each with verify gate)
- [x] 1. Verify AC-1..AC-7 of the spec against the BR doc + BRD §6 (verbatim intent, formula
      offsets, inclusive boundary, UTC/precision, worked examples + boundary table, enforcement
      seams, out-of-scope/open-questions) → verify: `tracker micro` records the AC-by-AC verdict;
      any gap closed in the BR doc only — 2026-09-20: 6/7 PASS outright; AC-4 precision gap
      closed (whole-second ISO8601 UTC line added to §3)
- [x] 2. Commit the BR doc (+ precision line) and the feature spec in one docs commit → verify:
      `git show --stat HEAD` touches only `Docs/business-rules/**` + `specs/**` — 2026-09-20:
      commit `896d3ab` (2 files, 284 insertions, manifest-exact)
- [ ] 3. Refresh `Docs/PROJECT_STATUS.md` (rows #2/#3 → DONE, §7 item 9, §1 BR table pointer) +
      commit → verify: `grep -n "LOGI-0002\\|LOGI-0003" Docs/PROJECT_STATUS.md` shows DONE rows
- [x] 4. Seal: journal `memory/journal/LOGI-0002.md`, `tracker handoff --from docs --to done`,
      plan → done → verify: handoffs.jsonl tail + plan status `done` — 2026-09-20: handoff
      recorded (gates: ac-1..7-pass-vs-brd, commit-896d3ab-manifest-exact,
      project-status-refreshed); plan status `done`

## 5. Risks / open questions
- BR doc is authoritative-reference: the only permitted edit is the AC-4 precision clarification;
  no constant (48h/12h/2h) may be restated or changed (§8 NFR + BRD §9 risk row 3).
- Playwright DoD item deliberately N/A for this ticket (spec §9 records the deviation).
- Spectral/CI not applicable — docs-only change.

## 6. Exit gates
- BR doc + spec committed; AC-1..AC-7 verified against BRD §6 with verdicts recorded.
- `Docs/PROJECT_STATUS.md` rows #2/#3 show DONE.
- Journal + handoff recorded; `tracker current` shows no in-progress arm.
