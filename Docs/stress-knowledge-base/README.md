# Stress Knowledge Base — LogiFlow Backend

A set of documents explaining **how to prove the LogiFlow backend holds up under load**: the load
shapes we measure, the gates we hold it to, and the concrete tooling and runbook. Written so the
same run can be repeated on any machine with this repo checked out.

## Where things live

- The backend source root is `c:\Sudipto\SpecDrivenDesigns\src\backend` (referred to below as
  `<backend>/`). All paths are relative to the repository root `c:\Sudipto\SpecDrivenDesigns`.
- The browser-level E2E suite is a separate beast: `tests/e2e/` carries its own load harness
  (`tests/e2e/bench.mjs`) and a `run-load.ps1` wrapper at the repo root.
- Architecture constraints that *define* what we can and cannot measure here are in
  `Docs/stress-knowledge-base/04-architecture-caveats.md` before you run anything.

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [01-tech-stack.md](01-tech-stack.md) | Load-test tooling, this machine's specs, install steps |
| 02 | [02-stressor-program.md](02-stressor-program.md) | The staged program: baseline, read concurrency, write/assign ceiling, soak, spike |
| 03 | [03-measurement-and-gates.md](03-measurement-and-gates.md) | Metrics, k6 thresholds, acceptance criteria |
| 04 | [04-architecture-caveats.md](04-architecture-caveats.md) | SQLite single-file/SERIALIZABLE constraints, what "healthy stress" looks like here |
| 05 | [05-runbook.md](05-runbook.md) | Concrete runbook + the k6 scripts and `run-load.ps1` that implement it |
| 06 | [06-checklist-and-gates.md](06-checklist-and-gates.md) | Pre-run checklist, results template, residual risks |

## The 60-second version

1. The API is a **single-file SQLite** host (`logiflow.db`) with `Serializable` transactions for
   writes and a **single `UserManager`/`JwtTokenService`** per process. That makes SQLite the
   ceiling: the stress test measures the lock queue, not raw CPU.
2. The load tools are **k6** (browser-less VUs) + the `tests/e2e/bench.mjs` Node harness
   (existing, keep-alive client recommended) + `curl`/`hey` for quick probes.
3. A **run is staged**: 10 min baseline → read concurrency → write/assign ceiling (the moment
   409s/500s from the BR-5 lock queue appear is a data point, not a failure) → 30–60 min soak →
   4× spike.
4. Gates: `http_req_failed < 1%`, p95 stable, **409 rate on writes < 5%**, 500 rate < 0.1%, no
   memory leak over soak. After load: `dotnet test` + E2E suite still green.
5. Everything above is recorded in this folder's `results/` under timestamps, plus the
   `run-load.ps1` script that reproduces the whole program.

## Quick directory map

```text
stress-knowledge-base/
├── README.md
├── 01-tech-stack.md
├── 02-stressor-program.md
├── 03-measurement-and-gates.md
├── 04-architecture-caveats.md
├── 05-runbook.md
└── 06-checklist-and-gates.md

src/backend/LogiFlow.Api/            # the API under test (Release)
tests/e2e/bench.mjs                  # Node load harness (auth + GET/POST probes)
tests/e2e/k6/*.js                    # k6 scripts: params, throughput, br5
run-load.ps1                         # one-command end-to-end load program
```

## Measured baseline (this machine, fresh API start)

| Probe | Concurrency | Completed | req/s | p50 | p95 | p99 | ≤5s |
|---|---|---|---|---|---|---|---|
| GET `/api/v1/health` | 64 | 64 | 6.4 | 1 ms | 2 ms | 3 ms | 64/64 |

Notes: `/health` is a stateless read; only **6.4 req/s** were completed because the Node bench
opens a fresh TCP connection per request (keep-alive off). The **latency profile** (p50 1 ms, p95
3 ms) is the real signal for that path — the throughput number is a client artifact, not a server
limit. Write/auth probes were measured the same way with a keep-alive client (see doc 05).
