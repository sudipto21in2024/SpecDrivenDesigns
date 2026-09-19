---
name: validate-plan
description: Run deterministic pre-flight validation on a plan file and decide fix-or-escalate. Use after drafting a plan and before locking it, and with --resume when resuming interrupted work. Trigger phrases: validate plan, check plan, pre-flight.
---

# Validate Plan

Run: `node tools/tracker/index.mjs validate-plan <file>` (add `--resume` when resuming).

## Interpreting results
| Error | Meaning | Action |
|---|---|---|
| `§3 required file missing` | stale path assumption | fix path (graphify to re-resolve) or justify removal |
| `§2 file parent dir missing` | typo or wrong location | correct path |
| `§2 boundary violation` | arm writing outside its scope | remove the file or escalate — routing to the right arm |
| `§2 manifest empty` | plan not actually drafted | complete §2 |
| warning `dependency plan not locked` | executing against unapproved upstream | wait, or escalate to orchestrator |
| warning `prior handoff exists` (resume) | plan may be stale vs upstream changes | diff required files vs intervening commits |

## Decision
- **errors** → fix the plan (back to `plan-arm`), re-validate. Max 2 fix rounds, then escalate to human with the error list.
- **warnings only** → decide each explicitly; note the decision in the plan's §5 Risks.
- **clean** → hand to orchestrator for `tracker plan lock` (lock requires clean validation).
