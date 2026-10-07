# 02 — The Stressor Program

A staged program instead of one big blast. Each stage answers a different question, and the
**duration is short enough to be tolerable, long enough to be meaningful**.

## 1. Stage glossary

| Stage | VU target | Duration | Question |
|---|---|---|---|
| 0. Baseline | 1 | 2 min | What does one request cost? (p50/p95/p99) |
| 1. Read concurrency | 10 → 32 | 5 min | How does read-heavy load behave? (p95 growth, 401/403) |
| 2. Write + ceiling | 16 → 64 | 10 min | Where does the SQLite lock queue kick in? (409s rising) |
| 3. Soak | 8 constant | 30–60 min | Memory/connection leak, no 500 drift |
| 4. Spike | 8 → 128 | 5 min ramp + 3 min soak | What happens on a sudden burst? |
| 5. Regression gate | — | 9 min | E2E suite still green after load |

## 2. Stage details

### Stage 0 — Baseline (2 min)
- 1 VU, single endpoint, 2 min.
- Record: p50/p95/p99, bytes, error count for the endpoints we care about.
- Endpoints: `GET /api/v1/health`, `GET /api/v1/auth/me`, `GET /api/v1/shipments?status=Pending`.

### Stage 1 — Read concurrency (5 min)
- 10 VUs → 32 VUs, gradual ramp, all read-only.
- Profile: `GET /api/v1/shipments?status=Pending`, `GET /api/v1/dashboard`, `GET /api/v1/vehicles?status=Available`.
- Profile: **Dispatchers** (alice-like login) — the benchmark targets all authenticated reads.
- Record: p95/p99 per stage, total 401s (token rotation of a shared token is fine here since it's
  just an in-memory cache refill, but watch for the `refreshInFlight` serialization).

### Stage 2 — Write + concurrency ceiling (10 min)
- 16 → 64 → 100 VUs, each VU: login as Dispatcher, then loop: create a Pending shipment (100 kg)
  then assign it to one shared route.
- **This is the moment the SQLite lock queue shows up.** Expect 409s (capacity/state conflicts)
  — those are *correct* outcomes, not failures. Watch the 409 rate, the p95 write latency, and
  whether the 409s coalesces around a particular guard (capacity vs. state).
- The route/vehicle used must have a known capacity (BR-5). The runbook documents how to create
  it deterministically.

### Stage 3 — Soak (30–60 min)
- 8 VUs, read-heavy: `GET /api/v1/shipments?status=Pending`, `GET /api/v1/dashboard`, plus one
  create+assign round per VU every 30 s.
- Record: memory (`dotnet counters`), SQLite WAL size, Serilog file growth, 500 rate, response
  p95. Soak ends when nothing trends upward.

### Stage 4 — Spike (5 min)
- 8 VUs → 128 VUs over 60 s → hold 3 min → ramp to 0.
- Watch: p95, 401 (token refresh storms), 409s from the lock queue during the burst.

### Stage 5 — Regression gate (9 min)
- After any load run: `cd tests/e2e && npx playwright test`. If the suite goes red, the load run
  is recorded as **invalid** until the red is explained — do not ship the stress report.
- Also re-run `dotnet test` in `src/backend` (244 tests) — the API's gates stay green.

## 3. The canonical stage definition (copy/paste into a run sheet)

```text
Stage 0  Baseline      1 VU    2m    GET health / auth/me / shipments?status=Pending
Stage 1  Read concurrency 10->32  5m   GET shipments|dashboard|vehicles (authenticated)
Stage 2  Write ceiling  16->100 10m   login+create+assign per VU (shared route)
Stage 3  Soak           8  cons 30-60m reads + 1 create/assign/30s
Stage 4  Spike          8->128   5m   60s ramp, 3m hold, ramp down
Stage 5  Regression     -        9m   dotnet test + npx playwright test
```

## 4. Labels every result must carry

1. Date + time (UTC), machine (CPU/RAM), and API commit hash (`git rev-parse HEAD` in
   `src/backend`).
2. API build config (`dotnet build LogiFlow.Api -c Release` output path) + Runtime.
3. Whether demo data seeded (`Data Source=logiflow.db`) or throwaway (E2E DB).
4. For each stage: VU count, duration, completed requests, p50/p95/p99, error counts by status,
   and the 409/403/500 breakdown.
5. Post-run: `dotnet test` summary + `npx playwright test` summary (regression gate).
