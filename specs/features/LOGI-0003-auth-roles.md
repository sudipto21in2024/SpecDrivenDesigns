---
id: LOGI-0003
title: Authentication & role-based authorization
status: done
owner_agent: spec-agent
created: 2026-09-18
depends_on:
  - LOGI-0000
  - LOGI-0001
---

## 1. Summary
As an **Alex (Admin)**, I want users to sign in with an email and password and receive a
short-lived access token, so that every API call is authenticated and authorized by role
(Admin / Dispatcher / Driver / Viewer) instead of being open.

This ticket turns the RBAC that LOGI-0001's contract already *declares* (`x-roles`) into RBAC
that the server *enforces*.

## 2. Actors & roles
- **All four roles** authenticate: Admin, Dispatcher, Driver, Viewer (`04-database-schema.md` `users.role`).
- **Admin** additionally administers users (F4). In this ticket only *seeding* + role assignment
  storage land; the user-management UI/ticket is separate and out of scope here.
- Anonymous: only `/api/v1/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`.

## 3. Preconditions
- LOGI-0000 scaffold green; LOGI-0001 warehouse CRUD exists and is currently **unauthenticated**.
- `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 9.0.0 is already pinned in
  `Directory.Packages.props` (anticipated by the scaffold).
- Decision recorded as **ADR-007** (security-sensitive decision per `03-spec-driven-workflow.md`
  §Escalation).

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Login with valid credentials issues tokens**
```
Given a seeded user dana@logiflow.dev with role Dispatcher and a known password
When I POST /api/v1/auth/login with those credentials
Then I receive 200 with accessToken, refreshToken, expiresIn and the user's
   id, email, fullName and role
And the access token is a signed JWT whose role claim is "Dispatcher"
```

**AC-2 — Login with invalid credentials is rejected**
```
Given a registered email but a wrong password
When I POST /api/v1/auth/login
Then I receive 401 ProblemDetails
And the response does not reveal whether the email exists
And no token is issued
```

**AC-3 — Login input validation**
```
When I POST /api/v1/auth/login with a missing/empty email or password, or a malformed email
Then I receive 400 ProblemDetails with errors.email and/or errors.password populated
```

**AC-4 — Unauthenticated access to a protected endpoint is 401**
```
Given I have no Authorization header (or a malformed/expired token)
When I call GET /api/v1/warehouses
Then I receive 401 ProblemDetails
And the response carries a WWW-Authenticate: Bearer challenge
```

**AC-5 — Authenticated but wrong role is 403**
```
Given I am logged in as Viewer
When I POST /api/v1/warehouses (a role-restricted endpoint, x-roles: [Admin, Dispatcher])
Then I receive 403 ProblemDetails
And no warehouse row is created
```

**AC-6 — Role-appropriate access succeeds, matching the contract's x-roles**
```
Given I am logged in as Dispatcher
Then GET /warehouses, GET /warehouses/{id}, POST /warehouses, PUT /warehouses/{id} return 2xx
And DELETE /warehouses/{id} (x-roles: [Admin]) returns 403
Given I am logged in as Admin
Then DELETE /warehouses/{id} returns 204
Given I am logged in as Viewer
Then GET /warehouses and GET /warehouses/{id} return 2xx
```

**AC-7 — Refresh token exchange and rotation**
```
Given a valid refresh token from login
When I POST /api/v1/auth/refresh with it
Then I receive 200 with a new accessToken AND a new refreshToken
And the previously presented refresh token is no longer usable (rotation)
When I POST /api/v1/auth/refresh with an unknown, expired, or already-rotated token
Then I receive 401 ProblemDetails
```

**AC-8 — Current user identity**
```
Given a valid access token
When I GET /api/v1/auth/me
Then I receive 200 with id, email, fullName and role of the token's subject
And never a password hash, security stamp or any other credential material
```

**AC-9 — Logout revokes the refresh token**
```
Given a valid refresh token
When I POST /api/v1/auth/logout with it
Then I receive 204
And subsequent POST /api/v1/auth/refresh with that token returns 401
```

**AC-10 — Credentials are never exposed and passwords are hashed**
```
Given any auth response or error body
Then it contains no password, passwordHash, securityStamp or another user's refresh token
And stored passwords are PBKDF2 hashes produced by ASP.NET Core Identity defaults
   (plaintext is never persisted or logged)
```

**AC-11 — Health and OpenAPI contract stay consistent**
```
Given the app is running
When I GET /api/v1/health without a token
Then I receive 200 (probes, Playwright webServer and CI must not need credentials)
And contracts/v1-openapi.yaml declares security at the document root with
   security: [] only on /health and the auth endpoints
And every protected operation references 401 and 403 responses
```

**AC-12 — Frontend gates the UI by authentication and role**
```
Given I open the app without a stored token
Then I see the login screen and no warehouse data is requested
Given I sign in as Viewer
Then the warehouse list renders read-only (no Create/Edit/Delete affordances)
Given I sign in as Dispatcher
Then Create/Edit are available and Delete is not
Given my access token expires and a request returns 401
Then the client refreshes once and retries, or returns me to the login screen
Given I sign out
Then tokens are cleared and the login screen is shown
```

## 5. Out of scope (explicit)
- User & role **management UI** (F4) and Admin CRUD over users — storage + seeding only here.
- Driver resource-ownership scoping ("own routes only", HLD §7) — belongs to LOGI-0009/0010/0013
  where routes/shipments exist. This ticket enforces **role** checks only.
- Password reset / forgot-password / e-mail delivery; 2FA; external identity providers (OIDC, SSO).
- Refresh-token reuse-detection families and device/session listing.
- HTTPS enforcement, CORS lockdown and rate limiting — deployment concerns, tracked separately.
- Client-side routing library / multi-page navigation (decision recorded in ADR-007).

## 6. Data touched
- New table `users` (ASP.NET Core Identity, mapped to snake_case; replaces the placeholder row in
  `04-database-schema.md` with the real column set).
- New table `refresh_tokens` (id, user_id FK, token_hash UNIQUE, expires_at, created_at, revoked_at).
- `04-database-schema.md` updated to mirror both.
- Migration: `<Timestamp>_LOGI-0003_AddIdentityAndRefreshTokens` (additive).

## 7. Open questions
- **Token lifetimes:** access 15 minutes, refresh 7 days — chosen as safe v1 defaults; documented in
  ADR-007, configurable via `Jwt:*` settings.
- **Seeded credentials:** dev/Test only, non-production secrets, printed in `SeedData`. Production
  seeding is explicitly out of scope.
- No blocking questions.

## 8. Non-functional requirements
- Login endpoint <300ms p95 (one indexed lookup + one PBKDF2 verification).
- Access tokens are stateless (no DB hit to authenticate); refresh is stateful (single indexed lookup).
- JWT signing key comes from configuration (`Jwt:SigningKey`), never hard-coded in source; a
  development-only fallback is used when unset so the scaffold remains runnable.
- Auth failures are logged with the request id and never with credential material.

## 9. Downstream artifacts this spec produces (traceability)
- `contracts/v1-openapi.yaml` — `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`; root
  `security`; 401/403 responses on protected operations (Architect Agent).
- `Docs/adr/007-auth-model-identity-jwt-rbac.md` — security-sensitive decision record.
- Migration `<Timestamp>_LOGI-0003_AddIdentityAndRefreshTokens`; `Docs/ProjectTechGuidence/04-database-schema.md` mirror update.
- `src/backend/LogiFlow.Domain/Entities/AppUser.cs`, `Security/Roles.cs`.
- `src/backend/LogiFlow.Application/Features/Auth/*` (Login, Refresh, Logout, Me + validators).
- `src/backend/LogiFlow.Infrastructure/Security/*` (`JwtTokenService`, `RefreshTokenStore`), `Seed/SeedData.cs`.
- `src/backend/LogiFlow.Api/Endpoints/AuthEndpoints.cs`, `Authorization/Policies.cs`.
- `src/frontend/src/features/auth/*` (`AuthContext`, `LoginPage`, `AuthGate`), `api/tokenStore.ts`.
- `tests/e2e/auth.spec.ts` for AC-1..AC-12; `tests/e2e/pages/warehouses.page.ts` updated to authenticate.