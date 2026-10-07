# 08 — Business Rules: where each one lives

The rules repo calls BR-1…BR-7 all have **exactly one home** and (usually) one enforcement seam.
Full texts: `Docs/business-rules/BR-*.md`; contract: `contracts/v1-openapi.yaml`.

## The map

| Rule | What it says | Home | Enforcement |
|---|---|---|---|
| **BR-1** SLA due date | `sla_due_at = created_at + 48h (Standard) / 12h (Express)`; omitted priority → Standard; never business-hours arithmetic | `Application/Features/Shipments/SlaPolicy.cs` | `SlaPolicy.DueAt()` called once in `CreateShipmentCommand` handler; unknown priority throws (fail-loud, rule 1.7) |
| **BR-2** at-risk flag | at risk ⇔ `slaDueAt <= now + 2h`, exempt `Delivered`/`Cancelled`, null promise never at risk; **read-time only, never stored** | `SlaPolicy.cs` | `SlaPolicy.AtRiskCutoff(...)` → a SQL-translatable bound for `slaRisk=true` filters + `IsAtRisk()` twin for unit tests; no `at_risk` column exists |
| **BR-5** route capacity | assigned weight ≤ vehicle `CapacityKg`, checked atomically at assign time | `Application/Features/Routes/RouteCapacityGuard` (invoked by `AssignShipmentToRouteHandler`) | read-sum inside `ExecuteInTransactionAsync(SERIALIZABLE)` → loser gets **409**, not a double commit |
| **BR-6** role/ownership | cancel is Admin/Dispatcher-only; Driver scoped to own routes (gradually landing) | endpoint `RequireRoles` + handler `ForbiddenException` (cancel), query scoping (Driver) | 403 ProblemDetails; frontend mirrors in `permissions.ts` |
| **BR-7** status lifecycle | the transition table (doc 05 §3); terminal states terminal | `Domain/ShipmentStatus.cs` (`LegalNextStates`) + `Shipment.TransitionTo` | domain exception → handler → **409 whose detail names the legal next state(s)**; every transition appends a `shipment_status_history` row |
| **BR-2.5 / precision** | whole-second truncation on every compared instant | `SlaPolicy.TruncateToSeconds` | `generatedAt`/cutoffs/`minutesToDue` all derive from one truncated `now` |

Secondary rules with equally singular homes: unique plate/license (unique indexes + `ConflictException`
409), driver↔user at-most-once link (handler dup-check → 409), shipment reference codes
(`SHP-` + max(id)+1 with bounded retry).

## Why the split between Domain and Application?

- **BR-7** is a pure state machine — no I/O — so it lives in the entity and any code path that
  changes status must call `TransitionTo`.
- **BR-1/BR-2** must be consumable as a **SQL bound** by the list/dashboard queries (otherwise
  paging and `totalCount` would need every row in memory), so `SlaPolicy` lives in Application and
  deliberately ships two shapes of the same rule: `AtRiskCutoff` (translatable) and `IsAtRisk`
  (in-memory twin). Tests assert the two agree.
- **BR-5** needs route + vehicle + a running sum of other shipments + a lock, i.e. multiple
  aggregates and a transaction — Application is the lowest layer that can see all of it.

## Parity: one rule, three mirrors (kept honest by tests)

```text
contracts/v1-openapi.yaml   x-roles + schemas + status codes
        │
        ├─► backend:   RequireRoles(...) per endpoint, DTO records, ProblemDetails
        ├─► frontend:  permissions.ts capabilities, schema.d.ts types, MSW handlers
        └─► tests:     *AuthzTests / DashboardContractTests / ShipmentListRouteFilterParityTests
                       assert the mirrors against the behavior, not against copies
```

The dashboard/list parity tests are the pattern to copy: the dashboard calls the **shared** filter
overload used by `GET /shipments`, and the test asserts parity rather than a hand-written
expectation — so the two surfaces cannot drift.

## Anti-patterns these homes exist to prevent

1. **Inlining an offset/window** — a second `TimeSpan.FromHours(48)` somewhere means BR-1 can be
   changed in one place and violated in another. The `SlaPolicy` doc-comment calls this out.
2. **Storing a derived flag** — an `at_risk` column would freeze a read-time judgment and violate
   BR-2.5; the column deliberately does not exist.
3. **Extending BR-7 "just for this call"** — `UnassignFromRoute` deliberately does *not* route
   through `TransitionTo` because Assigned→Pending is not a BR-7 edge; unassign is its own domain
   operation with its own intent and author (documented in the method comment).
4. **Recomputing server-owned numbers client-side** — dashboard counts are computed at one captured
   instant (`generatedAt`) server-side; the frontend renders them verbatim.
5. **Role checks scattered as string literals** — `Roles` constants + contract `x-roles` + tests.

## Where to look when a rule changes

| Change | Touch |
|---|---|
| SLA offset / window | `SlaPolicy.cs` + `Docs/business-rules/BR-sla-rules.md` + its tests (`SlaPolicyTests`) |
| new legal transition | `ShipmentStatusValues.LegalNextStates` + contract enum/description + frontend status option lists |
| capacity formula | `RouteCapacityGuard` + `RouteCapacityView` (board/dashboard read model) + BR-5 doc |
| role matrix | contract `x-roles` → endpoint `RequireRoles` → `permissions.ts` → `*AuthzTests` |
