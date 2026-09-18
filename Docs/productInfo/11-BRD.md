# Business Requirements Document (BRD) — LogiFlow

**Version:** 1.0 | **Date:** 2026-09-18 | **Status:** Draft for approval

## 1. Purpose

This document defines the business need, objectives, scope, and success criteria for LogiFlow, a
logistics management and planning platform. It is the source from which the Product Requirements
Document (PRD) and Architecture (HLD) are derived. Agents must not implement features that trace
back to no BRD objective without a new approved spec.

## 2. Business Problem

Mid-size logistics/distribution operators currently coordinate shipments, vehicles, and drivers
using spreadsheets, phone calls, and disconnected tools. This causes:
- No single source of truth for shipment status — customer status inquiries require manual calls.
- SLA breaches go unnoticed until a customer complains; no proactive flagging.
- Vehicle and driver assignment is manual and error-prone (double-booking, capacity mismatches).
- No historical audit trail for compliance or dispute resolution (who changed what, when).
- Onboarding new dispatchers takes weeks because process knowledge lives in people's heads.

## 3. Business Objectives

| # | Objective | Measure of success |
|---|---|---|
| BO-1 | Centralize shipment lifecycle tracking | 100% of shipments tracked in-system, zero spreadsheet use after rollout |
| BO-2 | Reduce SLA breaches | Dashboard flags at-risk shipments ≥2 hours before SLA due; target 30% reduction in breaches within 3 months |
| BO-3 | Reduce dispatcher administrative time | Shipment creation + assignment takes <2 minutes per shipment (from ~8 minutes manual) |
| BO-4 | Provide auditability | Every status change attributable to a user and timestamp, retained indefinitely |
| BO-5 | Enable faster onboarding | New dispatcher productive within 1 day of training (vs 2 weeks today) |

## 4. Scope

### 4.1 In scope (v1)
- Warehouse, vehicle, and driver master data management
- Shipment creation, lifecycle tracking, and cancellation
- Manual route creation and assignment of shipments/vehicles/drivers to routes
- Planning board (list and kanban views) for dispatchers
- Role-based dashboard with SLA breach indicators and operational counts
- Role-based access control: Admin, Dispatcher, Driver, Viewer
- Full audit trail of shipment status transitions

### 4.2 Out of scope (v1) — candidates for future phases
- Automatic route optimization / AI-based planning
- Real-time GPS vehicle tracking
- Third-party carrier / marketplace integrations
- Customer-facing tracking portal
- Billing, invoicing, and payments
- Multi-tenant SaaS (v1 is single-organization, single-node deployment)
- Native mobile apps (driver experience is responsive web only)

## 5. Stakeholders

| Role | Interest |
|---|---|
| Operations Manager | Wants visibility into SLA performance and fleet utilization |
| Dispatcher | Primary daily user — needs speed and low friction to create/assign shipments |
| Driver | Needs simple mobile-friendly status updates, minimal typing |
| IT/Admin | Needs user/role management and system reliability |
| Executive sponsor | Wants measurable reduction in SLA breaches and admin overhead |

## 6. Business Rules (authoritative — Spec Agent references, does not redefine)

- BR-1: A shipment's SLA due date is computed as: `created_at + 48h` for Standard priority,
  `created_at + 12h` for Express priority.
- BR-2: A shipment is flagged "at risk" on any dashboard/list view when `now >= sla_due_at - 2h`
  and status is not yet Delivered or Cancelled.
- BR-3: A vehicle cannot be assigned to two routes with overlapping planned time windows.
- BR-4: A driver cannot be assigned to two routes with overlapping planned time windows.
- BR-5: A shipment can only be assigned to a route if the sum of shipment weights on that route
  does not exceed the assigned vehicle's `capacity_kg`.
- BR-6: Only Admin and Dispatcher roles may create, edit, or cancel shipments. Driver role may
  only transition status on shipments assigned to their own routes. Viewer role is read-only.
- BR-7: A shipment status can only move forward through
  `Pending → Assigned → InTransit → Delivered`, or into `Cancelled` from `Pending`/`Assigned`, or
  into `Delayed` from `InTransit` (and back to `InTransit` when resolved). No other transition is
  permitted; illegal transitions are rejected server-side.

## 7. Assumptions & Constraints

- Single organization, single deployment (no multi-tenancy) for v1.
- SQLite is acceptable for expected v1 data volume (up to ~50,000 shipments/year); migration path
  to PostgreSQL documented as an ADR for when this ceases to hold.
- Users have modern browsers (last 2 versions of Chrome/Edge/Firefox/Safari); no IE11 support.
- Development and initial operation is fully agent-driven per the spec-driven agent pack; human
  review remains the approval gate for specs and merges.

## 8. Success Criteria / Acceptance for the Business

- All BO-1 through BO-5 measures achieved within 3 months of go-live.
- Zero data loss incidents; zero unauthorized access incidents in first 90 days.
- User satisfaction (dispatcher survey) ≥4/5 on ease of use post-rollout.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| SQLite concurrency limits under write-heavy load | Medium | Load-test before go-live; documented migration path to PostgreSQL |
| Scope creep into out-of-scope items (route optimization, GPS) | High (schedule) | Scope guardrails enforced by Orchestrator Agent per spec-driven workflow |
| Business rules (BR-1..BR-7) change after implementation begins | Medium | Rules centralized in this BRD; changes require BRD revision + re-approval, not ad hoc code changes |
