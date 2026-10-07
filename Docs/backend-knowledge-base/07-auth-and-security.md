# 07 — Auth & Security (Identity + JWT + RBAC)

How users authenticate, how tokens are issued/rotated/validated, and how roles gate operations.

## 1. Identity without cookies

```csharp
// Infrastructure/DependencyInjection.cs
services.AddIdentityCore<AppUser>(options =>
    {
        options.Password.RequiredLength = 10;    // length over composition (NIST-style)
        options.Password.RequireDigit = false;   // no symbol/case mixes — they mostly produce
        options.Password.RequireUppercase = false;  // predictable substitutions like P@ssw0rd
        options.Password.RequireLowercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.User.RequireUniqueEmail = true;  // email doubles as the login name
    })
    .AddRoles<IdentityRole<long>>()
    .AddEntityFrameworkStores<LogiFlowDbContext>();
```

- `AddIdentityCore` (not `AddIdentity`) — **no cookie/sign-in machinery**; authentication is
  bearer-token only. What we use is `UserManager<AppUser>`: PBKDF2 password hashing and
  normalized-email lookup, behind the `IUserCredentials` seam.
- Roles are stored as a `Role` column on `AppUser` and emitted as a JWT claim — there is no
  per-user role-table dance at request time.

## 2. Tokens (`Security/JwtTokenService.cs`, ADR-007)

**Access token (stateless):** HS256 JWT, lifetime **15 minutes** (`Jwt:AccessTokenMinutes`),
signed with `Jwt:SigningKey` (falls back to an obviously-non-secret dev key that must never sign
production tokens). Claims:

```text
sub = user.Id    jti = random    email    role (maps to ClaimTypes.Role)    name = fullName
```

Everything authorization needs is embedded, so authenticating a request costs **no DB round trip**.

**Refresh token (stateful):** 32 random bytes → base64url string (the raw value only ever exists
in the HTTP body), stored **SHA-256 hashed** (plain hash is correct: the input is 256 bits of
server entropy, and the hash must be deterministic to be the lookup key), lifetime **7 days**,
**single-use with rotation**. Stored in `refresh_tokens` with `ExpiresAt`/`RevokedAt`.

## 3. The three token flows (`Features/Auth/AuthCommands.cs`)

```text
POST /auth/login  (anonymous)
  LoginCommandHandler:
    user = credentials.FindByEmail(email)
    if (user is null || !CheckPassword(user, password))  → UnauthorizedException 401
       ← single failure mode for "no such user" and "wrong password" (anti-enumeration),
         and absent users skip hash verification so timing doesn't leak existence either
    TokenPairFactory.Issue: access JWT + new refresh value + hash stored → SaveChanges
    → 200 { accessToken, refreshToken, expiresIn, user }

POST /auth/refresh  (anonymous)
  RefreshCommandHandler:
    hash = HashRefreshToken(raw); stored = RefreshTokens.SingleOrDefault(hash)
    if (stored is null || !stored.IsActive(now)) → UnauthorizedException 401
       ← unknown/expired/already-rotated are indistinguishable to the caller
    stored.Revoke(now); TokenPairFactory.Issue(...)   ← rotation
    SaveChanges ONCE → revoke + replacement commit atomically, so a replayed token can never succeed
    → 200 new pair

POST /auth/logout  (anonymous, idempotent)
  LogoutCommandHandler: if stored is active → Revoke; already-revoked/unknown → no-op
  → 204   (never discloses whether the token existed; desired end state already holds)

GET /auth/me  (any authenticated role)
  GetCurrentUserQuery → identity from the token (id, email, fullName, role) → 200
```

This is exactly the flow the frontend's `AuthContext`/`client.ts` drives (doc 04 there): one
silent refresh on 401, then session expiry.

## 4. Authenticating a request

`Program.cs` configures `JwtBearer` with `ValidateIssuer/Audience/SigningKey/Lifetime` and
**`ClockSkew = TimeSpan.Zero`** (a 15-minute token must not get a free 5-minute extension).
Failures short-circuit — the `JwtBearerEvents` handlers write the contract's ProblemDetails:

- `OnChallenge` (401): `HandleResponse()` suppresses the framework's empty body, then
  `ProblemDetailsWriter.WriteAsync(...)` + `WWW-Authenticate: Bearer` (RFC 6750).
- `OnForbidden` (403): same envelope with "not permitted" detail.

## 5. Authorization: endpoint policy + handler rules

Two complementary layers (both re-checked server-side regardless of what the UI shows):

| Layer | Mechanism | Examples |
|---|---|---|
| **Operation role** (coarse) | `.RequireRoles(...)` on the endpoint = contract `x-roles` any-of | GET /warehouses → Admin/Dispatcher/Viewer; DELETE /warehouses → Admin only |
| **Payload rule** (fine) | handler throws `ForbiddenException`/`ConflictException`/domain exception | cancel shipment: Admin/Dispatcher only (BR-6); driver's own-route scoping |

`CurrentUser` (Api) projects `HttpContext.User` onto the Application's `ICurrentUser` seam —
handlers ask `currentUser.UserId` for audit columns (`changed_by_user_id`) without knowing what a
claim is.

## 6. The role matrix (contract `x-roles` — also mirrored in `permissions.ts`)

| Capability | Admin | Dispatcher | Driver | Viewer |
|---|---|---|---|---|
| read master data (warehouses/vehicles) | ✅ | ✅ | ✅ | ✅ |
| write master data / delete | ✅ / ✅ | ✅ / ❌ | ❌ / ❌ | ❌ / ❌ |
| read drivers | ✅ | ✅ | ❌ | ✅ |
| shipments: list/detail (v1) | ✅ | ✅ | ❌ | ✅ |
| shipments: create/edit/cancel | ✅ | ✅ | ❌ (cancel) | ❌ |
| status transition (non-cancel) | ✅ | ✅ | ✅ | ❌ |
| routes: read / write / assign | ✅ all | ✅ all | read only | read only |
| planning board & dashboard | ✅ | ✅ | ❌ | ✅ |

Enforcement points: endpoint `RequireRoles` (401 vs 403) + handler rules; asserted by
`*AuthzTests.cs` on both sides.

## 7. Security notes & known v1 trade-offs

- Tokens live in frontend `localStorage` (ADR-007 pragmatic v1: same-origin proxy, no third-party
  scripts, 15-min access + rotating single-use refresh bounds the damage). The seams
  (`tokenStore.ts` / `ITokenIssuer`) allow moving to httpOnly cookies later.
- Dev credentials are deliberately obvious and **Development/Test only**; production provisioning
  is out of scope for v1.
- The signing key comes from configuration (user-secrets/env/secret store) — never committed; the
  dev fallback is name-flagged and only usable when no key is configured.
- Every endpoint re-authorizes: hidden UI buttons are convenience, not security.

