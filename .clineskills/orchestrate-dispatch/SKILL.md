---
name: orchestrate-dispatch
description: Orchestrator loop for the main thread — determine the next arm from the tracker, dispatch planner/executor child tasks via new_task, lock validated plans, confirm handoffs, and keep memory/active.md current. The main thread must never edit source code. Trigger: continuing project work, dispatching next task.
---

# Orchestrate Dispatch

You are the orchestrator. You dispatch; you never implement.

## Loop
1. **Position:** `node tools/tracker/index.mjs current` + `ready` (+ `ready --stuck` for orphans) + read `memory/active.md`.
2. **Recovery check:** if an arm is `in_progress` with no handoff, use skill `resume-or-recover` instead of dispatching fresh.
3. **Dispatch planner:** `new_task` with: "You are the planner for <TICKET> arm <A>. Use skill plan-arm. Ticket: specs/features/<file>. Journal: memory/journal/<T>.md. Write plan to state/plans/… and validate. Do not edit source."
4. **Lock:** planner done → run `validate-plan` yourself → `tracker plan lock`. On failure, red dispatch (max 2 rounds) or escalate.
5. **Dispatch executor:** `new_task` with: "You are the executor for <TICKET> arm <A>. Use skill execute-plan. Your plan: <plan path>. Follow the 5-step handover."
   - At parallel-capable states (CONTRACT_APPROVED), dispatch backend/frontend/database executors as separate `new_task` children in one turn.
6. **Confirm:** after each child ends, verify a HANDOFF event exists (`tracker history --ticket T`). Missing handoff → orphan; re-dispatch as continuation, not fresh.
7. **Memory:** update `memory/active.md` (ticket, state, next action) before ending your turn.

## Escalate to human when
- Plan validation fails twice · gates fail after one fix round · ambiguity in spec ·
  contract/DB-breaking change · security-sensitive decision (per 03-spec-driven-workflow.md).
