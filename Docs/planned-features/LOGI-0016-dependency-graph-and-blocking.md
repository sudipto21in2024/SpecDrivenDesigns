# LOGI-0016 (PROPOSED) — Dependency Graph, Blocking & Queue Release Gates

> **Future development plan** · Documented 2026-09-26 · Origin: the LOGI-0015 tracker-fix session
> (`6ed7c81`) when the question "can the flow model *task B depends on task A which is not
> implemented*?" was asked and answered: **partially — declaration yes, enforcement no.**

**Status: PROPOSED — intentionally NOT in tracker state.**

- No `PLAN_CREATED` event, no `state/plans/LOGI-0016-*.plan.md`, no `LOGI-0016` row in
  `state/events.jsonl`. `tracker status` is unaffected (`Queue Detail: 6 actionable`).
- Why not pre-create it: a draft plan with no holding arm is already `dispatchable` by the current
  queue rule (`core.mjs:227`), so pre-creating it would inject a phantom actionable ticket into
  `tracker ready`, and `tracker plan new` would later fail with `plan already exists`.
- Promotion is a **transcription**, not a re-think: §10 contains a complete, ready-to-copy arm plan.
  Procedure: §7.6.

**Read order:** §1 context → §3 gaps → §4 scenarios (requirements in story form) → §6 design →
§7 execution plan → §10 pre-drafted arm plan.

---

## 1. Context — why this plan exists

### 1.1 The LOGI-0015 finding chain

LOGI-0015 fixed the tracker's status derivation and dispatch queue. The root problem it exposed was
structural, not cosmetic:

| # | Finding | Where |
|---|---|---|
| F1 | `handoff` never recorded the destination state (0 of 24 legacy handoffs had `toState`), so every ticket stayed `status: planned` | `tools/tracker/index.mjs:204-216` (now writes `toState`) |
| F2 | `rebuildSnapshot` read the field that was never written → the snapshot lied | `core.mjs:30-37` `handoffState()` |
| F3 | `LEGAL_TRANSITIONS` existed but was **dead code** — no caller | now enforced at `index.mjs:211-213`, exit 1, `--force` escape |
| F4 | `readyQueue` equated "no open arm" with "ready" → finished tickets re-proposed (LOGI-0002..0007, LOGI-0014) while the real next ticket (LOGI-0013) was invisible | `core.mjs:202-235` |
| F5 | Single-JSON-truth confirmed: `state/events.jsonl` + `state/handoffs.jsonl` are the truth; `state/tasks.json` is a **write-only derived dump** (zero read sites; any tracker run rewrites its `generated` timestamp, dirtying the tree) | `core.mjs:6-14` |
| F6 | Ticket backlog is **parsed markdown**: `Docs/PROJECT_STATUS.md` §2 table | `core.mjs:17-20`, `roadmapBacklog()` `core.mjs:169` |

### 1.2 The question this plan answers

> *"Task B depends on task A. A is not implemented. Does the current workflow know?"*

Answer: **it can be written down, it is only sometimes checked, and it is never enforced on the
queue.** The dispatch queue is ordered by ticket ID / roadmap row order and consults **no
dependency information at all**. Declaration exists in three overlapping places that no single tool
reads, and the one hard gate that does exist is artifact-level (§3 required-file existence), not
ticket-level. Details: §2 (inventory) and §3 (gaps).

### 1.3 Current runtime truth (baseline to preserve)

```text
$ node tools/tracker/index.mjs status
=== AGENT CONTEXT & STATE ===
Working Tree: clean
Tip Commit  : 6ed7c81 fix(tracker): derive ticket state from handoff destination ...
Active Arm  : NONE (idle)
Dispatch Q  : Next ready ticket is LOGI-0013 (status: in_progress, next: orchestrator, source: tracked)
Queue Detail: 6 actionable (tracked-in-flight 1, roadmap-backlog 5)
```

**Non-regression contract:** every gate in §7.7 must keep `LOGI-0013` as the queue head, keep
`done` tickets out of the queue, and keep the 24 legacy handoffs replaying correctly.

---

## 2. Current-state inventory

### 2.1 What exists and genuinely works

| Mechanism | Evidence | Enforced? |
|---|---|---|
| **Arm-level dependency declaration** `depends_on_plans:` in plan front matter — in active use | template `index.mjs:21`; `state/plans/LOGI-0004-qa.plan.md:6` = `LOGI-0004-architect, LOGI-0004-backend, LOGI-0004-frontend`; `state/plans/LOGI-0007-architect.plan.md:6` = `LOGI-0006-*` | **Warning only** (`plans.mjs:131-140`) |
| **§3 Required files must exist** — listing an upstream artifact in §3 makes `plan lock` **exit 1** until that code exists | `plans.mjs:116-118` (error) → `index.mjs:241-242` (exit 1) | ✅ **Hard gate (artifact level)** |
| **`blocked` lifecycle state** — `in_progress->blocked`, `blocked->in_progress` legal; blocked tickets excluded from the queue | `core.mjs:23-26`; `dispatchable = status!=='done' && !=='blocked' && !holdingArm` (`core.mjs:227`) | ✅ once the ticket is `in_progress` |
| **Interface-first decoupling** — architect arm owns `contracts/**` + generated `schema.d.ts`, so downstream arms build against a frozen interface instead of a missing implementation | `ARM_BOUNDARIES` `core.mjs:39-46` | ✅ (why cross-ticket deps are rare here) |
| **Escalation contract** — `/specs/escalations/<ticket-id>.md` "blocks the ticket until a human resolves" | `03-spec-driven-workflow.md:54-62`; `10-orchestration-kilocode-config.md:31` | ✅ human-gated |
| **Obstacle + recovery telemetry** — `micro --gate fail` records a failed gate + `next_action`; `resume-check` returns `clean|mid_step|broken` before resuming; `ready --stuck` finds orphaned in-progress arms | `execute-plan/SKILL.md:27`; `core.mjs` (`resume-check`, `readyQueue({stuckOnly})`) | ✅ |

### 2.2 Where dependency information lives today — and who reads it

| Source | Populated? | Read by any tool? |
|---|---|---|
| Plan front matter `depends_on_plans` (arm-level) | ✅ 20+ plans | ⚠️ `validatePlan()` warnings only |
| Roadmap prose in `Docs/PROJECT_STATUS.md` §2: `**Dependencies:** LOGI-0001 → LOGI-0003 (auth gates domain features); LOGI-0006 before LOGI-0007/0008.` | ✅ prose | ❌ nobody (it is a sentence, not a column) |
| Spec front matter `depends_on:` (`specs/features/*.md:7`) | ❌ empty in every spec (LOGI-0000..0007) | ❌ `tools/spec/index.mjs` only extracts §1..§7 sections |
| `state/events.jsonl` / `handoffs.jsonl` | ✅ the truth | ✅ status derivation only — no edge model |
| Escalation files `specs/escalations/*.md` | ❌ none exist yet | ❌ nothing verifies existence or links it to a state |

### 2.3 The decisive asymmetry

- **Inside a ticket** the arm order is explicit and enforced-ish: architect → backend/frontend →
  qa, declared via `depends_on_plans` (e.g. `LOGI-0004-qa` depends on all three upstream arms).
- **Across tickets** there is *no* structure at all. `LOGI-0010` (assign shipment→route, BR-5)
  cannot work without `LOGI-0009` (create route + assign vehicle/driver) — yet today
  `src/backend/**/*.cs` contains no `Route` type and `contracts/v1-openapi.yaml` contains **no
  `/routes` path** (verified: both greps empty). The queue still offers `LOGI-0010` as an ordinary
  actionable row the moment `LOGI-0008`/`0009` leave the queue.

---

## 3. Gaps (what must change)

| # | Gap | Evidence | Effect |
|---|---|---|---|
| **G1** | Ticket-level dependencies are **prose/empty fields, not data** | `PROJECT_STATUS.md` §2 sentence; `specs/features/*.md:7` `depends_on:` empty; roadmap table has no dependency column | No tool can ask "what blocks LOGI-0010?" |
| **G2** | Queue has **no dependency awareness or topological order** | `readyQueue()` sorts by ticket ID then roadmap row order (`core.mjs:202-235`) | A ticket whose prerequisite isn't implemented is proposed as "next ready" |
| **G3** | **`planned->blocked` is illegal** | `LEGAL_TRANSITIONS` `core.mjs:23-26` | You cannot park an *unstarted* dependent ticket. Today you must `claim` an arm (write a plan for work you cannot do) and then hand off `--to blocked`, or pass `--force` |
| **G4** | `depends_on_plans` is a **non-blocking warning** and checks **paperwork, not code** | warnings only (`plans.mjs:131-140`); `plan lock` fails only on `errors` (`index.mjs:241-242`); no `exit 1` on warnings | A plan declaring an unbuilt/unlocked dependency still locks; and a plan can read `done` while its code is reverted |
| **G5** | `blocked` is a **dead end, not an edge** — no `blockedBy`, no reason, no re-evaluation | handoff record carries only `toState`/`to` (`index.mjs:215`); `show` prints `next: blocked` with no "on what" | A blocked ticket silently leaves every queue; nothing says *why* or *what would release it* |
| **G6** | `ready --stuck` covers only **stale in-progress arms**, never dependency-held tickets | `readyQueue({stuckOnly})` semantics (`core.mjs:202`) | Dependency-held work has no revisit signal at all |
| **G7** | Roadmap **status cells are stale**, so they cannot be trusted as dependency truth | `PROJECT_STATUS.md` §2 still shows LOGI-0004..0007 "⬜ Not Started" while their arms/handoffs are `done` and `LOGI-0007-F2` is an open finding | Any naive "is my dep green?" check against the markdown table would hold work forever. Truth must be the event log, with the cell only as fallback for untracked tickets |
| **G8** | **No cycle detection** and no reopen invalidation | plan-level `depends_on_plans` can be mutually declared (A→B, B→A); `done->in_progress` is legal for reopen (`core.mjs:23-26`) | Mutual deps deadlock silently; reopening an upstream (`LOGI-0007-F2` style defect) never flags the dependents that were released on it |

---

## 4. Scenarios — what "dependency support" has to mean here

Each scenario is grounded in this repo. "Current" = verified behavior today; "Required" = target
behavior to be pinned by the ACs in §5.

### S1 — Forward dependency, upstream not implemented (the common case)

**Case:** `LOGI-0010` (Assign shipment→route, BR-5 capacity check) depends on `LOGI-0009` (Create
route + assign vehicle/driver). `Route` does not exist yet (no entity, no endpoint, no `/routes`
path in the contract).
**Current:** after `LOGI-0008`/`0009` leave the queue, `LOGI-0010` becomes the head with
`dispatchable: true, status: planned`. An agent claims it, writes a plan, and either fails §3/compile
or — worse — omits the upstream artifact from §3, locks and lies.
**Required:** `LOGI-0010` carries `depends_on: [LOGI-0009]`; `tracker ready` reports it as
`dispatchable: false, reason: dependency-held, heldBy: LOGI-0009 (status: planned)`; it becomes the
head only when `LOGI-0009` is `done` **per the event log**. `status` prints the held count so the
queue is not silently short.

### S2 — Cross-cutting / sideways dependency (not an adjacent ID)

**Case:** `LOGI-0013` (e2e harness) is `in_progress` and unfinished; the qa arms of the domain
tickets carry gates that need a trustworthy e2e job — its own plan records
"LOGI-0005 frontend/qa arms unblocked (their gates depend on a trustworthy e2e job)".
**Current:** nothing links the two. `LOGI-0013` can sit in_progress indefinitely while
`LOGI-0008` (and its qa arm) gets dispatched.
**Required:** arm-level dependencies (`depends_on_plans: LOGI-0013-qa`) are surfaced at `plan lock`
as an explicit **release-gate** line, and `tracker status` reports "1 dependency held by an
in-flight ticket" so the orchestrator can decide to finish or park the upstream first.

### S3 — Dependency *never started* (no plan, no code, roadmap-only)

**Case:** the dependent ticket B is discovered before A has any plan: A exists only as a roadmap row.
**Current:** `planned -> blocked` is illegal (`core.mjs:23-26`). The orchestrator must either
`--force` an illegal transition or write a plan it cannot execute. Roadmap-sourced rows are emitted
unconditionally as `{status: 'planned', dispatchable: true}` (`core.mjs:231-234`).
**Required:** `tracker block --ticket B --blocked-by A --reason "route entity absent"` works from
`planned`, needs **no plan file**, removes B from the queue, and `tracker show B` prints the blocker
and its live status.

### S4 — The stale-paperwork trap (do not trust the roadmap cell)

**Case:** `PROJECT_STATUS.md` §2 still says "⬜ Not Started" for LOGI-0004..0007 although the arms,
handoffs and journals are `done` (`LOGI-0007-F2` is the only open finding); `tasks.json` is a
write-only dump.
**Current:** no dependency engine exists, so no harm yet — but the naive implementation (read the
"Status" cell) would permanently hold LOGI-0011/0012.
**Required:** dependency status is **event-log first** (`handoffState()`), roadmap cell only as a
fallback for tickets with no tracked events; every rendered status carries its `source`
(`tracked` vs `roadmap`) exactly as the queue does today.

### S5 — Artifact-level dependency (A is done, the specific piece B needs is not)

**Case:** A's arm is `done`, but the artifact B needs was deferred, or B is not allowed to create it
because of `ARM_BOUNDARIES` (backend may not write `src/frontend/**`; qa may not write `src/**`).
**Current:** the only hard code-level gate is §3 required-file existence (`plans.mjs:116-118`) — and
it only fires if the plan author honestly lists the artifact.
**Required:** keep §3 as the hard gate, and make the *link* explicit: plan-arm guidance requires
that a dependency declared in `depends_on_plans` whose artifact the arm consumes appears in §3, so
the soft ticket-level declaration is converted into the hard artifact-level stop.

### S6 — Circular / co-designed dependency (A↔B)

**Case:** LOGI-0010 needs the route API; the route API's shape may need the shipment-assignment
rules (BR-5). Declaring `depends_on_plans` both ways is possible today.
**Current:** both plans warn, both lock, nobody detects the deadlock; the queue just offers whichever
ID is smaller.
**Required:** cycle detection in `status` / `validate-plan` printing `DEP_CYCLE: A → B → A` with the
prescribed resolution (split with an **architect** arm — `contracts/**` is its boundary — freeze the
interface, then both sides proceed in parallel). A cycle must be visible, not fatal: the queue keeps
working.

### S7 — Reopened upstream (transitive invalidation)

**Case:** `LOGI-0007` is reopened for the open defect `LOGI-0007-F2`; `done -> in_progress` is a
legal reopen transition. Tickets released on LOGI-0007 being green (board `LOGI-0011`, dashboard
`LOGI-0012`) are now standing on moved ground.
**Current:** nothing notices.
**Required:** advisory `STALE_DEP` reporting in `tracker status` ("LOGI-0011 was released on
LOGI-0007, which is back in_progress"), never an automatic re-block (avoids churn and rework loops).

---

## 5. Requirements & acceptance criteria

| AC | Requirement | Scenario | Verification |
|---|---|---|---|
| **AC-1** | A ticket-level dependency can be declared in exactly one authoritative place and be machine-readable | S1, S3 | `tracker deps --ticket LOGI-0010` prints `[{ticket: LOGI-0009, source: spec\|roadmap\|handoff}]` |
| **AC-2** | The dispatch queue never proposes a ticket whose dependencies are not `done`; held tickets appear with a reason and blocker list | S1, S2 | `tracker ready` on a fixture with an unmet dep → `dispatchable:false, reason: dependency-held`; `status` prints the held count |
| **AC-3** | Dependency status is derived from the event log first; the roadmap cell is only a fallback for untracked tickets and is labelled as such | S4 | `LOGI-0007` reads `done` while its roadmap cell says "Not Started"; `source: tracked` in output |
| **AC-4** | An unstarted dependent ticket can be parked without a plan file and without `--force`: `planned->blocked` is legal | S3 | `planned->blocked` accepted; `planned->done` still exit 1; no `state/plans/*.plan.md` created by `block` |
| **AC-5** | Blocking records *what* blocks it: `blockedBy` (ticket or arm id) + free-text reason, persisted, printable | S3, G5 | `tracker show` prints `blockedBy`, `reason`, and the blocker's live status |
| **AC-6** | Release is explicit and verified: `tracker unblock` refuses while any dependency is not `done`, and names the blocker | S1, S3 | `unblock` on unmet dep → exit 1 listing blockers; on met dep → `blocked->planned` (or `->in_progress`) recorded |
| **AC-7** | "Ready to release but still blocked" is surfaced, never auto-applied | S1, S7 | `tracker status` prints `UNBLOCK_CANDIDATE: <ticket> (deps green)` |
| **AC-8** | Cycles are detected and reported with the architect-split remedy; the queue keeps working | S6 | fixture with A↔B → `DEP_CYCLE:` line, exit 0 for read commands |
| **AC-9** | Reopening an upstream flags its released dependents as `STALE_DEP` (advisory only) | S7 | fixture: dep `done->in_progress` → dependent listed in `status`; queue unchanged |
| **AC-10** | Plan-level dependencies become a **hard gate when asked** and stay advisory by default | S5, G4 | `plan lock --strict-deps` (or `TRACKER_STRICT_DEPS=1`) refuses missing/`draft` deps with exit 1; default behavior unchanged (warnings only) |
| **AC-11** | Dependency evaluation is testable **without touching real state** | all | `TRACKER_STATE_DIR` (+ existing `TRACKER_ROADMAP`) run the whole suite against a temp fixture dir |
| **AC-12** | No regression of the LOGI-0015 contract | §1.3 | `LOGI-0013` remains queue head; no `done` ticket in the queue; 24 legacy handoffs replay; `node --check` clean |

---

## 6. Design (minimal, single-JSON-truth preserved)

Design principle: **derive, don't duplicate.** No new JSON store, no graph database, no scheduler.
Dependency edges are *read* from existing artifacts and *recorded* (when runtime-discovered) in the
existing event/handoff log so they survive session restarts.

### 6.1 Declaration sources and precedence

| Priority | Source | Form | Scope | Status today |
|---|---|---|---|---|
| 1 | Explicit runtime block | `HANDOFF`/`BLOCKED` event with `blockedBy`, `reason` | ticket | new (AC-4/AC-5) |
| 2 | Spec front matter | `depends_on: [LOGI-0009]` in `specs/features/<TICKET>-*.md` | ticket | field exists, empty, unread (revive) |
| 3 | Roadmap column | new `Depends on` column in `Docs/PROJECT_STATUS.md` §2 | ticket | new; the current prose sentence moves into it |
| 4 | Plan front matter | `depends_on_plans: LOGI-0009-backend` | **arm** | in use; keep, harden (AC-10) |

Merged per ticket; the runtime block wins (it is a human/agent decision made with more information).
Every element carries `source` so output never overstates certainty.

### 6.2 Derived model (new functions in `tools/tracker/core.mjs`)

```js
// edges: ticket -> [{ dep, kind: 'ticket'|'arm', source, reason }]
export function dependencyEdges(tickets)        // merges §6.1 sources (spec, roadmap column, events, plans)

// status of each blocker, event-log first, roadmap cell fallback, labelled
export function blockerStatus(dep)              // { status, source: 'tracked'|'roadmap' }

// held classification for one ticket
export function dependencyHeld(ticket)          // { held, blockers:[{dep,status,source}], stale:[...] }

// cycle detection for reporting (not throwing)
export function findCycles(edges)               // [[A,B,A], ...]
```

`readyQueue()` gains `held` classification and a `heldReason` field; `--all` keeps auditing
everything, `--held` lists only dependency-held rows (AC-7 companion to `--stuck`).

### 6.3 State-machine changes (`LEGAL_TRANSITIONS`, `core.mjs:23-26`)

```js
'planned->in_progress', 'in_progress->done', 'in_progress->blocked',
'blocked->in_progress', 'blocked->planned',        // NEW: release an unstarted ticket
'planned->blocked',                                // NEW: park a ticket that cannot start (AC-4)
'done->in_progress',                               // reopen for bugfix routing (unchanged)
```

`handoffState()` is unchanged (backward compatible with the 24 legacy records). `--force` remains the
escape hatch; every forced transition must state a reason in the event note.

### 6.4 Queue semantics

| Row kind | Today | With LOGI-0016 |
|---|---|---|
| `in_progress` with an open arm | head candidate | unchanged (recovery takes precedence) |
| `done` | excluded | excluded (unchanged) |
| `blocked` (explicit) | excluded | excluded + printed as `held (blocked): <ticket> ← <blocker>` |
| `planned` with unmet deps | `dispatchable: true` ⚠️ | `dispatchable: false, reason: dependency-held, heldBy: [...]` |
| `planned` with met deps | `dispatchable: true` | `dispatchable: true` |
| `planned` with a dep cycle | nothing | `dispatchable: false, reason: dependency-cycle` + `DEP_CYCLE:` line |

`tracker status` becomes:

```text
Dispatch Q  : Next ready ticket is LOGI-0013 (status: in_progress, next: orchestrator, source: tracked)
Queue Detail: 6 actionable (tracked-in-flight 1, roadmap-backlog 4, dependency-held 1)
Held        : LOGI-0010 ← LOGI-0009 (planned, tracked)  [unimplemented upstream]
```

Blocked tickets are **never** silently dropped: they are listed under `Held`/`UNBLOCK_CANDIDATE`
so the orchestrator always sees the shortfall (§3 G5/G6).

### 6.5 CLI surface (additions only — no existing command changes semantics)

```text
deps --ticket T                     merged edges + live blocker status (AC-1)
block --ticket T --blocked-by X[,Y] --reason "..."      park from planned|in_progress (AC-4/5)
unblock --ticket T [--to planned|in_progress] [--note]   verified release (AC-6)
ready [--stuck] [--all] [--held]    --held lists dependency-held rows
show --ticket T                     existing output extended with blockedBy/reason/dependents
plan lock [--strict-deps]           opt-in hard dependency gate (AC-10)
```

`block`/`unblock` write through the **existing** `appendHandoff()`/`appendEvent()` path, so
`state/events.jsonl` stays the single source of truth and `tracker history` shows the whole story.

### 6.6 Validator changes (`tools/tracker/plans.mjs`)

- Keep `depends_on_plans` as **warnings** by default (parallel-but-declared work stays legal).
- Add `strictDeps` option: promote `dependency plan not found` and `status not in {locked, done}` to
  **errors** (exit 1 on `plan lock --strict-deps` / `TRACKER_STRICT_DEPS=1`).
- Add cycle detection for `depends_on_plans` chains (`DEP_CYCLE` warning, always on).
- Add an advisory check: a dependency named in `depends_on_plans` whose §2 artifacts are consumed
  should appear in §3 (S5: converts the soft declaration into the hard artifact gate).

### 6.7 Documentation changes

| File | Change |
|---|---|
| `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` | state-machine table gains `planned->blocked` and `blocked->planned`; queue model paragraph documents held semantics; command table gains `deps/block/unblock/--held/--strict-deps` |
| `Docs/ProjectTechGuidence/03-spec-driven-workflow.md` | new **"Dependencies & blocking"** section (declaration sources, precedence, release rules, cycle remedy) next to the existing "Escalation to human" (lines 54–62); spec front-matter `depends_on:` becomes normatively populated |
| `.clineskills/plan-arm/SKILL.md` | rule: "a consumed upstream artifact must be listed in §3 (hard gate); declare `depends_on_plans` for arm-level ordering" |
| `.clineskills/orchestrate-dispatch/SKILL.md` | step: before dispatch, read the `Held` line; on `UNBLOCK_CANDIDATE`, verify the blocker is merged and `unblock` |
| `Docs/PROJECT_STATUS.md` §2 | add `Depends on` column; move/replace the prose sentence; backfill LOGI-0004..0012 from §4 of this doc's scenario table |
| `Docs/OPTIMIZATION_TASKS.md` | Phase 6 register (this plan) |

### 6.8 Interaction with the vertical-slice arm contract

Blocking happens **before `claim`** — that is the point. The arm model ("one arm = a slice that
compiles and passes its gates in 1–2 passes") is preserved; what changes is that a ticket whose
prerequisite is absent never reaches the point where an agent must improvise. The three legal
outcomes for a blocked arm stay: fail fast (`micro --gate fail`), fold the prerequisite (only if
inside `ARM_BOUNDARIES`), or escalate (`in_progress->blocked` + `specs/escalations/<ticket>.md`).

### 6.9 Non-goals (explicitly out of scope)

- No scheduler, no automatic dispatch, no auto-unblock (humans/orchestrator decide).
- No parallelism model change: parallel arms still start at `CONTRACT_APPROVED`
  (`orchestrate-dispatch/SKILL.md:17`).
- No new state store, no dependency data in `state/tasks.json` (write-only dump), no changes under
  `src/**`, `contracts/**`, `tests/**` (keeps the arm outside the product code boundaries).
- No remote-CI dependency in gates (protocol rule 7).

---

## 7. Planned execution

**Ticket:** `LOGI-0016` (tracker/tooling infra ticket, no `specs/features` spec — same class as
LOGI-0013/0014/0015). **Arm:** `orchestrator`. **Shape:** 3 vertical-slice milestones, 1–2 passes,
one atomic commit at the end (protocol rules 2, 6).

### 7.1 Milestone 1 — Dependency model, state machine & resolver

**Deliverable:** the graph exists in code and is unit-provable.

1. `core.mjs`: add `TRACKER_STATE_DIR` override (+ keep `TRACKER_ROADMAP`, `TRACKER_STALE_MINUTES`)
   so fixtures run on a temp dir (AC-11).
2. `core.mjs`: extend `LEGAL_TRANSITIONS` with `planned->blocked` and `blocked->planned` (§6.3).
3. `core.mjs`: `dependencyEdges()` / `blockerStatus()` / `dependencyHeld()` / `findCycles()` (§6.2),
   reading spec front matter `depends_on:`, roadmap `Depends on` column, `HANDOFF.blockedBy`, and
   `depends_on_plans`; event-log-first status with labelled roadmap fallback (AC-3).
4. `core.mjs`: `roadmapBacklog()` learns the optional 5th column (tolerate 4-column tables → keeps
   parsing today's file untouched until the column is added in M2).
5. `core.mjs`: `readyQueue()` gains `held` classification, `heldReason`, `heldBy`, and a `heldOnly`
   option (AC-2).

**Verify:** `node --check tools/tracker/core.mjs`; fixture sweep with `TRACKER_STATE_DIR=<tmpdir>`
proving: (a) unmet dep → `dispatchable:false` + blocker list; (b) blocker flipped to `done` →
dispatchable; (c) A↔B → cycle reported; (d) legacy replay unchanged (`ready` head LOGI-0013,
`LOGI-0007` `done`).

### 7.2 Milestone 2 — CLI surface, queue surfacing & validator hardening

**Deliverable:** the human/orchestrator can see and act on dependencies.

1. `index.mjs`: `deps --ticket T`, `block --ticket T --blocked-by X[,Y] --reason "..."`,
   `unblock --ticket T [--to planned|in_progress] [--note ...]` (§6.5); `handoff` gains
   `--blocked-by/--reason` pass-through for the mid-arm case.
2. `index.mjs`: `status` prints `Held:` rows, `UNBLOCK_CANDIDATE:`, `STALE_DEP:`, `DEP_CYCLE:`
   (AC-7/8/9); `ready --held`; `show` extended with `blockedBy`, `reason`, `dependents`.
3. `index.mjs`/`plans.mjs`: `plan lock --strict-deps` / `TRACKER_STRICT_DEPS=1` (AC-10) + plan-level
   cycle warning + the §3-consumption advisory (§6.6).
4. Docs & skills (§6.7): `11-agent-context-and-execution.md`, `03-spec-driven-workflow.md`,
   `plan-arm`, `orchestrate-dispatch`, and the `Depends on` column backfill in
   `PROJECT_STATUS.md` §2 (replace the prose sentence).

**Verify:** `planned->blocked` accepted, `planned->done` still exit 1; `block`→`unblock` round trip on
a scratch ticket id in a temp state dir (never in real `state/`); `unblock` refuses while a dep is
unmet (exit 1 naming the blocker); `plan lock` on existing plans still passes unchanged;
`--strict-deps` refuses a `draft` dep; `node --check` all three `.mjs`.

### 7.3 Milestone 3 — Arm verification, regression sweep & handoff

**Deliverable:** green gates + sealed journal + atomic commit.

1. Full CLI regression sweep (§7.5) against **real** state, exit 0.
2. Confirm the non-regression contract (§1.3) and that `git status --short` shows only §2 manifest
   files (no `src/**`, `contracts/**`, `tests/**`).
3. `tracker tick` × 3 + `tracker log --type STEP_DONE` per milestone, `tracker seal`, journal
   findings for the new gaps discovered during implementation.
4. One atomic commit: `feat(LOGI-0016): dependency graph, blocking & queue release gates`; then
   `tracker handoff --ticket LOGI-0016 --from orchestrator --to done`.

### 7.4 Planned §2 touched-files manifest (for the arm plan)

| Path | Action | Why (AC) | Est. lines |
|---|---|---|---|
| `tools/tracker/core.mjs` | modify | graph, state machine, queue, state-dir override | ~140 |
| `tools/tracker/index.mjs` | modify | `deps/block/unblock/--held/--strict-deps`, status lines | ~110 |
| `tools/tracker/plans.mjs` | modify | strict/cycle/advisory checks | ~45 |
| `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` | modify | state machine, queue model, commands | ~30 |
| `Docs/ProjectTechGuidence/03-spec-driven-workflow.md` | modify | dependencies & blocking section | ~35 |
| `Docs/PROJECT_STATUS.md` | modify | `Depends on` column + backfill | ~20 |
| `Docs/OPTIMIZATION_TASKS.md` | modify | Phase 6 status ticks | ~10 |
| `Docs/planned-features/LOGI-0016-dependency-graph-and-blocking.md` | modify | mark promoted + status | ~5 |
| `.clineskills/plan-arm/SKILL.md`, `.clineskills/orchestrate-dispatch/SKILL.md` | modify | dependency rules in the loop | ~15 |
| `state/plans/LOGI-0016-orchestrator.plan.md`, `state/events.jsonl`, `state/handoffs.jsonl` | create/append | plan + evidence (CLI-only writes) | — |
| `memory/journal/LOGI-0016.md`, `memory/active.md`, `memory/progress.md` | create/append | seal + handoff (CLI-only writes) | — |

Boundary note: arm `orchestrator` is defined as `{ write: ['memory/**','state/**'], deny: [] }`
(`core.mjs:45`) — the empty `deny` list is what makes the `tools/**` + `Docs/**` + `.clineskills/**`
edits legal (the same reason LOGI-0015 could touch `tools/tracker/**`). See open question O4.

### 7.5 Planned exit gates (arm `orchestrator`, all local, all CLI)

```text
1. node --check tools/tracker/core.mjs tools/tracker/index.mjs tools/tracker/plans.mjs   → exit 0
2. node tools/tracker/index.mjs status        → head still LOGI-0013; Held/held-count line present
3. node tools/tracker/index.mjs ready         → no `done` ticket; held rows excluded + reported
4. node tools/tracker/index.mjs ready --all   → every row accounted for (actionable | held | excluded)
5. node tools/tracker/index.mjs ready --stuck → clean (no orphan arms)
6. node tools/tracker/index.mjs deps --ticket LOGI-0007  → no deps; status done, source tracked
7. fixture suite (TRACKER_STATE_DIR=<tmp>)    → AC-2/3/4/6/7/8/9/10 asserted, exit 0
8. transitions: planned->blocked accepted · planned->done refused (exit 1) · blocked->planned accepted
9. node tools/tracker/index.mjs validate-plan state/plans/LOGI-0015-orchestrator.plan.md → ok
10. node tools/tracker/index.mjs resume-check --ticket LOGI-0013 --arm orchestrator → outside_manifest=0
11. git status --short                        → only §2 manifest files; no src/** contracts/** tests/**
12. tracker seal --ticket LOGI-0016 --arm orchestrator ...  → journal sealed, STEP_DONE recorded
```

### 7.6 Effort, sequencing & promotion procedure

**Effort:** one arm, 3 milestones, ~300–350 changed lines in `tools/**` + ~110 doc/skill lines;
comparable to LOGI-0015, roughly one focused session. No `src/**` or e2e involvement, so it can run
even while the product queue is paused (e.g. waiting on LOGI-0013).

**Recommended sequencing:** promote **before dispatching `LOGI-0010`** — that is the first true
cross-ticket dependency in the roadmap (a route must exist before assignment). Natural slots: right
after the LOGI-0013 disposition, or between LOGI-0008 and LOGI-0009. Dependencies become
load-bearing at LOGI-0009→0010 and again for LOGI-0011/0012.

**Promotion procedure (does not touch state until explicitly run):**

```bash
# 1. create the plan shell (writes PLAN_CREATED — this is the promotion moment)
node tools/tracker/index.mjs plan new --ticket LOGI-0016 --arm orchestrator \
  --objective "Dependency graph + blocking: ticket-level deps visible to the dispatch queue, \
planned->blocked parking, verified manual release, cycle/stale detection."

# 2. transcribe §10 of this document into state/plans/LOGI-0016-orchestrator.plan.md
#    (front matter depends_on_plans: LOGI-0015-orchestrator; §4 = the 3 milestones)

# 3. validate → lock → claim (orchestrator locks after review, per orchestrate-dispatch step 4)
node tools/tracker/index.mjs validate-plan state/plans/LOGI-0016-orchestrator.plan.md
node tools/tracker/index.mjs plan lock --ticket LOGI-0016 --arm orchestrator
node tools/tracker/index.mjs claim --ticket LOGI-0016 --arm orchestrator --agent main-orchestrator
```

After promotion, `tracker ready` will legitimately list LOGI-0016 as an actionable tracked ticket —
that is the intended signal (the phantom-ticket objection in §0 applies only to a *pre-created*
draft plan with no intent to execute).

---

## 8. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Queue regression** — LOGI-0015's truthfulness fix is the newest load-bearing behavior | Gates §7.5 items 2–5 + fixture (d) legacy replay; held classification is *additive* to `dispatchable` |
| R2 | **Over-blocking** — hard deps could stall a ticket that is actually buildable | Default stays advisory (warnings + `held` visibility); `--strict-deps` is opt-in; `--force` remains for emergencies |
| R3 | **Ambiguous truth** across four declaration sources | Precedence table (§6.1) + a `source` field on every rendered status; runtime `blockedBy` wins |
| R4 | **Stale roadmap cells** (LOGI-0004..0007 say "Not Started" while their arms are `done`) feeding false holds | Event-log-first rule (AC-3) + fallback explicitly labelled `source: roadmap` |
| R5 | **Truth drift** — `state/tasks.json` is a write-only dump rewritten by any tracker run (timestamp-only diff) | Dependencies are never written there; `events.jsonl` stays sole truth; revert the dump (`git checkout -- state/tasks.json`) unless committing it deliberately |
| R6 | **Testing corrupts real state** — `block`/`unblock` write into `state/` | `TRACKER_STATE_DIR` override (M1) + scratch ticket ids; negative fixtures never run against the repo's real `state/` |
| R7 | **Stale worktree copy** — `.kilo/worktrees/lime-spirit/tools/tracker/core.mjs` still holds pre-fix code | Run every gate from the repo root; treat worktrees as read-only history |
| R8 | **Scope creep** into scheduling/parallelism | Explicit non-goals (§6.9); the parallelism contract is unchanged (`orchestrate-dispatch/SKILL.md:17`) |

---

## 9. Open questions (human decisions before locking the plan)

| # | Question | Recommendation |
|---|---|---|
| **O1** | Roadmap `Depends on` column or spec `depends_on:` as the authoritative ticket-level source? | Roadmap column for execution order (the queue already reads that file); spec field kept in sync for humans; merge both, roadmap wins ties |
| **O2** | Should `depends_on_plans` ever block by default, or only via `--strict-deps`? | Opt-in only — default warnings preserve declared-parallel work (`LOGI-0004-frontend`/`backend` style) |
| **O3** | Auto-unblock when all deps turn `done`, or manual `unblock`? | Manual. AC-7 surfaces the candidate; auto-release would dispatch work without human intent and breaks the human-gated pattern (`03-spec-driven-workflow.md:54-62`) |
| **O4** | Keep using arm `orchestrator` (whose `deny: []` permits `tools/**`), or add a dedicated `tooling` arm with explicit globs (`tools/**`, `.clineskills/**`, `Docs/**`, `state/**`) and `deny: ['src/**','contracts/**','tests/**']`? | Add the `tooling` arm — one `ARM_BOUNDARIES` entry buys proof that tracker work cannot touch product code |
| **O5** | Should `depends_on` be mandatory for new specs? | Optional but recommended; only LOGI-0009+ have real cross-ticket deps, so forcing it adds noise to already-done specs |

---

## 10. Pre-drafted arm plan (transcribe at promotion time)

This is the **exact content** to place in `state/plans/LOGI-0016-orchestrator.plan.md` after
`tracker plan new` (the tool creates the front matter + headings; paste §1–§6 bodies). Headings must
keep the template form (`## 2.`/`## 3.`/`## 4. Steps`/`## 6. Exit gates`) — the parser depends on it.

```markdown
---
ticket: LOGI-0016
arm: orchestrator
status: draft
created: <set by plan new>
depends_on_plans: LOGI-0015-orchestrator
---

## 1. Objective
Make ticket-level dependencies first-class in the tracker: the dispatch queue must never propose a
ticket whose prerequisites are not `done` (event-log truth), an unstarted dependent ticket must be
parkable (`planned->blocked`, no plan file, no `--force`), and release must be explicit and verified.
No dependency data outside `state/events.jsonl` + `state/handoffs.jsonl`.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tools/tracker/core.mjs` | modify | edges/held/cycles + `planned->blocked`,`blocked->planned` + queue + `TRACKER_STATE_DIR` | ~140 |
| `tools/tracker/index.mjs` | modify | `deps`,`block`,`unblock`,`ready --held`,`plan lock --strict-deps`, status lines | ~110 |
| `tools/tracker/plans.mjs` | modify | strict-deps errors, plan-cycle warning, §3-consumption advisory | ~45 |
| `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` | modify | state machine + queue + command table | ~30 |
| `Docs/ProjectTechGuidence/03-spec-driven-workflow.md` | modify | Dependencies & blocking section | ~35 |
| `Docs/PROJECT_STATUS.md` | modify | `Depends on` column + backfill (replaces the prose sentence) | ~20 |
| `Docs/OPTIMIZATION_TASKS.md` | modify | Phase 6 tick-through | ~10 |
| `Docs/planned-features/LOGI-0016-dependency-graph-and-blocking.md` | modify | mark promoted | ~5 |
| `.clineskills/plan-arm/SKILL.md` | modify | §3-consumption rule for consumed upstream artifacts | ~8 |
| `.clineskills/orchestrate-dispatch/SKILL.md` | modify | read `Held` line; act on `UNBLOCK_CANDIDATE` | ~8 |
| `state/plans/LOGI-0016-orchestrator.plan.md`, `state/events.jsonl`, `state/handoffs.jsonl` | modify | plan + evidence (CLI-only writes) | — |
| `memory/journal/LOGI-0016.md`, `memory/active.md`, `memory/progress.md` | modify | seal + handoff (CLI-only writes) | — |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `tools/tracker/core.mjs` | 1-260 | transitions, `handoffState`, `roadmapBacklog`, `readyQueue`, snapshot |
| `tools/tracker/index.mjs` | 200-260 | handoff + plan lock semantics to extend |
| `tools/tracker/plans.mjs` | 100-142 | `validatePlan` dependency warnings to harden |
| `Docs/PROJECT_STATUS.md` | 40-60 | roadmap table + dependencies prose to convert |
| `state/events.jsonl` | tail | legacy handoff/state shapes for backward compatibility |

## 4. Steps (Vertical Slice Milestones — each with verify gate)
- [ ] 1. Dependency model: `TRACKER_STATE_DIR`, transitions (`planned->blocked`, `blocked->planned`), `dependencyEdges`/`blockerStatus`/`dependencyHeld`/`findCycles`, roadmap column parse, `readyQueue` held classification → verify: `node --check` + fixture suite (unmet dep held · met dep dispatchable · A↔B cycle reported · legacy replay unchanged)
- [ ] 2. CLI + surfacing + validators: `deps`/`block`/`unblock`/`ready --held`/`status` Held & UNBLOCK_CANDIDATE & STALE_DEP & DEP_CYCLE/`plan lock --strict-deps`; docs, skills and roadmap `Depends on` backfill → verify: transition accept/refuse matrix + block→unblock round trip in a temp state dir + existing plans still lock
- [ ] 3. Arm verification & handoff: full CLI regression sweep on real state, `git status --short` limited to §2, seal journal, one atomic commit → verify: all §7.5 gates exit 0 and the LOGI-0015 non-regression contract holds

## 5. Risks / open questions
- Queue regression risk (mitigate: additive held classification + legacy replay fixture).
- Over-blocking (mitigate: advisory default, `--strict-deps` opt-in, `--force` escape).
- O1–O5 from the planning doc (roadmap vs spec source, strictness, auto-unblock, tooling arm, mandatory `depends_on`).
- Never write dependency data into `state/tasks.json` (write-only dump).

## 6. Exit gates
- `node --check tools/tracker/core.mjs tools/tracker/index.mjs tools/tracker/plans.mjs` → exit 0
- `tracker status` head still LOGI-0013; held rows visible with blocker + source
- `tracker ready` contains no `done` ticket and no unmet-dependency ticket
- `planned->blocked` accepted; `planned->done` refused (exit 1); `blocked->planned` accepted
- fixture suite green via `TRACKER_STATE_DIR`; real `state/` untouched by negative tests
- `git status --short` shows only §2 manifest paths (no `src/**`, `contracts/**`, `tests/**`)
- journal sealed (`tracker seal`) + `HANDOFF orchestrator→done` recorded as `in_progress->done`
```

---

## 11. Evidence appendix (as inspected 2026-09-26, tip `6ed7c81`)

### 11.1 Commands used to reach the conclusions in §2/§3

```text
node tools/tracker/index.mjs status
  → Dispatch Q: LOGI-0013 (in_progress, next orchestrator, source tracked)
  → Queue Detail: 6 actionable (tracked-in-flight 1, roadmap-backlog 5)

node tools/tracker/index.mjs plan-slice --ticket LOGI-0015 --arm orchestrator
  → status done; 3/3 steps; exit gates = CLI assertions (the gate style reused in §7.5)

node tools/tracker/index.mjs journal-tail --ticket LOGI-0015 --lines 12
  → "LOGI-0007-F2 (CI concurrent-create 500) stays open as a backend/CI follow-up"
  → "PROJECT_STATUS.md rows for LOGI-0004..0007 still say Not Started (stale but harmless...)"

grep -rn 'depends_on_plans' --include=*.md --include=*.mjs .
  → state/plans/LOGI-0003..0007-*.plan.md all declare it (e.g. LOGI-0004-qa: 3 upstream arms)

grep -rn 'depends_on' Docs/ProjectTechGuidence/03-spec-driven-workflow.md specs/features/*.md
  → 03-...:16 template `depends_on: []`; specs/features/LOGI-0000..0007:7 `depends_on:` all empty

grep -rn 'class Route|Route(' src/backend --include=*.cs      → no matches
grep -n '/routes' contracts/v1-openapi.yaml                  → no matches
  → LOGI-0010 (assign shipment→route) has no upstream artifact to consume yet

git status --short (after tracker runs)
  → "M state/tasks.json" with a timestamp-only diff: confirms tasks.json is rewritten noise (F5/R5)
```

### 11.2 File:line index for the claims in this document

| Claim | Location |
|---|---|
| Path constants; only `TRACKER_ROADMAP` is overridable | `tools/tracker/core.mjs:8-20` |
| `LEGAL_TRANSITIONS` (no `planned->blocked`) | `tools/tracker/core.mjs:23-26` |
| Non-destructive state derivation from handoffs | `tools/tracker/core.mjs:30-37` |
| `ARM_BOUNDARIES`, incl. `orchestrator` with empty `deny` | `tools/tracker/core.mjs:39-46` |
| Roadmap parsed from markdown | `tools/tracker/core.mjs:169-185` |
| `readyQueue` + `dispatchable` rule | `tools/tracker/core.mjs:202-235` |
| Plan template with `depends_on_plans:` | `tools/tracker/index.mjs:13-48` |
| `handoff` writes `toState`, enforces transitions | `tools/tracker/index.mjs:204-216` |
| `plan lock` fails on errors only (warnings pass) | `tools/tracker/index.mjs:237-246` |
| §3 required-file existence = hard gate | `tools/tracker/plans.mjs:112-125` |
| `depends_on_plans` = warnings only | `tools/tracker/plans.mjs:131-140` |
| Escalation contract | `Docs/ProjectTechGuidence/03-spec-driven-workflow.md:54-62` |
| Dependency prose sentence + stale status cells | `Docs/PROJECT_STATUS.md` §2 (roadmap table) |
| Parallel dispatch point (`CONTRACT_APPROVED`) | `.clineskills/orchestrate-dispatch/SKILL.md:17` |

### 11.3 Proposed roadmap `Depends on` backfill (LOGI-0004..0012)

| Ticket | Proposed `Depends on` | Rationale |
|---|---|---|
| LOGI-0004 | LOGI-0003 | auth/RBAC before domain endpoints; CRUD pattern from LOGI-0001 |
| LOGI-0005 | LOGI-0003, LOGI-0004 | driver `user_id` needs Identity users; mirrors vehicle entity |
| LOGI-0006 | LOGI-0002, LOGI-0003 | BR-7 transitions defined in the SLA/rules reference |
| LOGI-0007 | LOGI-0002, LOGI-0006 | BR-1/BR-2 due calculation on a shipment created via the lifecycle |
| LOGI-0008 | LOGI-0006, LOGI-0007 | edit/cancel act on lifecycle states of an existing shipment |
| LOGI-0009 | LOGI-0004, LOGI-0005 | a route assigns a vehicle **and** a driver |
| LOGI-0010 | LOGI-0007, LOGI-0009 | BR-5 capacity check needs shipments + routes |
| LOGI-0011 | LOGI-0007, LOGI-0010, LOGI-0013 | board lists/kanban needs assignment + a trustworthy e2e job |
| LOGI-0012 | LOGI-0010, LOGI-0011 | counts/SLA-risk/utilization aggregate the board data |

(The existing prose line "LOGI-0001 → LOGI-0003" is already satisfied: both are `done`.)

---

## 12. Document status & maintenance

| Field | Value |
|---|---|
| Author | main orchestrator session (post-LOGI-0015, `6ed7c81`) |
| Status | **PROPOSED** — awaiting human decision on O1–O5, then promotion (§7.6) |
| Tracker impact | none (no events, no plan file, no roadmap row) |
| Supersedes | the ad-hoc answer given in the LOGI-0015 session; this file is now the reference |
| On promotion | set Status = `PROMOTED as LOGI-0016` with the plan path + date, keep the analysis as the design record |
| On completion | set Status = `DONE` with the commit hash and the verified gate list |
| Review trigger | re-check §2/§3 if `core.mjs` changes again (line numbers drift) |

