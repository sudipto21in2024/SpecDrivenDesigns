---
id: LOGI-0002
title: SLA business-rules reference (spec-only)
status: done
owner_agent: spec-agent
created: 2026-09-18
depends_on:
  - LOGI-0000
---

## 1. Summary
As the **delivery swarm**, we need one authoritative, human-readable reference for the SLA rules
(BR-1, BR-2) so that every downstream ticket (LOGI-0007 shipment creation, LOGI-0012 dashboard)
**references** the rules instead of restating or inventing them.

Per `03-spec-driven-workflow.md` §Scope guardrails and `11-BRD.md` §6, business rules are
authoritative in the BRD. This ticket does **not** redefine them — it expands them into precise,
unambiguous, testable language (boundary cases, timezone handling, evaluation order) and records
exactly which ticket and code seam enforces each one.

## 2. Actors & roles
- No runtime actor. Consumer agents: Spec, Backend (LOGI-0007), Frontend + QA (LOGI-0007/LOGI-0012).
- Human reviewer: Ops Manager persona interpretation is validated by the boundary-case table.

## 3. Preconditions
- `11-BRD.md` §6 (BR-1..BR-7) and §7 available as the authority.
- `04-database-schema.md` defines the persisted fields: `shipments.sla_due_at`, `shipments.priority`.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Single source of truth exists**
```
Given the business rules BR-1 and BR-2 are defined in 11-BRD.md §6
When I open Docs/business-rules/BR-sla-rules.md
Then it states BR-1 and BR-2 verbatim in intent, marks the BRD as the authority,
And it explicitly forbids downstream tickets from restating the rule with different numbers
```

**AC-2 — BR-1 is expressed as an unambiguous formula**
```
Given BR-1 defines the SLA due date from created_at and priority
When I read the reference
Then the Standard offset is exactly 48 hours and the Express offset is exactly 12 hours
And the formula is written as sla_due_at = created_at + offset(priority)
And the offset is anchored to created_at (creation instant), not to route assignment or pickup
```

**AC-3 — BR-2 at-risk boundary is inclusive and fully specified**
```
Given BR-2 flags a shipment at risk when now >= sla_due_at - 2h
When I read the reference
Then the threshold is stated as inclusive (the exact instant now == sla_due_at - 2h IS at risk)
And the excluded statuses are exactly {Delivered, Cancelled}
And the evaluation is defined as instantaneous (evaluated at read time, not stored/cached)
```

**AC-4 — Timezone and precision rules are fixed**
```
Given timestamps cross services and a browser
When I read the reference
Then all SLA arithmetic is defined in UTC, stored as ISO8601 UTC TEXT, and compared on UTC instants
And the documented precision is whole seconds (no sub-second comparison ambiguity)
And 'now' is defined as the server clock at request time (server is the authority)
```

**AC-5 — Worked examples and boundary table remove ambiguity**
```
Given a reader needs to implement or test the rule
When I read the reference
Then it contains at least one fully worked Standard example and one Express example
And a boundary table covering: before threshold, exactly at threshold, past due,
   delivered-before-threshold and cancelled-before-threshold
```

**AC-6 — Enforcement seams are named (traceability)**
```
Given rules must be enforced in exactly one place per concern
When I read the reference
Then BR-1 names the enforcement seam as shipment creation (LOGI-0007) setting sla_due_at at insert
And BR-2 names the enforcement seam as a read-time projection on shipments (LOGI-0007 list, LOGI-0012 dashboard)
And it notes BR-2 is never persisted as a column
```

**AC-7 — Out-of-scope and open questions are explicit**
```
Given agents must not expand scope
When I read the reference
Then it lists what is explicitly excluded (escalation/notification, business-hours calendars,
   per-customer SLA overrides, weekend/holiday exclusion, automatic re-planning)
And any open question is recorded with a safe default rather than left blank
```

## 5. Out of scope (explicit)
- Any code change. No endpoint, no entity, no migration, no UI, no test suite is produced here.
- SLA breach escalation, alerting or notification behaviour (not in PRD v1).
- Business-hours/working-calendar adjustments to the offsets (not in BRD v1).
- Per-customer or per-lane SLA overrides (not in BRD v1).
- Persisting the at-risk flag as a column (`04-database-schema.md` has no such column).

## 6. Data touched
- None. Reads `04-database-schema.md` and `11-BRD.md` only.
- Documents (does not change) the fields `shipments.sla_due_at`, `shipments.priority`, `shipments.status`.

## 7. Open questions
- **Holidays/weekends:** not modelled in v1 — offsets are wall-clock hours, deliberately.
  Default assumed and documented: offsets are plain duration additions in UTC.
- **At-risk for `Assigned` vs `Pending`:** BR-2 excludes only Delivered/Cancelled, so `Pending`,
  `Assigned`, `InTransit` and `Delayed` are all eligible. Documented as-is (no default invented).
- No blocking questions.

## 8. Non-functional requirements
- The reference is a single file under `Docs/business-rules/` and must be updated by ADR/BRD revision
  only — not by an implementation ticket changing a number in passing.
- Every numeric constant in the document appears at most in its canonical form so `grep`-based
  checks (48h/12h/2h) cannot diverge.

## 9. Definition-of-Done deviation (recorded deliberately)
`03-spec-driven-workflow.md` §Definition of done item 1 requires a passing Playwright test per AC.
This ticket has **no runtime behaviour to drive through a browser**, so a Playwright test would be
theatre, not verification. DoD item 1 is therefore **N/A** and its place is taken by
review-against-BRD plus the enforcement-seam traceability in AC-6. DoD items 2–6 (unit tests, no
undocumented endpoints, review, CI, docs) are satisfied trivially or by the CI run on this commit.
The executable form of these rules lands in **LOGI-0007** as a domain policy plus unit tests, and
is E2E-verified there.
