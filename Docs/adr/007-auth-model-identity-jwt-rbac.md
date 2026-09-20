# ADR-007: Auth model — ASP.NET Core Identity + JWT bearer + role policies

- **Status:** Accepted
- **Deciders:** Architect (inline) — **security-sensitive decision, escalated for human approval per
  `03-spec-driven-workflow.md` §Escalation** (human checkpoint applies to LOGI-0003)
- **Date:** 2026-09-18
- **Tech story:** LOGI-0003 — Auth & roles (Identity + JWT + RBAC)

## Context
LOGI-0000/0001 shipped the API with **no authentication**: the OpenAPI contract declared `x-roles`
per operation but every operation also carried `security: []`, so nothing was enforced. Before any
shipment/route/driver work begins, we need authentication and authorization:

- **Authentication:** an email/password sign-in that issues a token the SPA can attach to requests.
- **Authorization:** the four roles from `04-database-schema.md` (`Admin, Dispatcher, Driver, Viewer`)
  enforced **server-side**, driven by the `x-roles` already documented in the contract.
- **Constraints:** HLD §5 already names "ASP.NET Core Identity + JWT bearer tokens, role claims"; the
  scaffold pinned `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 9.0.0 in anticipation. PRD §6
  requires JWT auth, server-side RBAC on every endpoint, and Identity-default password hashing. BR-6
  restricts shipment mutation to Admin/Dispatcher and makes Viewer read-only — role enforcement is a
  business rule, not just a security nicety.

Two further decisions had to be settled here because the pack is silent on them: **how the SPA stores
tokens**, and **whether v1 introduces a client-side router**.

## Decision
**1. Identity for user storage + password hashing.** `AppUser : IdentityUser<long>` with the role held
as a single scalar `Role` property, because the approved schema models `users.role` as one TEXT column
rather than a `AspNetUserRoles` join table. Passwords are hashed with **ASP.NET Core Identity's default
PBKDF2** (`IdentityV3`, 100k iterations) — no custom hashing, no reversible storage.

**2. Stateless JWT access tokens.** `Microsoft.AspNetCore.Authentication.JwtBearer`, HS256, with
claims `sub` (user id), `email`, `name` (`full_name`) and `role`. Lifetime **15 minutes**. Signing key
from configuration `Jwt:SigningKey`; if unset, a **development-only** fallback key is generated in
memory so the scaffold stays runnable — explicitly not a production configuration, and logged as a
warning at start-up.

**3. Stateful, rotating refresh tokens.** Opaque 256-bit random tokens, stored **hashed** (SHA-256)
in a new `refresh_tokens` table with `expires_at` and `revoked_at`. Lifetime **7 days**.
`POST /auth/refresh` **rotates**: the presented token is revoked and a new pair issued in one
transaction, so replaying a used token yields 401. Rotation was chosen over long-lived access tokens
because it keeps the revocation story real without a DB hit per request.

**4. Authorization by named policies derived from the contract.** One policy per role
(`LogiFlow.Admin`, `LogiFlow.Dispatcher`, `LogiFlow.Driver`, `LogiFlow.Viewer`), applied per endpoint
group/route so the code reads the same way as the contract's `x-roles`. Enforcement is **server-side
only**; the SPA's role checks are cosmetic affordance-hiding, never a control.

**5. Contract expresses security declaratively.** `security: [BearerAuth]` at the document root, with
`security: []` **only** on `/health`, `/auth/login`, `/auth/refresh` and `/auth/logout`. 401 and 403
are declared on every protected operation, and the `Unauthorized`/`Forbidden` response components that
LOGI-0000 left as forward declarations are now referenced. `/health` stays anonymous **deliberately**:
CI readiness checks, Playwright's `webServer` wait and container probes must not need credentials.

**6. Frontend token storage: `localStorage` with a short-lived access token, view-level gating.**
Tokens live in a single `tokenStore` module; a 401 triggers **one** refresh-and-retry before the
session is cleared. Auth state is provided by a small `AuthContext`. **No client-side router is
introduced in this ticket** — the app has exactly one protected screen (warehouses), so an `AuthGate`
component (login screen vs. children) is proportionate; a router becomes worthwhile when the planning
board and dashboard land (LOGI-0011/0012) and is recorded here as a follow-up decision.

## Consequences
- Positive: no custom crypto; Identity's PBKDF2 + hashed refresh tokens mean a DB dump does not yield
  usable credentials. Access tokens are stateless, so the protected-endpoint hot path has no DB hit.
  `x-roles` and code policies stay in lockstep because both are authored together per ticket.
- Positive: LOGI-0001's endpoints become protected by **configuration**, not by rewriting handlers.
- Neutral/negative: rotation means a client that loses the response of a refresh call must re-login;
  accepted for v1 (the SPA implements "refresh once, then clear the session").
- **Negative and deliberately deferred:** `localStorage` is readable by any successful XSS. Mitigations
  that must be revisited before any public deployment: CSP headers, HTTPS-only cookies with
  `HttpOnly`+`SameSite`, and rate limiting on `/auth/login`. Recorded as out-of-scope in the LOGI-0003
  spec rather than silently accepted.
- Negative: no resource-ownership scoping yet (a driver must only see their own routes per HLD §7).
  This ticket enforces **roles only**; ownership lands with routes/shipments (LOGI-0009/0010/0013).
- Impact: the integration-test factory and every existing warehouse test must authenticate, and the
  Playwright suite must sign in before touching domain screens.

## Alternatives considered
- **Cookie/session auth:** fits server-rendered apps better, but the SPA is a static client on a
  different origin in dev; bearer tokens keep CORS/CSRF surface smaller for v1.
- **Full Identity role tables (`AspNetRoles`, `AspNetUserRoles`):** richer, but the approved schema
  models a single scalar `users.role`; we honour the schema and avoid an unapproved join-table migration.
- **Long-lived opaque access tokens in a `sessions` table:** simplest revocation, but adds a DB lookup
  to every request and contradicts HLD §5's JWT choice.
- **Non-rotating refresh tokens:** less client complexity, but a stolen refresh token stays valid for
  7 days with no detection. Rejected.
- **httpOnly cookie for the refresh token:** stronger against XSS; rejected for v1 to keep a single
  token transport (bearer) and avoid cross-origin cookie/SameSite complexity in the dev proxy setup.

## References
- `Docs/productInfo/11-BRD.md` §6 (BR-6), §8 (zero unauthorized access)
- `Docs/productInfo/12-PRD.md` §6 (Security NFR), F4
- `Docs/productInfo/13-HLD.md` §5 (Auth decision), §7 (Security Design)
- `Docs/ProjectTechGuidence/04-database-schema.md` (`users` table), `05-api-contract-standards.md` §Auth
- `specs/features/LOGI-0003-auth-roles.md` (AC-1 … AC-12)