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

// Legal state-machine transitions (subset relevant to arms; from 03-spec-driven-workflow.md).
export const LEGAL_TRANSITIONS = new Set([
  'planned->in_progress', 'in_progress->done', 'in_progress->blocked',
  'blocked->in_progress', 'done->in_progress', // reopen for bugfix routing
]);

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
    } else if (ev.type === 'HANDOFF') {
      t.status = ev.toState ?? t.status;
      if (t.arms[ev.from]) t.arms[ev.from].status = 'done';
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

export function currentTask() {
  const tasks = rebuildSnapshot();
  const active = Object.values(tasks).filter((t) =>
    Object.values(t.arms).some((a) => a.status === 'in_progress'));
  return active;
}

export function readyQueue({ stuckOnly = false, staleMinutes = Number(process.env.TRACKER_STALE_MINUTES ?? 60) } = {}) {
  const events = readEvents();
  const handoffTickets = new Set(events.filter((e) => e.type === 'HANDOFF').map((e) => e.ticket));
  const tasks = rebuildSnapshot();
  const now = Date.now();
  const result = [];
  for (const t of Object.values(tasks)) {
    const openArm = Object.values(t.arms).find((a) => a.status === 'in_progress');
    if (stuckOnly) {
      // Orphan signal: an arm claims to be in progress but nothing has happened for
      // `staleMinutes` — the agent that claimed it is presumed dead (no handoff recorded).
      if (!openArm) continue;
      const lastActivity = Date.parse(openArm.lastStepAt ?? openArm.started ?? 0);
      const stale = now - lastActivity > staleMinutes * 60_000;
      if (!stale) continue;
      result.push({ ticket: t.ticket, orphaned: true, arm: Object.keys(t.arms).find((k) => t.arms[k] === openArm),
        lastActivity: new Date(lastActivity).toISOString(), note: 'stale in-progress arm — dispatch continuation child (verify-then-fix)' });
    } else {
      // Dispatch queue: tickets with no active arm are available for planning/dispatch.
      if (openArm) continue;
      result.push({ ticket: t.ticket, status: t.status, next: t.next ?? null });
    }
  }
  return result;
}

