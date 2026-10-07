# 01 — Tech Stack & Environment

## 1. What we're stress-testing

| Component | Version / shape | Notes |
|---|---|---|
| ASP.NET Core 9 minimal API | `src/backend/LogiFlow.Api` (net9.0) | `dotnet run --project ... -c Release --no-build --urls http://localhost:5199` |
| Data | SQLite file `src/backend/LogiFlow.Api/logiflow.db` | WAL mode, `Serializable` writes (doc 04) |
| Frontend | React 18 + Vite (not under load in this test) | E2E suite (`tests/e2e`) is a separate load target |
| Token model | 15-min JWT + 7-day single-use refresh | `Jwt:AccessTokenMinutes=15`, `Jwt:RefreshTokenDays=7` |

## 2. The machine

```text
Windows, 16 logical CPUs, ~15 GB RAM
Node v22.18.0, npm 11.11.1, dotnet 9.0.304, git 2.50.1
```
No dedicated load-test host exists; a beefy desktop is fine for the staged program because the
bottleneck is the API's SQLite lock queue, not the client machine.

## 3. Tooling

| Tool | Install | Role |
|---|---|---|
| **k6** (recommended) | `winget install k6.k6` or `choco install k6` | VU-based load; thresholds, percentiles, CI-friendly |
| **Node bench** | built into the repo: `tests/e2e/bench.mjs` | keep-alive client benchmark; also serves as a quick probe harness |
| **curl** | `winget install curl` | one-shot probes, timing, header dump |
| **hey / autocannon** | `go install github.com/rakyll/hey@latest` or `npm i -D autocannon` | alternative HTTP loaders (any Node-friendly exerciser works) |
| **SQLite tooling** | `winget install sqlite/sqlite` | `sqlite3 logiflow.db ".tables"` for post-mortem DB checks |

The repo already ships the Node bench at `tests/e2e/bench.mjs` (it was written for this KB). It is
a plain Node ESM script — no Playwright dependency, so it can be run from anywhere. It opens a
**new TCP connection per request by default**, so reported req/s for *stateless* endpoints will be
client-limited (measured: 6.4 req/s at 64 in-flight for `/health`, p50 1 ms). For *real*
throughput numbers use the keep-alive version documented in doc 05, or switch to k6.

## 4. Starting the API for load runs

```powershell
cd c:\Sudipto\SpecDrivenDesigns\src\backend
dotnet build LogiFlow.Api/LogiFlow.Api.csproj -c Release -v q
cd LogiFlow.Api
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5199 nohup dotnet LogiFlow.Api.dll > ..\Logs\load-api.log 2>&1 &
```

Health: `curl http://localhost:5199/api/v1/health` → 200. The API runs in `Development`, so it
migrates the DB on startup and seeds demo users (`SeedData.DevelopmentPassword =
logiflow-dev-password`, seeded users alex/dana/raj/vera @logiflow.dev — see doc 07).

## 5. Environmental notes for stress runs

- **Leave the API running across the whole staged program.** Don't restart it between stages: each
  warm-up/throttle of the server changes the picture, and the soak stage is only meaningful when
  the server has been up continuously.
- **Do not run the E2E suite (`tests/e2e`) during the write/assign stages.** E2E shares the same
  demo SQLite file and runs with `workers: 1` (LOGI-0009) — parallel E2E + load is a guaranteed
  lock-contention mess.
- The E2E suite wants its own throwaway DB (`e2e-logiflow.db`). Never point the load run at it.
