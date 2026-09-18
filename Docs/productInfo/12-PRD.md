# Product Requirements Document (PRD) — LogiFlow

**Version:** 1.0 | **Date:** 2026-09-18 | **Status:** Draft for approval
**Derived from:** `11-BRD.md`

## 1. Product Overview

LogiFlow is a web-based logistics management and planning platform covering warehouse, fleet,
driver, and shipment coordination for a single logistics operator. It replaces spreadsheet/phone
based coordination with a system of record that gives dispatchers a fast workflow, drivers a
simple status-update surface, and managers a live operational dashboard.

## 2. Personas

| Persona | Goals | Pain today |
|---|---|---|
| **Dana, Dispatcher** | Create and assign shipments quickly; avoid double-booking vehicles/drivers | Spreadsheets, manual capacity math, no live status |
| **Raj, Driver** | See today's assigned route and shipments; update status with minimal taps | Phone calls to report status, no visibility into route details |
| **Meera, Ops Manager** | See SLA risk and fleet utilization at a glance | Finds out about breaches only when customer complains |
| **Alex, Admin** | Manage users, warehouses, vehicles, drivers | No central place to manage master data |

## 3. Modules & Features

### 3.1 Master Data Management
- **F1 — Warehouse management:** CRUD for warehouses (name, address, coordinates).
- **F2 — Vehicle management:** CRUD for vehicles (plate number, type, capacity, status).
- **F3 — Driver management:** CRUD for drivers (name, license number, phone, status), optional
  link to a login user account.
- **F4 — User & role management:** Admin manages users and assigns roles (Admin, Dispatcher,
  Driver, Viewer).

### 3.2 Shipment Management
- **F5 — Create shipment:** Dispatcher/Admin creates a shipment (origin warehouse, destination
  address, weight, priority). System generates reference code and computes SLA due date (BR-1).
- **F6 — Edit / cancel shipment:** Edit fields while `Pending`; cancel while `Pending` or
  `Assigned` (BR-7).
- **F7 — Shipment status lifecycle:** Enforced transitions per BR-7, each transition recorded in
  audit history with actor and timestamp.
- **F8 — Shipment list & search:** Filter by status, priority, warehouse, SLA-risk flag; paginated;
  sortable by SLA due date.

### 3.3 Route Planning
- **F9 — Create route:** Dispatcher creates a route, assigns a vehicle and driver, sets planned
  start/end window. System rejects overlapping assignments (BR-3, BR-4).
- **F10 — Assign shipments to route:** Dispatcher adds shipments to a route; system rejects if
  total weight exceeds vehicle capacity (BR-5); shipment status auto-transitions to `Assigned`.
- **F11 — Planning board:** Kanban-style board (columns = shipment status) and a list view,
  filterable, for the dispatcher's daily workflow.

### 3.4 Driver Experience
- **F12 — My routes (driver view):** Driver sees only routes/shipments assigned to them, on a
  responsive layout usable on a phone browser.
- **F13 — Status update (driver):** Driver transitions shipment status (`InTransit` → `Delivered`,
  or flags `Delayed` with a note) from their own assigned shipments only (BR-6).

### 3.5 Dashboard & Reporting
- **F14 — Operations dashboard:** Counts by status, SLA-at-risk list (BR-2), vehicle/driver
  utilization snapshot (available vs in-route/off-duty).
- **F15 — Audit trail view:** Admin/Ops Manager can view full status history for any shipment.

## 4. Feature Priority (MoSCoW)

| Priority | Features |
|---|---|
| Must have | F1–F10, F13, F14 |
| Should have | F11 (kanban view; list view is must-have), F12, F15 |
| Could have | Saved filters, CSV export of shipment list |
| Won't have (v1) | Route optimization, GPS tracking, billing, mobile native app |

## 5. User Flows (key ones)

### 5.1 Create & assign a shipment (Dana)
1. Dana opens Shipments → Create Shipment.
2. Fills origin warehouse, destination, weight, priority → submits.
3. System validates, creates shipment as `Pending`, shows in list with SLA countdown.
4. Dana opens/creates a Route, assigns vehicle + driver + time window.
5. Dana adds the shipment to the route → system checks capacity → shipment becomes `Assigned`.

### 5.2 Driver updates status (Raj)
1. Raj logs in, sees "My Routes" with today's assigned route and shipments.
2. Raj taps a shipment → transitions to `InTransit` when departing, `Delivered` on drop-off, or
   `Delayed` with a note if blocked.

### 5.3 Manager checks SLA risk (Meera)
1. Meera opens Dashboard.
2. Sees count of shipments at risk (BR-2 rule), clicks through to filtered list.
3. Can view audit trail on any shipment to see where time was lost.

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | List/dashboard endpoints respond <300ms p95 at 50k shipments/year volume |
| Availability | Single-node v1; documented recovery via DB backup/restore, target RTO 1 hour |
| Security | JWT auth, RBAC enforced server-side on every endpoint, passwords hashed (ASP.NET Identity defaults) |
| Accessibility | WCAG 2.1 AA basics: labeled forms, keyboard navigation, no color-only status indicators |
| Usability | Shipment creation completed in <2 minutes (BO-3) |
| Auditability | Every shipment status change immutable and timestamped (BR-7, F15) |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari; responsive down to 375px width |

## 7. Out of Scope (restated from BRD for product clarity)

Route optimization algorithms, GPS/real-time tracking, carrier integrations, billing/invoicing,
multi-tenancy, native mobile apps. Any of these entering scope requires a new PRD section and
BRD sign-off, not an ad hoc agent decision.

## 8. Acceptance Criteria Mapping

Each feature F1–F15 above is expanded into its own feature spec file under `/specs/features/`
using the template in `09-sample-feature-spec.md`, with Given/When/Then acceptance criteria
before any implementation agent starts work. `09-sample-feature-spec.md`'s worked example (LOGI-0007
Create shipment) corresponds to **F5** here.

## 9. Open Questions

- Should Express priority shipments be visually distinguished on the planning board (color/icon)
  beyond the priority column? — Default: yes, badge + color, confirm with Meera persona owner.
- Is driver login required for v1, or can dispatchers manage status on drivers' behalf initially?
  — Default: driver login is in scope (F12/F13); revisit if login rollout to drivers is delayed.
