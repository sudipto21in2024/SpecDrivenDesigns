# 03 — API & DB Lifecycle (LOGI-0013)

Who owns the throwaway database, how it is created, seeded, and cleaned — and the file-deletion
bug that cost the team a week of CI headaches.

## 1. The throwaway database

```ts
// support/paths.ts (single source of truth)
export const API_PROJECT = resolve(__dirname, '..', '..', '..', 'src', 'backend', 'LogiFlow.Api');
export const E2E_DB_PATH = resolve(API_PROJECT, 'e2e-logiflow.db');
```

- Absolute path, inside the backend project, never inside `src/frontend`, never in a temp dir.
- That one constant is injected **twice**, in two places, and nothing else creates the DB:
  1. `playwright.config.ts` → `Database__ConnectionString=E2E_DB_PATH` on the API webServer
  2. `start-api.mjs` reads `process.env.E2E_DB_PATH` and spawns the API with that connection string

Conventions enforced by this design: the config and the fixtures can never disagree (LOGI-0013),
and the API's working directory cannot affect which file it opens.

## 2. Lifecycle of the database across one run

```text
runner process starts
  → webServer start (order in playwright.config.ts):
       a. start-api.mjs:
            rmSync(e2e-logiflow.db, -wal, -shm)          // stale leftovers, before the API exists
            mkdir(dirname)
            spawn 'dotnet run --project LogiFlow.Api -c Release --no-build --urls http://localhost:5199'
                { cwd: backend project root }
       b. frontend preview build + preview server on :5173
  → global-setup.ts:
       1. sign in as Admin + Dispatcher (API-level, real login)
       2. reset every collection to empty through the API (delete all rows, page-size 100)
            → collects ids from GET /api/v1/<collection>?page=1..N&pageSize=100, then DELETE each
  → specs run (1 worker, serial within a file)
  → on failure: traces retained; DB left as-is for debugging (it's throwaway, but useful after a
    crash: attach, read rows, see what the race left behind)
```

Three lifecycle rules in one sentence: **create before the API starts; delete as files while the
API does not exist; never unlink while SQLite holds the file open.**

## 3. The LOGI-0013 pitfall (why the reset goes through the API)

Old approach (removed): `global-setup.ts` also `rmSync`'d the live database file. On Windows that
no-ops (the API holds it open); on Linux in CI it succeeded, and the right failure took days to
diagnose:

```text
unlink() the open file          → SQLite keeps writing to the deleted inode
next physical connection opens  → re-creates an EMPTY database
every request                   → "no such table" HTTP 500
```

The current approach: cleanup is pure file deletion at a moment the API does not exist
(`start-api.mjs` runs before `dotnet` starts). From then on the API owns the file, fixtures seed
it, and the reset deletes rows through the API.

## 4. Why the API's SQLite is safe for direct-fixture writes

Fixtures (doc 04) do `new DatabaseSync(E2E_DB_PATH)` while the API has the file open, writing
rows (shipments, routes, vehicles, drivers) into the same SQLite file. Three facts make this safe:

| Fact | Why it matters |
|---|---|
| WAL mode | writes go to the `-wal` file; readers see committed frames; the API's `Connection__` reads are unaffected by a fixture's `INSERT` |
| `busy_timeout` (set on the fixture DB) | if the API holds a write lock, the fixture waits instead of `SQLITE_BUSY` |
| `fullyParallel: false` | the API is idle whenever a fixture runs, so the lock, if any, is never held during a fixture |

The WAL/lock model is also why the API and the fixture MUST target the same physical file path
(`E2E_DB_PATH` is the only string in both) — an off-by-one in that constant was exactly the
"spec seeds a different database than the API reads" failure (LOGI-0013 again, the mirror rule).

## 5. What survives between runs

`E2E_DB_PATH` is deleted at the start of `start-api.mjs` (files + wal + shm). After a run the
throwaway file may remain (it is not auto-cleaned) — that is intentional for debugging (attach
it, read the rows left by a race), but it is **never** reused as seed state: `retries: 1` + the
`runId`-unique data rule make every attempt from an empty database a requirement.
