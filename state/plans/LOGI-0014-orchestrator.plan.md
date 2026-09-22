---
ticket: LOGI-0014
arm: orchestrator
status: locked
created: 2026-09-22T04:55:43.038Z
depends_on_plans:
---

## 1. Objective
Cut token + wall-clock cost of the agent loop: mechanical tracker appends (seal/tick/show/history-tail/journal-tail/active/progress) + per-resource contract slicer + skill rules forbidding full-file re-reads. No product code touched.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tools/tracker/core.mjs` | modify | AC-1 seal/tick/active/progress helpers (LF-safe appends, budgets, template renders) | ~120 |
| `tools/tracker/index.mjs` | modify | AC-1 wire seal/tick/show/history-tail/journal-tail/active/progress subcommands | ~80 |
| `tools/contract/index.mjs` | create | AC-2 per-resource OpenAPI slicer (schemas + paths, fields filter) | ~70 |
| `.clineskills/execute-plan/SKILL.md` | modify | AC-3 forbid editor on memory/state; CLI-only bookkeeping; one log per verified step | ~15 |
| `.clineskills/plan-arm/SKILL.md` | modify | AC-3 §3 slice pointers (contract:X, journal-tail) instead of full paths | ~10 |
| `.clineskills/resume-or-recover/SKILL.md` | modify | AC-3 slice queries first, never full events.jsonl/journal reads | ~10 |
| `.clinerules/10-agent-context-protocol.md` | modify | AC-3 CLI-only bookkeeping + slice-first reads rule | ~5 |
| `memory/journal/LOGI-0014.md` | create | Seal record (gates, evidence, next) | ~30 |
| `memory/active.md` | modify | Session position + next action (via new active command) | ~10 |
| `memory/progress.md` | modify | LOGI-0014 row (via new progress command) | ~3 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `tools/tracker/core.mjs` | full | appendEvent/readEvents/readHandoffs helpers + ROOT/STATE/JOURNAL consts to extend |
| `tools/tracker/index.mjs` | full | cmds dispatch table + parseArgs idiom to extend |
| `tools/tracker/plans.mjs` | 6-20 | planPath/parseFrontMatter for tick (checkbox flip) |
| `contracts/v1-openapi.yaml` | slice drivers 155-193, 459-568 | Validate slicer output matches these ranges (spot check, not full read) |

## 4. Steps (each with verify gate)
- [ ] 1. Extend `tools/tracker/core.mjs`: sealSection/journalTail/renderActive/renderProgress/tickPlan helpers (char budgets 500/300/300, LF-only, append-only journals) → verify: `node -e "import('./tools/tracker/core.mjs').then(m=>console.log(Object.keys(m).join(',')))"` lists new exports.
- [ ] 2. Wire `tools/tracker/index.mjs`: seal/tick/show/history-tail/journal-tail/active/progress subcommands → verify: `node tools/tracker/index.mjs` help lists them; `show --ticket LOGI-0005`, `history --ticket LOGI-0005 --last 3`, `journal-tail --ticket LOGI-0005 --lines 5` return slices.
- [ ] 3. Create `tools/contract/index.mjs`: show --resource <name> [--fields x-roles,params,responses,schemas] → verify: `node tools/contract/index.mjs show --resource drivers` ≈ DriverRequest/DriverResponse + /drivers paths (~150 lines); `--fields x-roles` ≈ 30 lines; no full-file read path.
- [ ] 4. Update skills + protocol rule (execute-plan/plan-arm/resume-or-recover + 10-agent-context-protocol.md): CLI-only bookkeeping, slice-first reads, schema.d.ts never-read, contract slice pointers → verify: `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0014-orchestrator.plan.md` ok.
- [ ] 5. Self-host seal: use the new commands to seal LOGI-0014 (journal + tick + active + progress), lock/close plan → verify: journal section exists, plan status done, `history --ticket LOGI-0014` shows seal trail.

## 5. Risks / open questions
- Char-budget truncation could cut a gate string — budgets sized 500/300/300 with explicit overflow marker; verify shows full gates in smoke test.
- Checkbox tick regex must match `- [ ] N.` shape only — anchored regex, dry-run on a scratch copy first.
- No product-code risk: tools/memory/skills only; orchestrator boundary allows memory/** + state/**.

## 6. Exit gates
- `node tools/tracker/index.mjs seal --help`-style invocation seals a scratch ticket journal without editor.
- `node tools/contract/index.mjs show --resource drivers` returns ~150 lines (not 650).
- No `editor` writes to memory/* in this arm after step 4 (CLI only) — except this plan file itself.
- `tracker history --ticket LOGI-0014` shows the seal trail; journal records gates + next.

