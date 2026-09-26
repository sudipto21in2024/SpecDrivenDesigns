#!/usr/bin/env node
// tracker CLI — structured, deterministic state queries for the agent workflow.
// Usage: node tools/tracker/index.mjs <command> [args]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, STATE_DIR, PLANS_DIR, JOURNAL_DIR, MEMORY_DIR, appendEvent, readEvents, appendHandoff, currentTask, readyQueue, sealSection, journalTail, journalFile, tailEvents, showTicket, getActiveContext } from './core.mjs';
import { planPath, validatePlan, loadPlan, inManifest, slicePlan } from './plans.mjs';

const [cmd, ...rest] = process.argv.slice(2);

function writePlanTemplate({ ticket, arm, objective }) {
  const file = planPath(ticket, arm);
  if (fs.existsSync(file)) throw new Error(`plan already exists: ${file}`);
  const template = `---
ticket: ${ticket}
arm: ${arm}
status: draft
created: ${new Date().toISOString()}
depends_on_plans:
---

## 1. Objective
${objective ?? '<= 3 lines from ticket + current state'}

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| \`src/...\` | create/modify | AC-x | ~ |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| \`specs/features/${ticket}.md\` | full | ACs |

## 4. Steps (each with verify gate)
- [ ] 1. ... → verify: ...

## 5. Risks / open questions

## 6. Exit gates
`;
  fs.mkdirSync(PLANS_DIR, { recursive: true });
  fs.writeFileSync(file, template);
  appendEvent({ type: 'PLAN_CREATED', ticket, arm, plan_ptr: path.relative(ROOT, file) });
  return file;
}

function setPlanStatus(file, status) {
  if (!fs.existsSync(file)) throw new Error(`plan not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  if (!/^status: .*/m.test(text)) throw new Error('plan missing status field');
  fs.writeFileSync(file, text.replace(/^status: .*/m, `status: ${status}`));
}

function searchAll(query) {
  const q = query.toLowerCase();
  const hits = [];
  const scan = (file, kind) => {
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(q)) hits.push(`${kind}:${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  };
  scan(path.join(STATE_DIR, 'events.jsonl'), 'event');
  scan(path.join(STATE_DIR, 'handoffs.jsonl'), 'handoff');
  for (const d of [PLANS_DIR, JOURNAL_DIR]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) scan(path.join(d, f), d === PLANS_DIR ? 'plan' : 'journal');
  }
  return hits.slice(0, 50);
}

const cmds = {
  status() {
    // Single consolidated context query (< 15 lines). No direct file reads required.
    const ctx = getActiveContext();
    const gitRes = spawnSync('git', ['-C', ROOT, 'status', '--short'], { encoding: 'utf8' });
    const gitChanges = (gitRes.stdout || '').split('\n').filter(Boolean);
    const gitCommit = spawnSync('git', ['-C', ROOT, 'log', '-1', '--oneline'], { encoding: 'utf8' });
    const lastCommit = (gitCommit.stdout || '').trim();

    console.log('=== AGENT CONTEXT & STATE ===');
    console.log(`Working Tree: ${gitChanges.length === 0 ? 'CLEAN' : `${gitChanges.length} uncommitted file(s)`}`);
    console.log(`Tip Commit  : ${lastCommit || 'none'}`);

    if (ctx.activeArms.length > 0) {
      console.log('\n--- ACTIVE ARM ---');
      for (const a of ctx.activeArms) {
        console.log(`Ticket/Arm : ${a.ticket} / ${a.arm} (started: ${a.started})`);
        console.log(`Last Step  : ${a.lastStep ?? 'none'}`);
        try {
          const slice = slicePlan(a.ticket, a.arm);
          console.log(`Next Step  : ${slice.nextStep}`);
          console.log(`Touched (§2): ${slice.touchedFiles.slice(0, 5).join(', ')}${slice.touchedFiles.length > 5 ? ` (+${slice.touchedFiles.length - 5} more)` : ''}`);
        } catch {}
      }
    } else {
      console.log('Active Arm  : NONE (idle)');
      const nextTicket = ctx.queue[0];
      if (nextTicket) {
        console.log(`Dispatch Q  : Next ready ticket is ${nextTicket.ticket} (status: ${nextTicket.status}, next: ${nextTicket.next})`);
      } else {
        console.log('Dispatch Q  : Queue empty.');
      }
    }
    console.log('=============================');
  },
  'plan-slice'() {
    // Extract plan touched files manifest (§2), active step, and exit gates without reading whole plan
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, arm: { type: 'string' } } });
    if (!values.ticket || !values.arm) throw new Error('--ticket and --arm required');
    const slice = slicePlan(values.ticket, values.arm);
    console.log(JSON.stringify(slice, null, 2));
  },

  current() {
    const active = currentTask();
    console.log(active.length ? JSON.stringify(active, null, 2) : 'No in-progress arms. Run `tracker ready` for the dispatch queue.');
  },
  ready() {
    const queue = readyQueue({ stuckOnly: rest.includes('--stuck') });
    console.log(queue.length ? JSON.stringify(queue, null, 2) : (rest.includes('--stuck') ? 'No orphaned arms.' : 'Queue empty — all tracked tickets idle.'));
  },
  claim() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, arm: { type: 'string' }, agent: { type: 'string' } } });
    if (!values.ticket || !values.arm) throw new Error('--ticket and --arm required');
    console.log(JSON.stringify(appendEvent({ type: 'TASK_STARTED', ticket: values.ticket, arm: values.arm, agent: values.agent })));
  },
  log() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, type: { type: 'string' }, arm: { type: 'string' }, note: { type: 'string' } } });
    if (!values.ticket || !values.type) throw new Error('--ticket and --type required');
    console.log(JSON.stringify(appendEvent({ type: values.type, ticket: values.ticket, arm: values.arm, note: values.note })));
  },
  micro() {
    // Log a micro-action with full actionable context so a task can resume at the exact step.
    const { values } = parseArgs({ args: rest, options: {
      ticket: { type: 'string' }, arm: { type: 'string' }, action: { type: 'string' },
      files: { type: 'string' }, gate: { type: 'string' }, next: { type: 'string' }, detail: { type: 'string' },
    } });
    if (!values.ticket || !values.arm || !values.action) throw new Error('--ticket, --arm, --action required');
    if (values.gate && !['pass', 'fail', 'skip'].includes(values.gate)) throw new Error('--gate must be pass|fail|skip');
    const ev = { type: 'MICRO', ticket: values.ticket, arm: values.arm, action: values.action,
      files: values.files ? values.files.split(',').map((s) => s.trim()) : [],
      gate_result: values.gate ?? null, next_step: values.next ?? null, detail: values.detail ?? null };
    console.log(JSON.stringify(appendEvent(ev)));
  },
  'resume-check'() {
    // Validate code state BEFORE resuming an interrupted arm. Deterministic; never fixes anything.
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, arm: { type: 'string' }, 'run-gates': { type: 'boolean' } } });
    if (!values.ticket || !values.arm) throw new Error('--ticket and --arm required');
    const plan = loadPlan(values.ticket, values.arm);

    const git = spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
    if (git.status !== 0) throw new Error('git status failed: ' + git.stderr);
    const changes = git.stdout.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3).replace(/^"|"$/g, '') }));
    const inManifestChanges = changes.filter((c) => inManifest(c.file, plan.writeFiles));
    const outsideManifest = changes.filter((c) => !inManifest(c.file, plan.writeFiles));
    const deleted = inManifestChanges.filter((c) => c.status.includes('D'));

    // Reconcile event log vs working tree mtimes (tree newer ⇒ possibly died mid-step).
    const lastEv = readEvents().filter((e) => e.ticket === values.ticket && e.arm === values.arm).at(-1);
    let newest = null;
    for (const f of plan.writeFiles) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p)) { const m = fs.statSync(p).mtimeMs; if (!newest || m > newest.m) newest = { file: f, mtime: new Date(m).toISOString() }; }
    }
    const treeNewer = Boolean(lastEv && newest && newest.m > Date.parse(lastEv.ts));

    // Optionally re-run the verify-gate commands of the last completed step.
    const gates = [];
    if (values['run-gates']) {
      const ticked = [...plan.body.matchAll(/^- \[x\] .*$/gm)].map((m) => m[0]);
      const line = ticked.at(-1);
      if (line) {
        for (const m of line.matchAll(/`([^`]+)`/g)) {
          const r = spawnSync(m[1], { shell: true, cwd: ROOT, encoding: 'utf8', timeout: 600_000 });
          gates.push({ cmd: m[1], ok: r.status === 0, exit: r.status });
        }
      } else gates.push({ cmd: null, note: 'no completed step found to re-verify' });
    }

    const broken = deleted.length > 0 || gates.some((g) => g.cmd && !g.ok);
    const midStep = treeNewer || inManifestChanges.length > 0;
    const verdict = broken ? 'broken' : (midStep ? 'mid_step' : 'clean');
    const recommendation = broken
      ? 'DO NOT resume — reset the broken/deleted files (git checkout -- <file>) and re-execute the last step.'
      : midStep
        ? 'Run `resume-check --run-gates` / re-run the last step\'s verify gate before trusting progress; tick or redo the step.'
        : 'Clean — resume at the first unticked step (plan §4).';
    console.log(JSON.stringify({ ticket: values.ticket, arm: values.arm, plan: path.relative(ROOT, plan.file),
      verdict, recommendation, last_event: lastEv ? { type: lastEv.type, ts: lastEv.ts, note: lastEv.note ?? lastEv.action ?? null } : null,
      newest_manifest_mtime: newest, uncommitted_in_manifest: inManifestChanges,
      outside_manifest_changes: outsideManifest.slice(0, 30), outside_manifest_count: outsideManifest.length,
      deleted_manifest_files: deleted, gate_results: gates }, null, 2));
    if (verdict === 'broken') process.exit(1);
  },
  handoff() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, summary: { type: 'string' }, gates: { type: 'string' } } });
    if (!values.ticket || !values.from || !values.to) throw new Error('--ticket, --from, --to required');
    const rec = { type: 'HANDOFF', ticket: values.ticket, from: values.from, to: values.to, summary_ptr: values.summary, gates: values.gates ? values.gates.split(',') : [] };
    console.log(JSON.stringify(appendHandoff(rec)));
    appendEvent(rec);
  },
  plan() {
    const sub = rest[0];
    const opts = () => parseArgs({ args: rest.slice(1), options: { ticket: { type: 'string' }, arm: { type: 'string' }, objective: { type: 'string' }, status: { type: 'string' } } }).values;
    if (sub === 'new') {
      const v = opts();
      if (!v.ticket || !v.arm) throw new Error('--ticket and --arm required');
      console.log(writePlanTemplate(v));
    } else if (sub === 'get') {
      const v = opts();
      console.log(fs.readFileSync(planPath(v.ticket, v.arm), 'utf8'));
    } else if (sub === 'set-status') {
      const v = opts();
      if (!v.status) throw new Error('--status required (draft|validated|locked|in_progress|done|superseded)');
      const file = planPath(v.ticket, v.arm);
      setPlanStatus(file, v.status);
      appendEvent({ type: `PLAN_${v.status.toUpperCase()}`, ticket: v.ticket, arm: v.arm, plan_ptr: path.relative(ROOT, file) });
      console.log(`${file} → ${v.status}`);
    } else if (sub === 'lock') {
      const v = opts();
      if (!v.ticket || !v.arm) throw new Error('--ticket and --arm required');
      const file = planPath(v.ticket, v.arm);
      const res = validatePlan(file);
      if (!res.ok) { console.error('Cannot lock — validation failed:\n' + res.errors.join('\n')); process.exit(1); }
      setPlanStatus(file, 'locked');
      appendEvent({ type: 'PLAN_LOCKED', ticket: v.ticket, arm: v.arm, plan_ptr: path.relative(ROOT, file) });
      console.log(`LOCKED ${file}`);
    } else throw new Error('usage: tracker plan new|get|set-status|lock ...');
  },
  'validate-plan'() {
    const file = rest.find((a) => !a.startsWith('--'));
    const res = validatePlan(file, { resume: rest.includes('--resume') });
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
  },
  search() {
    const q = rest.join(' ');
    if (!q) throw new Error('query required');
    const hits = searchAll(q);
    console.log(hits.length ? hits.join('\n') : `No matches for "${q}".`);
  },
  history() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, last: { type: 'string' } } });
    const n = values.last ? Number(values.last) : 0;
    const events = n > 0 ? tailEvents(values.ticket, n) : readEvents().filter((e) => !values.ticket || e.ticket === values.ticket);
    console.log(events.map((e) => `${e.ts} ${e.type} ${e.ticket ?? ''} ${e.arm ?? ''} ${e.note ?? e.action ?? ''} ${e.plan_ptr ?? ''}`).join('\n') || 'No events.');
  },
  // --- LOGI-0014 slice + mechanical commands (slice-first reads, CLI-only writes) ---
  show() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' } } });
    if (!values.ticket) throw new Error('--ticket required');
    const t = showTicket(values.ticket);
    console.log(t ? JSON.stringify(t, null, 2) : `No record for ${values.ticket}.`);
  },
  'journal-tail'() {
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, lines: { type: 'string' } } });
    if (!values.ticket) throw new Error('--ticket required');
    console.log(journalTail(values.ticket, values.lines ? Number(values.lines) : 30).join('\n') || `No journal for ${values.ticket}.`);
  },
  seal() {
    // One call replaces: editor journal append + STEP_DONE + plan tick + tasks snapshot.
    const { values } = parseArgs({ args: rest, options: {
      ticket: { type: 'string' }, arm: { type: 'string' }, what: { type: 'string' },
      gates: { type: 'string' }, findings: { type: 'string' }, next: { type: 'string' }, agent: { type: 'string' },
    } });
    if (!values.ticket || !values.arm || !values.what) throw new Error('--ticket, --arm, --what required');
    const file = sealSection(values);
    const ev = appendEvent({ type: 'STEP_DONE', ticket: values.ticket, arm: values.arm, note: `sealed: ${values.gates ?? 'gates recorded in journal'}` });
    console.log(JSON.stringify({ journal: path.relative(ROOT, file), event: ev.ts }));
  },
  tick() {
    // Flip `- [ ] N.` → `- [x] N.` in place — no full plan rewrite.
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, arm: { type: 'string' }, step: { type: 'string' } } });
    if (!values.ticket || !values.arm || !values.step) throw new Error('--ticket, --arm, --step required');
    const file = planPath(values.ticket, values.arm);
    let text = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^(- \\[ \\] ${values.step}\\.? .*)`, 'm');
    if (!re.test(text)) throw new Error(`step ${values.step} not found as unchecked box in ${file}`);
    text = text.replace(re, (m) => m.replace('- [ ]', '- [x]'));
    fs.writeFileSync(file, text);
    console.log(`ticked step ${values.step} in ${path.relative(ROOT, file)}`);
  },
  active() {
    // Regenerate memory/active.md from template (capped) — no AI prose rewrite.
    const { values } = parseArgs({ args: rest, options: { done: { type: 'string' }, next: { type: 'string' } } });
    const active = currentTask();
    const git = spawnSync('git', ['-C', ROOT, 'log', '--oneline', '-5'], { encoding: 'utf8' });
    const out = `# Active Context — LogiFlow\n\n> Read this file first at every session start. Position: \`tracker current\` + this file.\n\n## Current work\n- **${new Date().toISOString().slice(0, 10)}: ${values.done ?? 'in progress'}**\n  - Active arms: ${active.length ? active.map((t) => `${t.ticket} (${Object.keys(t.arms).join(',')})`).join('; ') : 'none'}\n  - Recent commits:\n${(git.stdout || '').split('\n').filter(Boolean).slice(0, 5).map((l) => `    - ${l}`).join('\n')}\n\n## Next action\n${(values.next ?? 'Run `tracker ready` for the dispatch queue.').split(';').map((s) => `1. ${s.trim()}`).join('\n')}\n`;
    fs.writeFileSync(path.join(MEMORY_DIR, 'active.md'), out);
    console.log('active.md regenerated (' + out.length + 'B)');
  },
  progress() {
    // Replace one ticket row in memory/progress.md — no whole-file rewrite.
    const { values } = parseArgs({ args: rest, options: { ticket: { type: 'string' }, status: { type: 'string' } } });
    if (!values.ticket || !values.status) throw new Error('--ticket and --status required');
    const file = path.join(MEMORY_DIR, 'progress.md');
    let text = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^(\\| ${values.ticket} \\|[^|]*\\| ).*( \\|)$`, 'm');
    if (!re.test(text)) {
      text = text.replace('| Ticket | Description | Status |', `| Ticket | Description | Status |\n| ${values.ticket} | Platform | ${values.status} |`);
    } else {
      text = text.replace(re, `$1${values.status}$2`);
    }
    fs.writeFileSync(file, text);
    console.log(`progress.md row ${values.ticket} updated`);
  },
};

if (!cmd || !cmds[cmd]) {
  console.log(`tracker — agent state store CLI

Commands:
  current                              show in-progress arms
  ready [--stuck]                      dispatch queue / orphaned arms
  claim --ticket T --arm A [--agent N] mark arm in-progress
  log --ticket T --type TYPE [--arm A] [--note N]
  micro --ticket T --arm A --action "..." [--files f1,f2] [--gate pass|fail|skip] [--next "..."] [--detail "..."]
                                       log a micro-action (gate failures only — one STEP_DONE per verified step otherwise)
  handoff --ticket T --from A --to B --summary PTR [--gates g1,g2]
  plan new --ticket T --arm A [--objective O]
  plan get --ticket T --arm A
  plan set-status --ticket T --arm A --status S
  plan lock --ticket T --arm A         validate then lock
  validate-plan <file> [--resume]      deterministic pre-flight checks
  resume-check --ticket T --arm A [--run-gates]
                                       validate code state BEFORE resuming (git vs plan
                                       manifest, mtime reconciliation, optional gate re-run)
  search "query"                       full-text over events/handoffs/plans/journals
  history [--ticket T] [--last N]      event timeline (tail with --last)
  show --ticket T                      compact ticket snapshot (status + arms, no full file)
  journal-tail --ticket T [--lines N]  last N journal lines (default 30)
  seal --ticket T --arm A --what W [--gates G] [--findings F] [--next N] [--agent A]
                                       mechanical journal seal + STEP_DONE (budgets enforced)
  tick --ticket T --arm A --step N     flip step checkbox in place
  active --done D --next N             regenerate active.md from template
  progress --ticket T --status S       update one progress row`);
  process.exit(cmd ? 1 : 0);
}
cmds[cmd]();

