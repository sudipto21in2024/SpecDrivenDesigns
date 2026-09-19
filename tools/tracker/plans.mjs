// Plan-file parsing + deterministic pre-flight validation.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PLANS_DIR, ARM_BOUNDARIES, readEvents } from './core.mjs';

export function parseFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

export function planPath(ticket, arm) {
  return path.join(PLANS_DIR, `${ticket}-${arm}.plan.md`);
}

// Extract repo-relative backticked file paths from a manifest section.
export function manifestFiles(text, sectionHeader) {
  const sec = text.split(sectionHeader)[1];
  if (!sec) return [];
  const untilNext = sec.split(/\n## /)[0];
  return [...untilNext.matchAll(/`([^`\s]+\.[a-zA-Z]{1,6})`/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes(' '));
}

export function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*');
  return new RegExp(`^${esc}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((p) => globToRegex(p).test(file));
}

// Does a changed file belong to a §2 manifest entry? Exact match, glob match, or
// a new file inside the entry's directory (e.g. manifest lists a to-be-created file).
export function inManifest(file, manifest) {
  const norm = file.replace(/\\/g, '/');
  return manifest.some((m) => {
    if (m === norm) return true;
    if (m.includes('*')) return globToRegex(m).test(norm);
    const dir = path.dirname(m);
    return norm.startsWith(dir.replace(/\\/g, '/') + '/') || path.dirname(norm) === dir.replace(/\\/g, '/');
  });
}

// Load a plan file with parsed front matter + both manifests.
export function loadPlan(ticket, arm) {
  const file = planPath(ticket, arm);
  if (!fs.existsSync(file)) throw new Error(`plan not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const { fm, body } = parseFrontMatter(text);
  return { file, fm, body, writeFiles: manifestFiles(body, '## 2.'), readFiles: manifestFiles(body, '## 3.') };
}


export function validatePlan(planFile, { resume = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!planFile || !fs.existsSync(planFile)) return { ok: false, errors: [`plan file not found: ${planFile}`], warnings };
  const text = fs.readFileSync(planFile, 'utf8');
  const { fm, body } = parseFrontMatter(text);
  if (!fm.ticket || !fm.arm) errors.push('front matter must include ticket and arm');
  const boundary = ARM_BOUNDARIES[fm.arm];
  if (!boundary) errors.push(`unknown arm '${fm.arm}' (allowed: ${Object.keys(ARM_BOUNDARIES).join(', ')})`);

  const writeFiles = manifestFiles(body, '## 2.');
  const readFiles = manifestFiles(body, '## 3.');
  if (writeFiles.length === 0) errors.push('§2 touched-files manifest is empty or unparsable');

  for (const f of readFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) errors.push(`§3 required file missing: ${f}`);
  }
  for (const f of writeFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      const parent = path.dirname(path.join(ROOT, f));
      if (!fs.existsSync(parent)) errors.push(`§2 file parent dir missing: ${f}`);
    }
    if (boundary && matchesAny(f, boundary.deny)) errors.push(`§2 boundary violation: ${fm.arm} may not write ${f}`);
  }
  if (resume) {
    const events = readEvents().filter((e) => e.ticket === fm.ticket);
    const lastHandoff = events.filter((e) => e.type === 'HANDOFF').at(-1);
    if (lastHandoff) warnings.push(`prior handoff exists at ${lastHandoff.ts}; ensure plan still applies`);
  }
  if (fm.depends_on_plans) {
    for (const dep of fm.depends_on_plans.split(',').map((s) => s.trim()).filter(Boolean)) {
      const depFile = path.join(PLANS_DIR, `${dep}.plan.md`);
      if (!fs.existsSync(depFile)) warnings.push(`dependency plan not found: ${dep}`);
      else {
        const depStatus = parseFrontMatter(fs.readFileSync(depFile, 'utf8')).fm.status;
        if (depStatus !== 'locked' && depStatus !== 'done') warnings.push(`dependency plan ${dep} is '${depStatus}', not locked/done`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, writeFiles, readFiles };
}
