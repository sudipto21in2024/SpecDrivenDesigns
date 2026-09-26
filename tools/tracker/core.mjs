// Tracker core: state store for agent execution (events, tasks snapshot, handoffs, plans).
// Zero dependencies. Node >= 18. All paths resolved relative to repo root (parent of tools/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATE_DIR = path.join(ROOT, 'state');
export const EVENTS_FILE = path.join(STATE_DIR, 'events.jsonl');
export const HANDOFFS_FILE = path.join(STATE_DIR, 'handoffs.jsonl');
export const TASKS_FILE = path.join(STATE_DIR, 'tasks.json');
export const PLANS_DIR = path.join(STATE_DIR, 'plans');
export const MEMORY_DIR = path.join(ROOT, 'memory');
export const JOURNAL_DIR = path.join(MEMORY_DIR, 'journal');
export const SPECS_DIR = path.join(ROOT, 'specs', 'features');

// Ordered ticket roadmap (backlog source for the dispatch queue). Override with TRACKER_ROADMAP.
export const ROADMAP_FILE = process.env.TRACKER_ROADMAP
  ? path.resolve(ROOT, process.env.TRACKER_ROADMAP)
  : path.join(ROOT, 'Docs', 'PROJECT_STATUS.md');

// Legal state-machine transitions (subset relevant to arms; from 03-spec-driven-workflow.md).
export const LEGAL_TRANSITIONS = new Set([
  'planned->in_progress', 'in_progress->done', 'in_progress->blocked',
  'blocked->in_progress', 'done->in_progress', // reopen for bugfix routing
]);

// Destination state of a handoff. `to` names the receiving arm, or 'done' / 'blocked'.
// An explicit `toState` (foreign/older events) always wins.
export function handoffState(ev) {
  if (ev?.toState) return ev.toState;
  const to = String(ev?.to ?? '').trim().toLowerCase();
  if (!to) return null;
  if (to === 'done' || to === 'complete' || to === 'completed') return 'done';
  if (to === 'blocked') return 'blocked';
  return 'in_progress';
}

export const ARM_BOUNDARIES = {
  backend: { write: ['src/backend/**'], deny: ['src/frontend/**', 'contracts/**', 'tests/e2e/**'] },
  frontend: { write: ['src/frontend/**'], deny: ['src/backend/**', 'contracts/**'] },
  qa: { write: ['tests/e2e/**'], deny: ['src/**', 'contracts/**'] },
  docs: { write: ['Docs/**', 'specs/**'], deny: ['src/**', 'tests/**'] },
  architect: { write: ['contracts/**', 'Docs/adr/**', 'specs/**'], deny: ['src/**', 'tests/**'] },
  orchestrator: { write: ['memory/**', 'state/**'], deny: [] },
};

function ensureDirs() {
  for (const d of [STATE_DIR, PLANS_DIR, JOURNAL_DIR]) fs.mkdirSync(d, { recursive: true });
}

export function readEvents() {
  ensureDirs();
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function appendEvent(ev) {
  ensureDirs();
  const event = { ts: new Date().toISOString(), ...ev };
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
  rebuildSnapshot();
  return event;
}

export function readHandoffs() {
  ensureDirs();
  if (!fs.existsSync(HANDOFFS_FILE)) return [];
  return fs.readFileSync(HANDOFFS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- Mechanical bookkeeping (LOGI-0014): AI passes small args, Node renders. ---
// Char budgets keep journals/memory bounded; LF-only writes (no CRLF fixups).

export const SEAL_BUDGETS = { what: 600, gates: 400, findings: 400, next: 300 };

export function cap(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…[truncated]' : s;
}

export function journalFile(ticket) {
  return path.join(JOURNAL_DIR, `${ticket}.md`);
}

export function sealSection({ ticket, arm, what, gates, findings, next, agent }) {
  ensureDirs();
  const file = journalFile(ticket);
  const date = new Date().toISOString().slice(0, 10);
  const section = `\n## ${arm}-arm (${date} by ${agent ?? 'agent'})\n- **What:** ${cap(what, SEAL_BUDGETS.what)}\n- **Gates:** ${cap(gates, SEAL_BUDGETS.gates)}\n- **Findings:** ${cap(findings, SEAL_BUDGETS.findings)}\n- **Next:** ${cap(next, SEAL_BUDGETS.next)}\n`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# Journal — ${ticket}\n\nAppend-only. Newest entries at the bottom. Sections per arm.\n${section}`);
  } else {
    fs.appendFileSync(file, section);
  }
  return file;
}

export function journalTail(ticket, lines = 30) {
  const file = journalFile(ticket);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').slice(-lines);
}

export function tailEvents(ticket, last = 10) {
  return readEvents().filter((e) => !ticket || e.ticket === ticket).slice(-last);
}

export function showTicket(ticket) {
  const tasks = rebuildSnapshot();
  const t = tasks[ticket];
  if (!t) return null;
  const arms = {};
  for (const [name, a] of Object.entries(t.arms)) {
    arms[name] = { status: a.status, lastStep: a.lastStep ?? null, plan: a.plan ?? null };
  }
  return { ticket: t.ticket, status: t.status, next: t.next ?? null, arms };
}

export function appendHandoff(h) {
  ensureDirs();
  const record = { ts: new Date().toISOString(), ...h };
  fs.appendFileSync(HANDOFFS_FILE, JSON.stringify(record) + '\n');
  return record;
}

// Rebuild tasks.json snapshot from the event log (derived view; events are truth).
export function rebuildSnapshot() {
  const tasks = {};
  for (const ev of readEvents()) {
    if (!ev.ticket) continue;
    const t = (tasks[ev.ticket] ??= { ticket: ev.ticket, arms: {}, status: 'planned' });
    if (ev.type === 'TASK_STARTED') {
      t.arms[ev.arm] = { status: 'in_progress', agent: ev.agent ?? null, started: ev.ts };
      t.status = 'in_progress'; // also covers reopen (done->in_progress) for bugfix routing
    } else if (ev.type === 'HANDOFF') {
      // Derive the ticket state from the handoff DESTINATION — never assume it stays 'planned'.
      const toState = handoffState(ev) ?? t.status;
      t.status = toState;
      if (t.arms[ev.from]) t.arms[ev.from].status = 'done';
      // A completed ticket holds no open arm; otherwise a half-closed parallel arm would keep
      // the ticket "in progress" and resurface it as a phantom orphan in `ready --stuck`.
      if (toState === 'done') {
        for (const a of Object.values(t.arms)) if (a.status === 'in_progress') a.status = 'done';
      }
      t.next = ev.to ?? null;
    } else if (ev.type === 'STEP_DONE' && ev.arm && t.arms[ev.arm]) {
      t.arms[ev.arm].lastStep = ev.note ?? 'step';
      t.arms[ev.arm].lastStepAt = ev.ts;
    } else if (ev.type === 'PLAN_LOCKED' && ev.arm) {
      t.arms[ev.arm] ??= { status: 'planned' };
      t.arms[ev.arm].plan = ev.plan_ptr;
      t.arms[ev.arm].planStatus = 'locked';
    }
  }
  ensureDirs();
  fs.writeFileSync(TASKS_FILE, JSON.stringify({ generated: new Date().toISOString(), tasks }, null, 2));
  return tasks;
}

function byTicketId(a, b) {
  return a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0;
}

// Roadmap backlog: ordered ticket rows from `Docs/PROJECT_STATUS.md` §2 that have never been
// tracked. Rows the roadmap marks as complete are skipped, so pre-tracker tickets
// (LOGI-0000/0001, no events) are never re-proposed. Tolerant: a missing or unparsable
// roadmap yields an empty backlog instead of throwing.
export function roadmapBacklog(file = ROADMAP_FILE) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const seen = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\s*\**\s*(LOGI-\d{4})\s*\**\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (!m) continue;
    const [, ticket, title, rawStatus] = m;
    if (seen.has(ticket)) continue;
    seen.add(ticket);
    const finished = /done|complete/i.test(rawStatus) || rawStatus.includes('\u2705') || rawStatus.includes('\u{1F7E2}');
    if (finished) continue;
    rows.push({ ticket, title: title.replace(/\s+/g, ' ').trim(), roadmapStatus: rawStatus.replace(/\s+/g, ' ').trim() });
  }
  return rows.sort(byTicketId);
}

export function currentTask() {
  const tasks = rebuildSnapshot();
  const active = Object.values(tasks).filter((t) =>
    Object.values(t.arms).some((a) => a.status === 'in_progress'));
  return active;
}

// Dispatch queue — the orchestrator's only source of "what next".
//   * a ticket is actionable when it is NOT complete and no arm is currently holding it;
//   * completed tickets (status 'done') are NEVER re-dispatched: equating "no open arm" with
//     "ready" is what kept re-proposing finished work (LOGI-0002..0007, LOGI-0014) while the
//     real next ticket stayed invisible;
//   * blocked tickets are human-gated and stay out of the queue;
//   * ordered roadmap tickets that never reached the event log are appended, so the queue can
//     name the true next ticket (LOGI-0008) the moment one is finished;
//   * `all` adds the non-actionable tickets back, flagged `dispatchable: false`, for audits.
export function readyQueue({ stuckOnly = false, all = false, staleMinutes = Number(process.env.TRACKER_STALE_MINUTES ?? 60) } = {}) {
  const tasks = rebuildSnapshot();
  const tracked = Object.values(tasks).sort(byTicketId);
  const now = Date.now();
  const result = [];

  if (stuckOnly) {
    // Orphan signal: an arm claims to be in progress but nothing has happened for
    // `staleMinutes` — the agent that claimed it is presumed dead (no handoff recorded).
    for (const t of tracked) {
      if (t.status === 'done') continue;
      const armName = Object.keys(t.arms).find((k) => t.arms[k].status === 'in_progress');
      if (!armName) continue;
      const openArm = t.arms[armName];
      const lastActivity = Date.parse(openArm.lastStepAt ?? openArm.started ?? 0);
      if (now - lastActivity <= staleMinutes * 60_000) continue;
      result.push({ ticket: t.ticket, orphaned: true, arm: armName,
        lastActivity: new Date(lastActivity).toISOString(), note: 'stale in-progress arm — dispatch continuation child (verify-then-fix)' });
    }
    return result;
  }

  const started = new Set(tracked.map((t) => t.ticket));
  for (const t of tracked) {
    const holdingArm = Object.values(t.arms).some((a) => a.status === 'in_progress');
    const dispatchable = t.status !== 'done' && t.status !== 'blocked' && !holdingArm;
    if (!dispatchable && !all) continue;
    result.push({ ticket: t.ticket, status: t.status, next: t.next ?? null, source: 'tracked', dispatchable });
  }
  for (const b of roadmapBacklog()) {
    if (started.has(b.ticket)) continue; // already tracked — the event log is authoritative
    result.push({ ticket: b.ticket, status: 'planned', next: null, title: b.title, source: 'roadmap', dispatchable: true });
  }
  return result;
}


export function getActiveContext() {
  const tasks = rebuildSnapshot();
  const activeArms = [];
  for (const [ticket, t] of Object.entries(tasks)) {
    for (const [arm, a] of Object.entries(t.arms)) {
      if (a.status === 'in_progress') {
        activeArms.push({ ticket, arm, ...a });
      }
    }
  }

  const git = { branch: 'unknown', clean: true, changes: [] };
  try {
    const branchRes = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    git.branch = branchRes.replace(/^ref: refs\/heads\//, '');
  } catch {}

  return { activeArms, queue: readyQueue(), git };
}

