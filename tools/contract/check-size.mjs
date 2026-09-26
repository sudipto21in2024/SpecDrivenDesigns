#!/usr/bin/env node
// check-size.mjs (LOGI-0015 AC-3): rigid 150-line governance gate for CODE.
// Scope: .cs .ts .tsx .mjs .cjs .yaml/.yml (contract authorship fragments).
// OUT of scope by design: Markdown (docs, specs, plans, journals) and JSON
// (project-management, state, telemetry). Further exemptions in EXCEPT below.
// Legacy oversize code files are grandfathered through
// tools/contract/size-baseline.json as a RATCHET: growing one past its
// recorded count fails the gate (shrink-only, no drive-by growth).
// Usage:
//   node tools/contract/check-size.mjs                    # repo-wide (CI)
//   node tools/contract/check-size.mjs --staged           # local pre-commit
//   node tools/contract/check-size.mjs --files a,b        # touched-files gate
//   node tools/contract/check-size.mjs --update-baseline  # re-record ratchet
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = 'tools/contract/size-baseline.json';
const args = process.argv.slice(2);
const opt = (k, d) => {
  const m = args.find((a) => a.startsWith(k + '='));
  if (m) return m.split('=').slice(1).join('=');
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIMIT = parseInt(opt('--limit', '150'), 10);
const SRC_EXT = new Set(['.cs', '.ts', '.tsx', '.mjs', '.cjs', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.vs', '.kilo', '.clineskills', 'bin', 'obj', 'dist', 'build']);
const EXCEPT = [
  /^contracts\/v1-openapi\.yaml$/,             // generated OpenAPI bundle artifact
  /^src\/frontend\/src\/api\/schema\.d\.ts$/,  // generated from the bundle
  /(^|\/)Migrations\//,                        // EF Core generated migrations/snapshots
  /(^|\/)test-results\//, /^graphify-out\//,
  /(^|\/)package-lock\.json$/, /(^|\/).*\.min\.(js|css)$/,
  /(^|\/)sw\.ts$/, /^.*\.(md|json|jsonl|db|db-shm|db-wal|sqlite|log|svg|png|ico|lock)$/,
];
const count = (f) => {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return raw.endsWith('\n') ? raw.split('\n').length - 1 : raw.split('\n').length;
};
const loadBaseline = () => (fs.existsSync(path.join(ROOT, BASELINE))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf8')) : {});
let files = [];
if (opt('--files', null)) files = opt('--files', '').split(',').map((s) => s.trim()).filter(Boolean);
else if (args.includes('--staged')) {
  try {
    files = execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { files = []; }
} else {
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (SRC_EXT.has(path.extname(e.name).toLowerCase())) files.push(rel);
    }
  };
  walk('');
}
const baseline = loadBaseline();
if (args.includes('--update-baseline')) {
  const nb = {};
  for (const f of files) {
    if (EXCEPT.some((re) => re.test(f)) || !fs.existsSync(path.join(ROOT, f))) continue;
    const n = count(f);
    if (n > LIMIT) nb[f] = n;
  }
  fs.writeFileSync(path.join(ROOT, BASELINE), JSON.stringify(nb, null, 2) + '\n');
  console.log(`baseline recorded: ${Object.keys(nb).length} grandfathered code file(s) -> ${BASELINE}`);
  process.exit(0);
}
const bad = [];
for (const f of files) {
  if (EXCEPT.some((re) => re.test(f)) || !fs.existsSync(path.join(ROOT, f))) continue;
  const n = count(f);
  const allowed = baseline[f] !== undefined ? Math.max(LIMIT, baseline[f]) : LIMIT;
  if (n > allowed) bad.push({ f, n, allowed, ratchet: baseline[f] !== undefined });
}
if (bad.length) {
  console.error(`size-gate FAILED: ${bad.length} code file(s) over limit` +
    ` (md/json out of scope; ratchets in ${BASELINE}):`);
  for (const b of bad)
    console.error(`  ${b.n}>${b.allowed}${b.ratchet ? ' grandfathered: shrink-only' : ''}  ${b.f}`);
  process.exit(1);
}
console.log(`size-gate clean: ${files.length} file(s) checked, limit ${LIMIT}`);
