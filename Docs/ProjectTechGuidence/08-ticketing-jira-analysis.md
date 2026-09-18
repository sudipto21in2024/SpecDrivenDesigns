# Ticketing System Analysis: Jira Free Tier + MCP

## Your concern

You're on Jira's free tier and worried the MCP connection itself costs extra money. Short
answer: **it doesn't — the MCP servers for Jira are free software; the cost, if any, is Jira
itself and the LLM/agent runtime tokens, not the MCP connection.** But there are real practical
limits worth knowing before you commit.

## What's actually free vs. paid

| Component | Cost |
|---|---|
| Atlassian's official Jira/Confluence remote MCP server | Free — it's a hosted endpoint (`mcp.atlassian.com`), no separate fee to use it |
| Community `sooperset/mcp-atlassian` server | Free, open source (MIT), self-hosted |
| Jira Cloud Free plan | Free for up to 10 users, includes REST API access (which is what any MCP server calls under the hood) |
| Token/compute cost of the agent calling MCP tools | Not free in the sense that every tool definition + tool call consumes tokens in your agent's context — this is the real "cost" people mean when they say MCP is "not free" |

So: **Jira's free tier does not block API/MCP access.** The free tier restricts things like
advanced permissions, automation rule quotas, some reporting, and user count (10 users) — not
the REST API that MCP relies on. If you were told MCP "isn't free" on the free tier, that's
likely conflating token overhead with monetary cost, or confusing it with Atlassian's paid
"Rovo" AI *features* (agents/chat inside Jira itself), which are a different, paid product from
the MCP *server* that lets external tools like Claude/Kilo Code talk to Jira.

## Real trade-offs to weigh

1. **Token overhead.** Both the official and community MCP servers expose a fairly large tool
   surface (dozens of tools) — every one of those tool definitions sits in your agent's context
   on every turn, which adds up quickly in a long autonomous run with 10 specialized agents each
   potentially calling Jira. This is a genuine cost, just not a Jira billing one.
2. **Cloud-only for the official server.** The official Atlassian server only supports Jira
   Cloud (OAuth 2.1). If you're on Jira Server/Data Center you'd need the community server
   instead.
3. **Ticket, not context.** MCP hands your agent the Jira issue fields — it does not include
   Slack threads, meeting notes, or tribal knowledge around the ticket, so your Spec Agent still
   needs the actual requirements written somewhere Jira can see (description/comments).
4. **Governance/audit.** Since MCP write actions are logged as whichever account authenticated,
   using a dedicated bot account (not your personal login) is worth doing if agents will create/
   transition issues autonomously.

## Recommendation for this project

Given you're building a **fully autonomous, spec-driven** pipeline and are cost/complexity
sensitive on the free tier, I'd recommend **not** wiring Jira into the agent loop for v1 at all,
and instead:

- Use **file-based tickets in the repo** (`/specs/*.md`, as defined in
  `03-spec-driven-workflow.md`) as the system of record for agent-to-agent handoff. This is:
  - Free forever, no API/token overhead, version-controlled alongside the code it produced,
    diffable, and trivially readable/writable by any agent without a tool-call round trip.
  - Exactly the pattern Kilo Code and similar tools expect for spec-driven multi-agent work.
- Keep **Jira as an optional, human-facing mirror**, not the machine's source of truth:
  - A lightweight sync script (or a single, narrow-scope agent) pushes ticket status from
    `/specs/*.md` front matter to Jira issues for stakeholder visibility, using either MCP or
    plain REST calls with a Jira API token (also free on the free tier).
  - This keeps the token-hungry, many-tool MCP surface out of the hot path of every worker
    agent, and only invoked occasionally by one integration point.

If later you outgrow file-based tickets (multiple human PMs, cross-team visibility, need Jira's
reporting), promoting Jira to the source of truth is a contained change: the Orchestrator Agent's
"where do I read/write ticket state" adapter is the only thing that needs to change, since every
other agent already just reads a ticket's front matter fields.

## If you do want to try Jira MCP now (free tier)

1. Confirm you're on **Jira Cloud** (free tier includes this) — use the official server:
   `https://mcp.atlassian.com/v1/mcp/authv2`, OAuth 2.1, add as a connector in your MCP-capable
   client.
2. Create a Jira **API token** (Free tier account → Atlassian account settings) if you'd rather
   use the community `sooperset/mcp-atlassian` server for more granular/local control.
3. Scope which agents get Jira tools at all — don't give every one of the 10 agents in
   `01-agent-architecture.md` Jira access; only the Orchestrator or a dedicated "Ticket Sync
   Agent" should.
4. Watch your context budget — measure token cost of the tool definitions before deciding it's
   worth it for every agent turn vs. only at sync points.

**Bottom line:** money isn't the blocker — Jira's free tier and both MCP servers are free to use.
The blocker, if any, is agent-context token overhead, which is better solved by keeping Jira out
of the inner loop and using it (if at all) as a human-facing mirror synced from the repo.
