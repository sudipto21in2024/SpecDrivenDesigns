# 05 — Shared State & Parallelism (LOGI-0009, LOGI-0013)

Why this suite runs with one worker and never parallelizes files, and what breaks if you change
those flags.

## 1. The config: `workers: 1`, `fullyParallel: false`

```ts
// playwright.config.ts
workers: 1, fullyParallel: false,   // LOGI-0009
```

- **One worker, serial files.** Every spec file starts its own browser context but shares the
  same throwaway SQLite database and the same running API. Playwright will never start a second
  worker for this suite.
- **`fullyParallel: false`** — even though a single file might be parallelizable, it isn't:
  fixtures within a file run serially by design (each test mutates the shared DB).

## 2. Why parallel files are dangerous here

Three intertwined reasons:

1. **One shared database, multiple API processes.** Spec A's `seedWarehouse` and spec B's
   `seedWarehouse` write into the same SQLite file. With workers, their API calls overlap in time.
   SQLite's write lock (even with WAL) would serialize them into one waiting transaction — and the
   "API is idle whenever a fixture runs" assumption is what makes that safe. A scheduler that
   interleaves the two concurrently would just serialize them anyway, but the ordering race is
   exactly where a spec's dependence on another spec's leftover rows hides.
2. **The `drivers.user_id` 1:1 link.** A seeded driver row stores `user_id = <driver id>`.
   Spec A saving a driver creates `user_id = 5`; spec B later creates `user_id = 6`.
   `user_id` is unique (Identity table), so two specs creating the same driver id in the same run
   collides on the unique index. With workers, the collision becomes a 409 in one spec instead of a
   serial, deterministic failure in the other — and logs get maddeningly hard to read because the
   two specs share a log file and timestamps.
3. **The reset contract.** `global-setup.ts` resets all collections through the API. A concurrent
   spec mid-fixture leaves rows the reset can't know about, or worse, the reset's list/delete
   races a spec's own create, so the DB never ends empty and every subsequent spec fails with
   "404/409/500 on unknown rows".

## 3. What the suite gains from seriality

- **Deterministic ordering within a file**, which the per-run `runId` + `seq` counters and the
  "own the rows" idiom depend on (each test books the exact vehicle/driver/window it needs).
- **Easier debugging**: the Playwright trace for a failure shows exactly which spec + which test
  + which API call, with no interleaving of two specs' API calls in one trace.
- **One assumption to reason about** (`workers: 1`, LOGI-0009): no spec may depend on another
  spec's rows in any state, and no fixture may run while another spec's API call is in flight.

## 4. What you must not do without re-designing

| Change | Consequence |
|---|---|
| `workers: 2` | parallel spec files share `e2e-logiflow.db`; fixture races + unique-key 409s + un-resettable rows |
| `fullyParallel: true` (per file) | one file's `test.beforeEach` tokens and `seq` counters interfere with another spec in the same file; the "own the rows" idiom breaks |
| reset-per-spec | would require the API to be idle per test AND every collection to be fully removable — the current API doesn't expose per-collection reset, and the DB is shared anyway |
| deleting the DB in global-setup | see LOGI-0013 — on Linux the file stays open and writes leak into a deleted inode |

## 5. Verifier for parallel-safety when adding a spec

Before adding a new spec file, ask: does it (1) sign in through the API rather than minting tokens,
(2) own every row it creates, (3) depend on no other spec's rows for its assertions, and (4) never
run in parallel with other files? If yes, it is safe to add to this suite as-is.
