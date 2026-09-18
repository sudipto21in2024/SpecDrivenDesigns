# ADR-006: Spec Kit usage scope

- **Status:** Accepted
- **Deciders:** Orchestrator (inline) + you
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
`github/spec-kit` (GitHub's SDD toolkit) was proposed for this project. It provides a generic
spec-driven process (specify → plan → tasks → implement → converge) plus `bug` and `assess`
extensions, writing artifacts into `.specify/`.

## Decision
We will treat the **LogiFlow spec pack** (`Docs/ProjectTechGuidence/01`–`13`) as the authoritative,
primary spec process — it is a stricter, OpenAPI-contract-first, 10-role variant of SDD. Spec Kit
is installed **only** for the two sub-processes the LogiFlow pack does not define:
- **bug-fixing** (`assess → fix → test`) for the `BUG_FOUND` loop (`03` §state machine), and
- **idea assessment** for vetting future feature ideas before they enter `/specs/backlog/`.
Spec Kit must **not** override `/specs/`, `/contracts/`, `/docs/adr/`, or bypass the OpenAPI
contract-first + CI gates. If Spec Kit's integration key is unsupported for Kilo Code, fall back to
the pack's existing `/specs/escalations/` and review patterns.

## Consequences
- Positive: gains structured bug-assessment + idea-shaping without weakening the stronger
  LogiFlow contract-first discipline.
- Risk: tool-surface token overhead; mitigated by limiting Spec Kit to bug/assess only (not every
  worker turn), mirroring `08` §trade-offs.
- Risk: Kilo Code is not a documented Spec Kit integration; verify before relying on `/speckit-*`
  invocation in an agent loop.

## Alternatives considered
- Adopt Spec Kit as the primary process: rejected — would bypass OpenAPI-first and the
  multi-agent handoff guarantees made non-negotiable in the BRD/PRD/HLD.

## References
- `Docs/ProjectTechGuidence/08-ticketing-jira-analysis.md` (tool-overhead discipline)
- `03-spec-driven-workflow.md` (BUG_FOUND routing)
- `09-sample-feature-spec.md` (feature spec template = the "spec kit" for features)
