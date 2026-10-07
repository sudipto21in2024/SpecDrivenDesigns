# 04 — Test Design Patterns

The idioms that make 167 tests retry-safe, deterministic, and cheap to extend.

## 1. The three layers of test support (and what each may do)

```text
Spec (*.spec.ts)              Support (support/*.ts)              Application code
─────                         ──────────                        ───────
assert on DOM + API response  seed rows via fixtures        business validation, state machines
arrange via API endpoints     page objects for UI           domain rules, transaction guards
per-test tokens in beforeEach run through real endpoints  DB writes with WAL+busy timeout
```

- **Specs stay thin**: they call support helpers, assert, and move on. They must never:
  - duplicate a helper's HTTP call (a new endpoint = one new helper),
  - construct tokens in code (use `signIn`),
  - reach into SQLite directly except `support/shipments.ts` + `support/routes.ts` (documented
    necessity: zero rows can be inserted with `sla_due_at = NULL` or a pinned epoch window).
- **Helpers are the contract of the API surface**: if a helper does not exist, add it there
  (doc 09 cheat sheet) — this is the single place spec authors negotiate the API shape.

## 2. Two types of seed

| Layer | Mechanism | When | Why |
|---|---|---|---|
| Test via real API | `seedWarehouse(request, token, name)` etc. | data the app must create (FKs, codes, statuses) | validates the endpoint and its unique-key rules |
| Fixture direct-to-SQLite | `seedShipmentAt(...)` / `seedRoute` | rows whose server-owned values can't be set via endpoints (`sla_due_at = NULL`, planned windows) | the contract must be exercised with values endpoints cannot produce |

Both write to the **same throwaway SQLite file** the API reads, so a UI/backend test always
sees exactly the rows the helper intended. The fixture path documents `LOGI-0007` history:
"removed the 'no create endpoint' reason, but a fixture is the only way to pin an instant".

## 3. Uniqueness and retry safety

Any name, plate, license, reference, or window that the API enforces uniqueness on must be
unique per **run**, not per test:

```ts
// support/routes.ts (pattern repeated in shipments.ts / drivers.spec.ts etc.)
const runId = `e2e${Date.now().toString(36)}`;   // per run: survives a CI retry re-executing the file
let seq = 0;
export function uniqueRef(tag: string): string { return `${tag}-${runId}-${seq++}`.slice(0, 20).toUpperCase(); }
export function routeName(tag: string): string { return `RT ${runId}-${tag}-${seq++}`; }
```

- `retries: 1` in CI re-runs the **whole file**; with `runId` + `seq`, the retry sees the same
  names it created, so the unique-index collision never happens again for that file's own rows.
- Shared counters are fine because `fullyParallel: false` + one worker means each spec's helpers
  run serially within one file, and files are isolated by their own `runTag`-scoped rows.
- Shared counters are safe because files are isolated by their own `runTag`-scoped rows; the
  shared `seq` is per-file, per-run. Never share a `seq` across files that write the same
  unique-key domain.

## 4. Pinning instants (when the wall clock cannot be the assertion)

Rules that depend on absolute time are seeded with **pinned values**, never `Date.now()`:

```ts
// support/shipments.ts — EF Core's SQLite DateTime layout (text, 7 fractional digits)
function efTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.`
    + `${pad(at.getUTCMilliseconds())}0000`;
}
```

- AC-8 needs `sla_due_at = NULL` rows (only fixtures can do that).
- AC-9 needs rows on both sides of the BR-2 at-risk window (2h) without racing the clock: create
  the origin warehouse and shipment, compute a pinned UTC timestamp, insert with that
  `sla_due_at`.
- `efTimestamp` exists because EF Core's SQLite provider stores `DateTime` as text with 7
  fractional digits — the fixture must write the same layout or the API's materializer misreads it.

## 5. API-level vs UI-level tests inside one file

A spec typically mixes both, and supports the separation:

```text
API-level:        request.post('/api/v1/warehouses', {...})   → assertions on the response body
                  listShipments(...) / createShipment(...) / seedShipment(...) / seedRoute(...)
UI-level:         page.goto('/') → LoginPage → fill → click → expect(role chip).toHaveText(...)
                  table rows → expect(...).toContainText(...)
```

Panels (`routes-ui.spec.ts`, `shipments-ui.spec.ts`, `planning-board-ui.spec.ts`, `dashboard-ui.spec.ts`)
cover the browser-surface bits (menus, confirmations, form flows). The API specs cover the
contract logic. Cross-checking is a feature: a UI bug in an API-tested flow fails in the UI spec
but the API spec still proves the endpoint behaves; the reverse is true for API-installed state
(e.g. a new route row appearing in the UI list).

## 6. Timeouts and flakiness

| Setting | Value | Why |
|---|---|---|
| `test.timeout` | 30s | one whole test can take up to 30s (DB reset + uploads) |
| `expect.timeout` | 7s | page assertions |
| `actionTimeout` | 7s | clicks/fillings; a stuck button is a real failure, not a hang |
| `retries: CI ? 1 : 0` | v1 local: no retries; CI: one retry | CI flakes (noisy CI machines) get one chance |

Rules of thumb for new tests: if a test takes >10s locally, it almost certainly does something
wrong (isolated DB reset per test, API call without token, waiting on a non-idle API, sleep-minus-
something). If a test is flaky, first check whether it depends on wall-clock (`npx playwright test
--grep` + run twice) or on shared DB state (unique-data per run).

