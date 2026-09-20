# Database Schema (SQLite, v1)

Owned by the **Database Agent**. Any change here must come from an approved migration plan
written by the Architect Agent. This file is the human-readable mirror of the EF Core model —
keep it in sync on every migration.

## Entity overview

```
Warehouse 1---* Shipment (origin/destination)
Vehicle   1---* Route
Driver    1---* Route
Route     1---* Shipment  (a route carries many shipments)
User      1---1 Driver (optional link, for driver-role logins)
```

## Tables

### warehouses
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | |
| address | TEXT NOT NULL | |
| latitude | REAL | |
| longitude | REAL | |
| created_at | TEXT (ISO8601 UTC) | |

### vehicles
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| plate_number | TEXT NOT NULL UNIQUE | |
| type | TEXT NOT NULL | enum: Van, Truck, Trailer |
| capacity_kg | REAL NOT NULL | |
| status | TEXT NOT NULL | enum: Available, InRoute, Maintenance |
| created_at | TEXT | |

### drivers
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER FK -> users.id NULL | |
| full_name | TEXT NOT NULL | |
| license_number | TEXT NOT NULL UNIQUE | |
| phone | TEXT | |
| status | TEXT NOT NULL | enum: Active, OffDuty, Suspended |

### shipments
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| reference_code | TEXT NOT NULL UNIQUE | e.g. SHP-000123, generated server-side |
| origin_warehouse_id | INTEGER FK -> warehouses.id | |
| destination_address | TEXT NOT NULL | |
| destination_lat | REAL | |
| destination_lng | REAL | |
| weight_kg | REAL NOT NULL | |
| status | TEXT NOT NULL | enum: Pending, Assigned, InTransit, Delivered, Delayed, Cancelled |
| priority | TEXT NOT NULL DEFAULT 'Standard' | enum: Standard, Express |
| sla_due_at | TEXT | ISO8601 UTC, used for SLA breach flag |
| route_id | INTEGER FK -> routes.id NULL | |
| created_at | TEXT | |
| updated_at | TEXT | |

### routes
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| vehicle_id | INTEGER FK -> vehicles.id | |
| driver_id | INTEGER FK -> drivers.id | |
| status | TEXT NOT NULL | enum: Planned, InProgress, Completed, Cancelled |
| planned_start | TEXT | |
| planned_end | TEXT | |
| actual_start | TEXT NULL | |
| actual_end | TEXT NULL | |

### users
ASP.NET Core Identity table, extended. `IdentityUser<long>` with an added scalar `role`; the schema
deliberately uses a single role column instead of the `AspNetUserRoles` join table (ADR-007).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | `long`, Identity-generated |
| email | TEXT NOT NULL UNIQUE | `IdentityUser.Email`; normalised copy `normalized_email` is UNIQUE |
| normalized_email | TEXT NOT NULL UNIQUE | Identity requirement for case-insensitive lookup |
| password_hash | TEXT NOT NULL | Identity default PBKDF2 (`IdentityV3`, 100k iterations) — never plaintext |
| security_stamp | TEXT | Identity requirement; rotated on credential change |
| full_name | TEXT NOT NULL | Display name (Identity `DisplayName` is unused in favour of this) |
| role | TEXT NOT NULL | enum: Admin, Dispatcher, Driver, Viewer |
| concurrency_stamp | TEXT | Identity requirement |
| email_confirmed | INTEGER NOT NULL | Identity requirement; seeded users are confirmed |
| lockout_enabled | INTEGER NOT NULL | Identity requirement |
| access_failed_count | INTEGER NOT NULL | Identity requirement (lockout support) |
| lockout_end | TEXT NULL | Identity requirement |

### refresh_tokens
Opaque rotating refresh tokens (ADR-007). Tokens are stored **hashed**, never in clear text.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER FK -> users.id | Cascade delete |
| token_hash | TEXT NOT NULL UNIQUE | SHA-256 of the opaque token; the raw token is only ever returned to the client |
| expires_at | TEXT NOT NULL | ISO8601 UTC; 7 days from issue |
| created_at | TEXT NOT NULL | ISO8601 UTC |
| revoked_at | TEXT NULL | Set on rotation, logout and reuse attempts; NULL = active |

### shipment_status_history (audit trail)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| shipment_id | INTEGER FK -> shipments.id | |
| from_status | TEXT | |
| to_status | TEXT NOT NULL | |
| changed_by_user_id | INTEGER FK -> users.id | |
| changed_at | TEXT NOT NULL | |
| note | TEXT NULL | |

## Indexing rules (Database Agent must apply)

- Unique index on `shipments.reference_code`, `vehicles.plate_number`, `drivers.license_number`.
- Unique index on `users.normalized_email` and on `refresh_tokens.token_hash` (refresh lookups are by hash).
- Index on `refresh_tokens.user_id` (revoke-all-for-user) and on `shipments.status` and `shipments.sla_due_at` (dashboard queries filter/sort on these).
- Index on `routes.status`.
- Foreign keys enforced (`PRAGMA foreign_keys = ON` in SQLite connection string).

## Migration conventions

- One EF Core migration per ticket, named `<Timestamp>_<TicketId>_<ShortDescription>`.
- Migrations are additive by default. Destructive changes (dropping/renaming columns) require an
  ADR and a human-approved escalation per `03-spec-driven-workflow.md`.
- Seed data lives separately from migrations (`SeedData.cs`), only runs in Dev/Test.
