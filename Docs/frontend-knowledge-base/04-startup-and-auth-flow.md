# 04 — Startup & Auth Flow

What happens from page load to the authenticated shell, and how login, session restore, token
refresh and logout work.

## 1. Cold start sequence

```text
Browser loads index.html
  └─ <script type="module" src="/src/main.tsx">
       ├─ enableMocksIfRequested()                  (main.tsx)
       │    └─ if VITE_ENABLE_MOCKS=1 → import('./mocks/browser') → worker.start()
       └─ ReactDOM.createRoot(#root).render(
            <React.StrictMode><App /></React.StrictMode>)

<App/> mounts (App.tsx)
  └─ providers: QueryClientProvider → ThemeProvider → CssBaseline → AuthProvider → AuthGate

<AuthProvider> first render (AuthContext.tsx)
  ├─ status = tokenStore.get() === null ? 'anonymous' : 'loading'
  │           (localStorage has tokens? → we will TRY to restore)
  └─ effect #1: setSessionExpiredHandler(clearSession)   ← client.ts 401 callback

<AuthGate> (AuthGate.tsx)
  ├─ status 'loading'       → <CircularProgress> (data-testid="auth-loading")
  ├─ status 'authenticated' → <AppHeader/> + <MasterDataTabs/>   ← app chrome
  └─ status 'anonymous'     → <LoginPage/>                       ← no chrome at all

<AuthProvider> effect #2 (mount-only, only when status==='loading')
  └─ api.me()  ──► GET /api/v1/auth/me  (Bearer <stored access token>)
       ├─ ok   → setUser(identity); status='authenticated'   (role read from SERVER)
       └─ fail → clearSession(): tokenStore.clear(), status='anonymous'
                 (401 path first tries a silent refresh — see §4)
```

Two outcomes only: **login screen** or **app shell**. Feature components are never mounted while
anonymous, so no feature query ever fires without a token (this is the point of `AuthGate`; it is
explicitly *not* a security boundary — every request is re-authorized server-side).

## 2. Signing in

```text
LoginPage (LoginPage.tsx)
  user types email/password → RHF validates shape via Zod (loginSchema: email, 1..128 password)
  submit → AuthContext.login(email, password)
             ├─ api.login({email,password})   POST /api/v1/auth/login
             │    └─ 401 → ApiError → shown in <Alert> (deliberately NO "no such user" vs
             │              "wrong password" distinction — the server refuses to distinguish,
             │              so the UI must not invent one)
             ├─ tokenStore.set({accessToken, refreshToken})   ← BEFORE state flips, so the
             │                                                  first authenticated render
             │                                                  already attaches the Bearer
             ├─ setUser(tokens.user)
             └─ status = 'authenticated'
                    └─ AuthGate re-renders → mounts chrome; header shows role chip
```

Order matters: **tokens are stored before `setStatus`**, otherwise the first React Query requests
of the new session would go out without an `Authorization` header and 401.

## 3. Token storage (`src/api/tokenStore.ts`)

- Key `logiflow.auth.tokens` in `localStorage` holds `{accessToken, refreshToken}` (JSON).
- All access goes through the module (`get/set/clear`, `accessToken`, `refreshToken` getters) so
  the strategy could move to httpOnly cookies in one place (ADR-007 pragmatic v1 choice).
- `try/catch` everywhere: unavailable/corrupt localStorage degrades to in-memory (page-lifetime)
  or "signed out" — it must never break the shell.
- Access token is short-lived (15 min); refresh token is single-use with server-side rotation.

## 4. Silent refresh & session expiry (`src/api/client.ts`)

Every API call goes through `request()`:

```text
request(path, init, retryOn401=true)
  ├─ send(): fetch + Authorization: Bearer <accessToken>
  ├─ if 401 && retryOn401 && path not in AUTH_PATHS:
  │     ├─ ensureRefreshed()  ── single-flight refreshSession():
  │     │     POST /api/v1/auth/refresh {refreshToken}
  │     │       ├─ ok    → tokenStore.set(new pair) → return true
  │     │       └─ fail  → tokenStore.clear() → return false
  │     ├─ true  → request(path, init, retryOn401=false)   ← ONE retry, no recursion
  │     └─ false → onSessionExpired?.()  ← AuthContext's clearSession → login screen
  ├─ !ok  → throw new ApiError(status, ProblemDetails)
  ├─ 204  → undefined
  └─ else → response.json() as T
```

- **Single-flight**: parallel 401s share one `refreshInFlight` promise → exactly one rotation
  (rotation is single-use; two refreshes would invalidate the session).
- `AUTH_PATHS` (`login/refresh/logout`) are excluded — a 401 there is the endpoint's answer
  ("wrong credentials"), not a staleness signal.
- The session-expiry callback is registered by `AuthProvider` via
  `setSessionExpiredHandler(clearSession)` (cleaned up on unmount), so **no feature component knows
  about token lifetimes**.

## 5. Signing out

```text
Header menu → Sign out → AuthContext.logout()
  ├─ capture refreshToken, then clearSession() IMMEDIATELY   (UI drops to login at once —
  │                                                          never traps user in signed-in UI)
  └─ api.logout(refreshToken)  best-effort POST /api/v1/auth/logout (server-side revocation)
       └─ failure swallowed: token expires on its own; not actionable for the user
```

## 6. Roles & capability gating (`src/features/auth/permissions.ts`)

Four roles from the contract: `Admin | Dispatcher | Driver | Viewer`.

```tsx
import { can } from '../auth/permissions';
const canEdit = user != null && can(user.role, 'editWarehouses');
```

- `capabilities` maps *capability name* → predicate over role; `can(role, capability)` is the
  convenience wrapper. Each entry cites the contract `x-roles` it mirrors (e.g.
  `deleteWarehouses: role === 'Admin'`).
- Used to (a) show/hide tabs in `MasterDataTabs`, (b) show/hide buttons/actions on pages.
- **UX only** — the API enforces the same matrix and returns 403 regardless (HLD §7). Forging a
  request past the UI still gets 403; the MSW mocks model the same rules so tests exercise them.
- Notable rules: Driver is excluded from `/drivers`, the shipments list, Board and Dashboard
  (org-wide surfaces); cancel is a separate capability from generic status transition (BR-6).

## 7. Where each state lives

| State | Owner | Survives reload? |
|---|---|---|
| `status`, `user` | `AuthProvider` (`useState`) | rebuilt from token + `GET /auth/me` |
| tokens | `tokenStore` (localStorage) | ✅ |
| current tab | `MasterDataTabs` (`useState`) | ❌ (URL is written but not read on boot — Back/Forward only, see doc 07) |
| server data | React Query cache | ❌ (fresh fetch on mount) |
| page filters | page `useState` (shipments: seeded from URL once) | via URL for shipments drill-down only |

