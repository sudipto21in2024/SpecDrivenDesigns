# Business Rules — SLA (BR-1, BR-2)

**Status:** Authoritative reference for implementation and tests
**Authority:** `Docs/productInfo/11-BRD.md` §6. **This document expands the BRD; it never overrides it.**
**Ticket:** LOGI-0002 · **Created:** 2026-09-18

> **Do not restate these rules with different numbers anywhere else in the repo.**
> Downstream specs (LOGI-0007, LOGI-0012) and code **reference** this document. Changing a
> constant here requires a BRD revision and re-approval (`11-BRD.md` §9 risk row 3) — not an
> in-passing edit inside a feature ticket.

---

## 1. BR-1 — SLA due date at shipment creation

**BRD wording (authority):** *"A shipment's SLA due date is computed as: `created_at + 48h` for
Standard priority, `created_at + 12h` for Express priority."*

### Formula

```
sla_due_at = created_at + offset(priority)

offset(Standard) = 48 hours
offset(Express)  = 12 hours
```

### Rules

| # | Rule | Rationale |
|---|---|---|
| 1.1 | The anchor is **`created_at`** — the instant the shipment record is created server-side. | The promise starts when the order is accepted, not when a vehicle is assigned. |
| 1.2 | `created_at` is **server-assigned**. A client-supplied creation time is never trusted. | Prevents an operator from extending the promise by back-dating. |
| 1.3 | `priority` defaults to **`Standard`** when not supplied (`04-database-schema.md`: `priority TEXT NOT NULL DEFAULT 'Standard'`). | Unknown priority must degrade to the longer, safer promise, never the shorter one. |
| 1.4 | Offsets are **plain duration additions in UTC** — no business-hours, weekend or holiday exclusion in v1. | BRD v1 does not model working calendars (see §5). |
| 1.5 | `sla_due_at` is **computed once at creation and persisted**. It is not recomputed on later reads. | Gives a stable promise; edits (LOGI-0008) do not reset the clock. |
| 1.6 | `sla_due_at` is stored as **ISO8601 UTC TEXT**, consistent with every other timestamp. | Single timestamp convention across the schema. |
| 1.7 | Only `Standard` and `Express` exist (`04-database-schema.md`). Any other value is rejected by validation — it is not silently coerced. | Unknown values must fail loudly rather than pick a promise arbitrarily. |

### Enforcement seam

- **LOGI-0007** (Create shipment) sets `sla_due_at` in the create-shipment command handler, at
  insert time. No other ticket writes this column.
- The offset table belongs in **one** domain/application component (a `SlaPolicy`-style unit) with
  unit tests — not inlined at multiple call sites.

---

## 2. BR-2 — "At risk" flag on read

**BRD wording (authority):** *"A shipment is flagged 'at risk' on any dashboard/list view when
`now >= sla_due_at - 2h` and status is not yet Delivered or Cancelled."*

### Formula

```
atRisk(shipment, now) =
        now >= (shipment.sla_due_at - 2 hours)
    AND shipment.status NOT IN { Delivered, Cancelled }
```

### Rules

| # | Rule | Rationale |
|---|---|---|
| 2.1 | The comparison is **inclusive**: `now` exactly equal to `sla_due_at - 2h` **is** at risk. | Matches BRD's `>=` exactly. |
| 2.2 | The warning window is **2 hours** before the due instant. It is a warning, not the deadline. | Operators get a 2-hour reaction window. |
| 2.3 | Exclusion is exactly **`{ Delivered, Cancelled }`** — no more, no fewer. | BRD names only these two. |
| 2.4 | Consequently **`Pending`, `Assigned`, `InTransit` and `Delayed` are all eligible**. A `Delayed` shipment is at risk and cannot escape by being delayed. | A delay does not discharge the promise. |
| 2.5 | The flag is **evaluated at read time** (`now` = server clock at request time) and is **never persisted**. | `04-database-schema.md` has no at-risk column; staleness is unacceptable for an alert. |
| 2.6 | A shipment **past** `sla_due_at` is still at risk (not a separate state). | There is no `Breached` status in the schema; overdue is a view concern. |
| 2.7 | `sla_due_at IS NULL` can arise only for pre-existing/legacy rows. Such rows are **not** at risk (no promise recorded) and must be excluded from the flag, not treated as overdue. | Avoids false alarms on data without a promise. |
| 2.8 | The **server is the authority**. A client-computed flag is a UX convenience only. | HLD §7 — validation/derivation is server-side. |

### Enforcement seam

- **Read-time projection** on the shipments query (LOGI-0007 list/search), consumed by
  **LOGI-0012** (dashboard SLA-risk list/block) and **LOGI-0011** (planning board).
- Computed in the Application layer over query results; **not** a stored column and not a SQL
  computed column in v1.

---

## 3. Worked examples

All times UTC. `now` = server clock at request time.

**Precision (AC-4):** every instant in these rules is a **whole-second** ISO8601 UTC timestamp
(`YYYY-MM-DDTHH:MM:SSZ`). Comparisons never involve fractional seconds — the server clock is
truncated to the whole second before being compared against the at-risk threshold, so
implementers and tests always compare identical second-granularity instants (no sub-second
ambiguity).

### Example A — Standard priority

| Field | Value |
|---|---|
| `priority` | `Standard` |
| `created_at` | `2026-09-18T08:00:00Z` |
| `sla_due_at` | **`2026-09-20T08:00:00Z`** (`+48h`) |
| at-risk threshold | **`2026-09-20T06:00:00Z`** (`sla_due_at − 2h`) |

### Example B — Express priority

| Field | Value |
|---|---|
| `priority` | `Express` |
| `created_at` | `2026-09-18T08:00:00Z` |
| `sla_due_at` | **`2026-09-18T20:00:00Z`** (`+12h`) |
| at-risk threshold | **`2026-09-18T18:00:00Z`** (`sla_due_at − 2h`) |

### Example C — Month boundary (Express, crossing 31 → 01)

| Field | Value |
|---|---|
| `priority` | `Express` |
| `created_at` | `2026-10-31T22:30:00Z` |
| `sla_due_at` | **`2026-11-01T10:30:00Z`** |

*Offsets are duration arithmetic on the UTC instant; they are unaffected by month lengths, leap
years, or daylight-saving changes in local zones.*

---

## 4. Boundary table (BR-2)

Based on Example A: `sla_due_at = 2026-09-20T08:00:00Z`, threshold `2026-09-20T06:00:00Z`.

| `now` | `status` | At risk? | Why |
|---|---|---|---|
| `2026-09-20T05:59:59Z` | `InTransit` | **No** | Before the threshold. |
| `2026-09-20T06:00:00Z` | `InTransit` | **Yes** | Inclusive boundary — `now == sla_due_at − 2h` (rule 2.1). |
| `2026-09-20T06:00:01Z` | `Pending` | **Yes** | Inside the warning window. |
| `2026-09-20T07:30:00Z` | `Delayed` | **Yes** | Delayed does not discharge the promise (rule 2.4). |
| `2026-09-20T08:00:00Z` | `Assigned` | **Yes** | Exactly due — still not Delivered/Cancelled (rules 2.3, 2.6). |
| `2026-09-20T09:15:00Z` | `InTransit` | **Yes** | Overdue is still at risk; there is no `Breached` state (rule 2.6). |
| `2026-09-20T07:00:00Z` | `Delivered` | **No** | Excluded status (rule 2.3). |
| `2026-09-20T07:00:00Z` | `Cancelled` | **No** | Excluded status (rule 2.3). |
| `2026-09-20T07:00:00Z` | `Delivered` | **No** | Delivered *before* the threshold is a normal, healthy completion. |
| any | any | **No** | When `sla_due_at = NULL` — no promise recorded (rule 2.7). |

---

## 5. Explicitly out of scope (v1)

- Escalation, notification, e-mail or push alerting on breach (not in PRD v1).
- Business-hours / working-calendar offsets; weekend and holiday exclusion (rule 1.4).
- Per-customer, per-lane or per-contract SLA overrides.
- Automatic re-planning or expediting of at-risk shipments.
- A persisted `breached` or `at_risk` column, and any SLA history/audit table.
- Reporting on SLA performance over time (BO-1 measurement is a future reporting concern).

## 6. Open questions (with safe defaults already applied)

| Question | Safe default applied | Where recorded |
|---|---|---|
| Should weekends/holidays extend the promise? | No — wall-clock duration in UTC (rule 1.4). | §5, LOGI-0002 §7 |
| Does `Delayed` exempt a shipment from "at risk"? | No — only Delivered/Cancelled exempt (rule 2.4). | §4 boundary table |
| Does editing a shipment reset `sla_due_at`? | No — computed once at creation (rule 1.5). | LOGI-0008 will inherit this |
| Is `at_risk` stored for dashboard speed? | No — read-time projection (rule 2.5). Revisit with an ADR if dashboard p95 exceeds 300ms. | PRD §6 NFR |
