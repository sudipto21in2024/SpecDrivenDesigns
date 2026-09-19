---
name: code-graph
description: Build, refresh, and query the graphify knowledge graph to resolve which specific files to read instead of reading whole codebases. Use before planning an arm or answering structural questions (what implements X, how does A reach B, explain entity Y). Trigger: which files, where is, how does X work.
---

# Code Graph

The graph (`graphify-out/`) maps the codebase so you read 2–5 files, not 50.

## Build / refresh
- If `graphify-out/graph.json` is missing or older than the last commit:
  `graphify extract ./src` (offline tree-sitter; no API key for code-only runs).
- After refactors: `graphify extract ./src --force`. Honors `.graphifyignore`
  (Migrations, node_modules, generated schema.d.ts).
- Commit `graphify-out/` so other agents reuse it.

## Query routing (always cheaper than reading source)
| Question | Command |
|---|---|
| What files implement / relate to X | `graphify query "X"` |
| How does A connect to B | `graphify path "A" "B"` |
| Explain entity/endpoint X | `graphify explain "X"` |
| Architecture-level (hotspots, cross-module links) | read `graphify-out/GRAPH_REPORT.md` |

## Hard rules
- Use the graph to produce a **file list**, then read those files with targeted line ranges.
- Never read whole modules to "get context" when a graph query answers it.
- During planning: diff graph output against your §2 manifest to catch missed callers (ripple check).
